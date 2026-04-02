const fs = require('fs');
const path = require('path');
const url = require('url');
const onvif = require('node-onvif');
const onvifSoap = require('node-onvif/lib/modules/soap');
const { resolveCameraCredentials } = require('./camera-credentials');

const DATA_FILE = path.join(__dirname, 'data', 'cameras.json');
const EVENTS_XMLNS = [
    'xmlns:wsa="http://www.w3.org/2005/08/addressing"',
    'xmlns:tev="http://www.onvif.org/ver10/events/wsdl"',
    'xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2"',
    'xmlns:tt="http://www.onvif.org/ver10/schema"'
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function toArray(v) {
    if (v === undefined || v === null) return [];
    return Array.isArray(v) ? v : [v];
}

function readSimpleItems(node, out = []) {
    if (!node || typeof node !== 'object') return out;
    if (node.$ && typeof node.$.Name === 'string' && node.$.Value !== undefined) {
        out.push({
            name: String(node.$.Name).toLowerCase(),
            value: String(node.$.Value).toLowerCase()
        });
    }
    for (const k of Object.keys(node)) {
        readSimpleItems(node[k], out);
    }
    return out;
}

function extractTopic(notification) {
    const topic = notification?.Topic;
    if (!topic) return '';
    if (typeof topic === 'string') return topic;
    if (typeof topic._ === 'string') return topic._;
    return JSON.stringify(topic);
}

function motionFromNotification(notification) {
    const topic = extractTopic(notification).toLowerCase();
    const isMotionTopic = /(motion|cellmotiondetector|videosource\/motionalarm|ruleengine)/i.test(topic);
    const items = readSimpleItems(notification);

    let trueHit = false;
    let falseHit = false;
    for (const item of items) {
        const relevant = /(motion|state|alarm|active|ismotion)/i.test(item.name);
        if (!relevant) continue;
        if (['true', '1', 'on', 'active'].includes(item.value)) trueHit = true;
        if (['false', '0', 'off', 'inactive'].includes(item.value)) falseHit = true;
    }

    if (isMotionTopic && trueHit) return true;
    if (isMotionTopic && falseHit && !trueHit) return false;
    return null;
}

class CameraEventMonitor {
    constructor({
        cameraInventoryService = null,
        legacyFileFallbackEnabled = (process.env.LEGACY_COMPAT_EXPORTS_ENABLED === '1')
    } = {}) {
        this.cameraInventoryService = cameraInventoryService;
        this.legacyFileFallbackEnabled = legacyFileFallbackEnabled === true;
        this.running = false;
        this.monitors = new Map(); // camId -> monitor state
        this.motion = new Map(); // camId -> { motion, lastMotionAt, lastEventAt, source, healthy, error, topic }
        this.reloadTimer = null;
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.reloadNow();
        this.reloadTimer = setInterval(() => this.reloadNow(), 30000);
    }

    stop() {
        this.running = false;
        if (this.reloadTimer) clearInterval(this.reloadTimer);
        this.reloadTimer = null;
        for (const state of this.monitors.values()) {
            state.stop = true;
        }
        this.monitors.clear();
    }

    getMotion(camId) {
        if (!this.motion.has(camId)) {
            return {
                motion: false,
                lastMotionAt: null,
                lastEventAt: null,
                source: 'camera-events',
                healthy: false,
                error: 'No ONVIF event state',
                topic: null
            };
        }
        return this.motion.get(camId);
    }

    getAll() {
        const out = {};
        for (const [id, st] of this.motion.entries()) out[id] = st;
        return out;
    }

    loadCameras() {
        if (this.cameraInventoryService && typeof this.cameraInventoryService.listCameras === 'function') {
            try {
                const cameras = this.cameraInventoryService.listCameras();
                if (Array.isArray(cameras)) return cameras;
                if (!this.legacyFileFallbackEnabled) return [];
            } catch (error) {
                console.error('[EVT] Error loading inventory cameras:', error?.message || error);
                if (!this.legacyFileFallbackEnabled) return [];
            }
        }

        if (!this.legacyFileFallbackEnabled) return [];

        try {
            if (!fs.existsSync(DATA_FILE)) return [];
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            return Array.isArray(data) ? data : [];
        } catch (e) {
            console.error('[EVT] Error loading cameras.json:', e.message);
            return [];
        }
    }

    reloadNow() {
        const cameras = this.loadCameras().filter((cam) => cam?.id && cam?.ip);
        const cameraIds = new Set(cameras.map((c) => c.id));

        for (const cam of cameras) {
            if (!this.monitors.has(cam.id)) {
                const creds = resolveCameraCredentials(cam);
                const state = {
                    camera: cam,
                    stop: false,
                    eventsXaddr: null,
                    subscriptionXaddr: null,
                    timeDiff: 0,
                    user: creds.user,
                    pass: creds.pass,
                    subscriptionExpireAt: 0,
                    topic: null
                };
                this.monitors.set(cam.id, state);
                this.motion.set(cam.id, {
                    motion: false,
                    lastMotionAt: null,
                    lastEventAt: null,
                    source: 'camera-events',
                    healthy: false,
                    error: 'Initializing ONVIF events',
                    topic: null
                });
                this.loopCamera(state);
            } else {
                const st = this.monitors.get(cam.id);
                const creds = resolveCameraCredentials(cam);
                st.camera = cam;
                st.user = creds.user;
                st.pass = creds.pass;
            }
        }

        for (const [id, state] of this.monitors.entries()) {
            if (!cameraIds.has(id)) {
                state.stop = true;
                this.monitors.delete(id);
                this.motion.delete(id);
            }
        }
    }

    async ensureSubscription(state) {
        const now = Date.now();
        if (state.subscriptionXaddr && now < state.subscriptionExpireAt - 5000) return;

        const dev = new onvif.OnvifDevice({
            xaddr: state.camera.ip,
            user: state.user,
            pass: state.pass
        });
        await dev.init();

        if (!dev.services.events || !dev.services.events.xaddr) {
            throw new Error('Camera does not expose ONVIF events service');
        }

        state.eventsXaddr = dev.services.events.xaddr;
        state.timeDiff = dev.time_diff || 0;

        const body = '<tev:CreatePullPointSubscription><tev:InitialTerminationTime>PT1M</tev:InitialTerminationTime></tev:CreatePullPointSubscription>';
        const soap = onvifSoap.createRequestSoap({
            body,
            xmlns: EVENTS_XMLNS,
            diff: state.timeDiff,
            user: state.user,
            pass: state.pass
        });
        const result = await onvifSoap.requestCommand(url.parse(state.eventsXaddr), 'CreatePullPointSubscription', soap);
        const response = result?.data?.CreatePullPointSubscriptionResponse || {};
        const rawSubAddr = response?.SubscriptionReference?.Address;
        const subscriptionAddress = typeof rawSubAddr === 'string' ? rawSubAddr : rawSubAddr?._;
        state.subscriptionXaddr = subscriptionAddress || state.eventsXaddr;
        state.subscriptionExpireAt = Date.now() + 55000;
    }

    async pullMessages(state) {
        const body = '<tev:PullMessages><tev:Timeout>PT2S</tev:Timeout><tev:MessageLimit>10</tev:MessageLimit></tev:PullMessages>';
        const soap = onvifSoap.createRequestSoap({
            body,
            xmlns: EVENTS_XMLNS,
            diff: state.timeDiff || 0,
            user: state.user,
            pass: state.pass
        });
        const xaddr = state.subscriptionXaddr || state.eventsXaddr;
        const result = await onvifSoap.requestCommand(url.parse(xaddr), 'PullMessages', soap);
        const response = result?.data?.PullMessagesResponse || {};
        return toArray(response.NotificationMessage);
    }

    updateMotionState(camId, patch) {
        const prev = this.getMotion(camId);
        this.motion.set(camId, {
            ...prev,
            ...patch
        });
    }

    async loopCamera(state) {
        const camId = state.camera.id;
        while (this.running && !state.stop) {
            try {
                await this.ensureSubscription(state);
                const notifications = await this.pullMessages(state);
                let decided = null;
                let topic = null;

                for (const n of notifications) {
                    const m = motionFromNotification(n);
                    if (m === null) continue;
                    decided = m;
                    topic = extractTopic(n);
                }

                const nowIso = new Date().toISOString();
                if (decided === true) {
                    this.updateMotionState(camId, {
                        motion: true,
                        lastMotionAt: nowIso,
                        lastEventAt: nowIso,
                        source: 'camera-events',
                        healthy: true,
                        error: null,
                        topic
                    });
                } else if (decided === false) {
                    this.updateMotionState(camId, {
                        motion: false,
                        lastEventAt: nowIso,
                        source: 'camera-events',
                        healthy: true,
                        error: null,
                        topic
                    });
                } else {
                    // No motion-specific event in this pull. Keep current state but mark healthy.
                    this.updateMotionState(camId, {
                        source: 'camera-events',
                        healthy: true,
                        error: null
                    });
                }
            } catch (e) {
                this.updateMotionState(camId, {
                    source: 'camera-events',
                    healthy: false,
                    error: e.message || String(e)
                });
                state.subscriptionXaddr = null;
                state.subscriptionExpireAt = 0;
                await sleep(2000);
            }
        }
    }
}

const defaultCameraEventMonitor = new CameraEventMonitor();

module.exports = defaultCameraEventMonitor;
module.exports.CameraEventMonitor = CameraEventMonitor;

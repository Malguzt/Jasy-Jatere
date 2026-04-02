const onvif = require('node-onvif');
const onvifSoap = require('node-onvif/lib/modules/soap');
const url = require('url');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const { resolveUserPass } = require('../../../camera-credentials');

const DEFAULT_CAMERA_DATA_FILE = path.join(__dirname, '../../../data/cameras.json');

function toPositiveInt(value, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return fallback;
    return Math.floor(num);
}

function buildConfig(config = {}, env = process.env) {
    const discoverCommonSubnetsRaw = config.discoverCommonSubnetsRaw || env.CAMERA_DISCOVER_COMMON_SUBNETS || '192.168.1,192.168.0';
    const discoverPortsRaw = config.discoverPortsRaw || env.CAMERA_DISCOVER_PORTS || '5000,80,8080,8899';
    const discoverIpRange = String(config.discoverIpRange || env.CAMERA_DISCOVER_IP_RANGE || '2-254').trim();

    return {
        discoverProbeTimeoutMs: toPositiveInt(
            config.discoverProbeTimeoutMs || env.CAMERA_DISCOVER_PROBE_TIMEOUT_MS,
            6000
        ),
        discoverConnectTimeoutMs: toPositiveInt(
            config.discoverConnectTimeoutMs || env.CAMERA_DISCOVER_CONNECT_TIMEOUT_MS,
            400
        ),
        discoverHttpTimeoutMs: toPositiveInt(
            config.discoverHttpTimeoutMs || env.CAMERA_DISCOVER_HTTP_TIMEOUT_MS,
            900
        ),
        discoverConcurrency: toPositiveInt(
            config.discoverConcurrency || env.CAMERA_DISCOVER_CONCURRENCY,
            80
        ),
        discoverIpRange,
        discoverCommonSubnets: String(discoverCommonSubnetsRaw)
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        discoverPorts: String(discoverPortsRaw)
            .split(',')
            .map((value) => Number(value.trim()))
            .filter((value) => Number.isFinite(value) && value > 0 && value < 65536)
    };
}

function cameraServiceError(status, message, code = null, details = null) {
    const error = new Error(message || 'Camera service error');
    error.status = status;
    if (code) error.code = code;
    if (details !== null && details !== undefined) error.details = details;
    return error;
}

class OnvifCameraService {
    constructor({
        onvifLib = onvif,
        onvifSoapModule = onvifSoap,
        urlModule = url,
        fsModule = fs,
        osModule = os,
        netModule = net,
        fetchImpl = fetch,
        resolveUserPassFn = resolveUserPass,
        cameraDataFile = DEFAULT_CAMERA_DATA_FILE,
        config = {}
    } = {}) {
        this.onvif = onvifLib;
        this.onvifSoap = onvifSoapModule;
        this.url = urlModule;
        this.fs = fsModule;
        this.os = osModule;
        this.net = netModule;
        this.fetch = fetchImpl;
        this.resolveUserPass = resolveUserPassFn;
        this.cameraDataFile = cameraDataFile;
        this.config = buildConfig(config);
    }

    withTimeout(promise, timeoutMs, label = 'timeout') {
        return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error(label)), timeoutMs))
        ]);
    }

    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    isTransientNetError(error) {
        const message = String(error?.message || error || '').toLowerCase();
        return (
            message.includes('ehostunreach') ||
            message.includes('etimedout') ||
            message.includes('econnreset') ||
            message.includes('econnrefused') ||
            message.includes('socket hang up') ||
            message.includes('network error')
        );
    }

    async initDeviceWithRetry({ xaddr, user, pass }, maxAttempts = 3) {
        const creds = this.resolveUserPass(user, pass);
        let lastError = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                const device = new this.onvif.OnvifDevice({
                    xaddr,
                    user: creds.user,
                    pass: creds.pass
                });
                await this.withTimeout(device.init(), 7000, 'device-init-timeout');
                return device;
            } catch (error) {
                lastError = error;
                const retryable = this.isTransientNetError(error);
                if (!retryable || attempt >= maxAttempts) break;
                await this.sleep(250 * attempt);
            }
        }

        throw lastError || new Error('device-init-failed');
    }

    parseIpRange(rangeText) {
        const match = String(rangeText || '').match(/^(\d{1,3})\s*-\s*(\d{1,3})$/);
        if (!match) return { start: 2, end: 254 };
        const start = Math.max(1, Math.min(254, Number(match[1])));
        const end = Math.max(1, Math.min(254, Number(match[2])));
        return { start: Math.min(start, end), end: Math.max(start, end) };
    }

    getPrefixFromIp(ip) {
        if (!ip || typeof ip !== 'string') return null;
        const parts = ip.split('.');
        if (parts.length !== 4) return null;
        if (parts.some((part) => Number(part) < 0 || Number(part) > 255)) return null;
        return `${parts[0]}.${parts[1]}.${parts[2]}`;
    }

    loadKnownIpPrefixes() {
        const out = new Set();
        try {
            if (!this.fs.existsSync(this.cameraDataFile)) return out;
            const cameras = JSON.parse(this.fs.readFileSync(this.cameraDataFile, 'utf8'));
            for (const camera of cameras || []) {
                const fromRtsp = camera?.rtspUrl && camera.rtspUrl.startsWith('rtsp://')
                    ? (() => {
                        try {
                            return new URL(camera.rtspUrl.replace(/rtsp:\/\/[^@]+@/, 'rtsp://')).hostname;
                        } catch (error) {
                            return null;
                        }
                    })()
                    : null;
                const fromIp = camera?.ip
                    ? (() => {
                        try {
                            return new URL(camera.ip).hostname;
                        } catch (error) {
                            return null;
                        }
                    })()
                    : null;
                const prefixA = this.getPrefixFromIp(fromRtsp);
                const prefixB = this.getPrefixFromIp(fromIp);
                if (prefixA) out.add(prefixA);
                if (prefixB) out.add(prefixB);
            }
        } catch (error) {
            console.warn('[DISCOVER] No se pudieron leer prefijos conocidos:', error.message || error);
        }
        return out;
    }

    resolveScanPrefixes() {
        const prefixes = new Set();
        const envPrefixes = String(process.env.CAMERA_DISCOVER_SUBNETS || '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean);

        envPrefixes.forEach((value) => {
            const clean = value.replace(/\/\d+$/, '');
            const prefix = this.getPrefixFromIp(`${clean}.1`) || this.getPrefixFromIp(clean);
            if (prefix) prefixes.add(prefix);
        });

        const interfaces = this.os.networkInterfaces();
        Object.values(interfaces).flat().forEach((info) => {
            if (!info || info.internal || info.family !== 'IPv4') return;
            const prefix = this.getPrefixFromIp(info.address);
            if (prefix) prefixes.add(prefix);
        });

        this.loadKnownIpPrefixes().forEach((prefix) => prefixes.add(prefix));
        this.config.discoverCommonSubnets.forEach((raw) => {
            const prefix = this.getPrefixFromIp(`${raw}.1`) || this.getPrefixFromIp(raw);
            if (prefix) prefixes.add(prefix);
        });

        if (prefixes.size === 0) {
            prefixes.add('192.168.1');
        }

        return [...prefixes].filter((prefix) => {
            const [a, b] = prefix.split('.').map((value) => Number(value));
            if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
            if (a === 127) return false;
            if (a === 169 && b === 254) return false;
            if (a === 172 && b >= 16 && b <= 31) return false;
            return true;
        });
    }

    tcpConnectProbe(ip, port, timeoutMs) {
        return new Promise((resolve) => {
            const socket = new this.net.Socket();
            let done = false;
            const finish = (ok) => {
                if (done) return;
                done = true;
                try {
                    socket.destroy();
                } catch (error) {}
                resolve(ok);
            };

            socket.setTimeout(timeoutMs);
            socket.once('connect', () => finish(true));
            socket.once('timeout', () => finish(false));
            socket.once('error', () => finish(false));
            socket.connect(port, ip);
        });
    }

    async looksLikeOnvifService(xaddr) {
        const soapProbe = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">',
            '<s:Body>',
            '<tds:GetServices xmlns:tds="http://www.onvif.org/ver10/device/wsdl">',
            '<tds:IncludeCapability>false</tds:IncludeCapability>',
            '</tds:GetServices>',
            '</s:Body>',
            '</s:Envelope>'
        ].join('');

        try {
            const signal = AbortSignal.timeout(this.config.discoverHttpTimeoutMs);
            const response = await this.fetch(xaddr, {
                method: 'POST',
                headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
                body: soapProbe,
                signal
            });
            const text = (await response.text()).slice(0, 3000);
            const looksSoap = /soap|onvif|getservicesresponse|www\.onvif\.org/i.test(text);
            const looksHtml = /<!doctype html|<html\b/i.test(text);
            if (!looksSoap || looksHtml) return false;
            if ([200, 400, 401, 403, 405, 415].includes(response.status)) {
                return true;
            }
        } catch (error) {}
        return false;
    }

    async mapLimit(items, limit, task) {
        const out = [];
        let index = 0;
        const workers = new Array(Math.max(1, limit)).fill(null).map(async () => {
            while (index < items.length) {
                const i = index++;
                try {
                    out[i] = await task(items[i], i);
                } catch (error) {
                    out[i] = null;
                }
            }
        });
        await Promise.all(workers);
        return out;
    }

    dedupeByAddress(items) {
        const seen = new Set();
        const out = [];
        for (const item of items) {
            if (!item || !item.address) continue;
            if (seen.has(item.address)) continue;
            seen.add(item.address);
            out.push(item);
        }
        return out;
    }

    async discoverByActiveScan() {
        const prefixes = this.resolveScanPrefixes();
        const { start, end } = this.parseIpRange(this.config.discoverIpRange);
        const candidates = [];

        prefixes.forEach((prefix) => {
            for (let host = start; host <= end; host += 1) {
                for (const port of this.config.discoverPorts) {
                    candidates.push({ ip: `${prefix}.${host}`, port });
                }
            }
        });

        const found = await this.mapLimit(candidates, this.config.discoverConcurrency, async ({ ip, port }) => {
            const open = await this.tcpConnectProbe(ip, port, this.config.discoverConnectTimeoutMs);
            if (!open) return null;
            const xaddr = `http://${ip}:${port}/onvif/device_service`;
            const onvifLike = await this.looksLikeOnvifService(xaddr);
            if (!onvifLike) return null;

            let name = `ONVIF Camera ${ip}`;
            let hardware = 'Unknown';
            try {
                const device = await this.initDeviceWithRetry({ xaddr }, 1);
                const info = device.getInformation() || {};
                name = info.model || info.manufacturer || name;
                hardware = info.hardwareId || info.firmwareVersion || hardware;
            } catch (error) {}

            return {
                urn: `active-${ip}-${port}`,
                name,
                address: xaddr,
                hardware
            };
        });

        const devices = this.dedupeByAddress(found.filter(Boolean)).map((device, index) => ({
            id: index,
            urn: device.urn,
            name: device.name,
            address: device.address,
            hardware: device.hardware
        }));
        return { devices, prefixes };
    }

    async discover() {
        try {
            console.log('Empezando descubrimiento de cámaras (WS-Discovery)...');
            const deviceInfoList = await this.withTimeout(
                this.onvif.startProbe(),
                this.config.discoverProbeTimeoutMs,
                'probe-timeout'
            );

            let method = 'ws-discovery';
            let scannedPrefixes = [];
            let friendlyList = (deviceInfoList || []).map((info, index) => ({
                id: index,
                urn: info.urn,
                name: info.name,
                address: info.xaddrs[0],
                hardware: info.hardware || 'Unknown'
            }));

            if (friendlyList.length === 0) {
                console.log('[DISCOVER] WS-Discovery no devolvió cámaras. Ejecutando escaneo activo...');
                const scan = await this.discoverByActiveScan();
                friendlyList = scan.devices;
                scannedPrefixes = scan.prefixes || [];
                method = 'active-scan';
                console.log(`[DISCOVER] Escaneo activo finalizó con ${friendlyList.length} cámaras.`);
            }

            return {
                devices: friendlyList,
                count: friendlyList.length,
                method,
                scannedPrefixes
            };
        } catch (error) {
            console.error('Error descubriendo cámaras:', error);
            try {
                const fallback = await this.discoverByActiveScan();
                return {
                    devices: fallback.devices,
                    count: fallback.devices.length,
                    method: 'active-scan-fallback',
                    scannedPrefixes: fallback.prefixes || [],
                    warning: `WS-Discovery failed: ${error.message || String(error)}`
                };
            } catch (fallbackError) {
                throw cameraServiceError(
                    500,
                    'Error descubriendo cámaras',
                    'DISCOVER_FAILED',
                    {
                        error: error.message || String(error),
                        fallbackError: fallbackError.message || String(fallbackError)
                    }
                );
            }
        }
    }

    async connect(payload = {}) {
        const { url: xaddr, user, pass } = payload;
        if (!xaddr) {
            throw cameraServiceError(400, 'Se requiere la URL de la cámara (xaddrs)', 'CAMERA_URL_REQUIRED');
        }

        try {
            const creds = this.resolveUserPass(user, pass);
            const device = await this.initDeviceWithRetry({
                xaddr,
                user: creds.user,
                pass: creds.pass
            }, 3);

            const profileList = device.getProfileList() || [];
            const ptzSupport = !!device?.services?.ptz;
            const profiles = profileList.map((profile) => {
                const hasVideo = profile.video && profile.video.encoder;
                let rtspUrl = device.getUdpStreamUrl(profile.token);

                if (creds.pass && rtspUrl && !rtspUrl.includes('@')) {
                    rtspUrl = rtspUrl.replace('rtsp://', `rtsp://${creds.user}:${creds.pass}@`);
                }

                return {
                    name: profile.name,
                    token: profile.token,
                    resolution: hasVideo
                        ? `${profile.video.encoder.resolution.width}x${profile.video.encoder.resolution.height}`
                        : 'Unknown',
                    codec: hasVideo ? profile.video.encoder.encoding : 'Unknown',
                    rtspUrl
                };
            });

            const deviceInfo = device.getInformation() || {};
            const uniqueRtspUrls = [...new Set(profiles.map((profile) => profile.rtspUrl).filter(Boolean))];
            console.log(
                `[ONVIF] Detectados ${profiles.length} perfiles (${uniqueRtspUrls.length} URLs RTSP únicas) para ${xaddr}`
            );
            if (uniqueRtspUrls.length >= 1) {
                console.log(`[ONVIF] Inyectando perfil sintético Combined AI para ${xaddr}`);
                profiles.push({
                    name: 'Combined AI Stream (Specialized)',
                    token: 'combined_ai',
                    resolution: uniqueRtspUrls.length >= 2
                        ? '1280x720 (Dual Stream Optimized)'
                        : '1280x720 (Single Stream Optimized)',
                    codec: 'H.264',
                    rtspUrl: 'combined'
                });
            } else {
                console.log(`[ONVIF] No se inyecta Combined AI para ${xaddr}: no se encontró URL RTSP útil.`);
            }

            return {
                device_info: deviceInfo,
                profiles,
                ptz: ptzSupport
            };
        } catch (error) {
            if (Number(error?.status)) throw error;
            throw cameraServiceError(500, error.message || 'Error de conexión', 'CAMERA_CONNECT_FAILED');
        }
    }

    async movePtz(payload = {}) {
        const { url: xaddr, user, pass, direction } = payload;
        if (!xaddr || !direction) {
            throw cameraServiceError(400, 'Faltan parámetros', 'PTZ_BAD_REQUEST');
        }

        try {
            const creds = this.resolveUserPass(user, pass);
            const device = new this.onvif.OnvifDevice({ xaddr, user: creds.user, pass: creds.pass });
            await device.init();
            if (!device.services.ptz) {
                throw cameraServiceError(400, 'Cámara no soporta PTZ', 'PTZ_NOT_SUPPORTED');
            }

            const speed = { x: 0, y: 0, z: 0 };
            const baseSpeed = 0.5;
            switch (direction) {
                case 'up': speed.y = baseSpeed; break;
                case 'down': speed.y = -baseSpeed; break;
                case 'left': speed.x = -baseSpeed; break;
                case 'right': speed.x = baseSpeed; break;
                case 'zoom-in': speed.z = baseSpeed; break;
                case 'zoom-out': speed.z = -baseSpeed; break;
            }

            await device.ptzMove({ speed });
            return { moved: true };
        } catch (error) {
            if (Number(error?.status)) throw error;
            throw cameraServiceError(500, error.message || String(error), 'PTZ_MOVE_FAILED');
        }
    }

    async stopPtz(payload = {}) {
        const { url: xaddr, user, pass } = payload;
        try {
            const creds = this.resolveUserPass(user, pass);
            const device = new this.onvif.OnvifDevice({ xaddr, user: creds.user, pass: creds.pass });
            await device.init();
            await device.ptzStop();
            return { stopped: true };
        } catch (error) {
            if (Number(error?.status)) throw error;
            throw cameraServiceError(500, error.message || String(error), 'PTZ_STOP_FAILED');
        }
    }

    async snapshot(payload = {}) {
        const { url: xaddr, user, pass } = payload;
        try {
            const creds = this.resolveUserPass(user, pass);
            const device = new this.onvif.OnvifDevice({ xaddr, user: creds.user, pass: creds.pass });
            await device.init();
            return await device.fetchSnapshot();
        } catch (error) {
            if (Number(error?.status)) throw error;
            throw cameraServiceError(500, error.message || String(error), 'SNAPSHOT_FAILED');
        }
    }

    async sendAuxiliaryCommand(device, profileToken, command) {
        if (!device?.services?.ptz?.xaddr) {
            throw new Error('PTZ service not available for auxiliary commands');
        }

        const soapBody = [
            '<tptz:SendAuxiliaryCommand>',
            `<tptz:ProfileToken>${profileToken}</tptz:ProfileToken>`,
            `<tptz:AuxiliaryData>${command}</tptz:AuxiliaryData>`,
            '</tptz:SendAuxiliaryCommand>'
        ].join('');

        const soap = this.onvifSoap.createRequestSoap({
            body: soapBody,
            xmlns: [
                'xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl"',
                'xmlns:tt="http://www.onvif.org/ver10/schema"'
            ],
            diff: device.time_diff || 0,
            user: device.user || '',
            pass: device.pass || ''
        });
        return this.onvifSoap.requestCommand(
            this.url.parse(device.services.ptz.xaddr),
            'SendAuxiliaryCommand',
            soap
        );
    }

    async toggleLight(payload = {}) {
        const { url: xaddr, user, pass, enabled } = payload;
        if (!xaddr) {
            throw cameraServiceError(400, 'Falta url ONVIF de la cámara', 'CAMERA_URL_REQUIRED');
        }

        try {
            const creds = this.resolveUserPass(user, pass);
            const device = new this.onvif.OnvifDevice({ xaddr, user: creds.user, pass: creds.pass });
            await device.init();

            const profileList = device.getProfileList() || [];
            const profileToken = profileList[0]?.token;
            if (!profileToken) {
                throw cameraServiceError(400, 'No se encontró ProfileToken ONVIF', 'PTZ_PROFILE_TOKEN_MISSING');
            }

            const onCommands = [
                'tt:WLED|On',
                'tt:WhiteLight|On',
                'tt:IRLamp|On',
                'tt:IRLight|On',
                'tt:Light|On'
            ];
            const offCommands = [
                'tt:WLED|Off',
                'tt:WhiteLight|Off',
                'tt:IRLamp|Off',
                'tt:IRLight|Off',
                'tt:Light|Off'
            ];
            const candidates = enabled ? onCommands : offCommands;

            let lastError = null;
            for (const command of candidates) {
                try {
                    await this.sendAuxiliaryCommand(device, profileToken, command);
                    return { enabled: !!enabled, command };
                } catch (error) {
                    lastError = error;
                }
            }

            throw cameraServiceError(
                400,
                'La cámara no aceptó comandos ONVIF de luz/auxiliar',
                'LIGHT_TOGGLE_REJECTED',
                {
                    detail: lastError ? String(lastError.message || lastError) : null
                }
            );
        } catch (error) {
            if (Number(error?.status)) throw error;
            throw cameraServiceError(500, error.message || String(error), 'LIGHT_TOGGLE_FAILED');
        }
    }
}

module.exports = {
    OnvifCameraService,
    cameraServiceError
};

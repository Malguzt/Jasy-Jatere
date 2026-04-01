const express = require('express');
const router = express.Router();
const onvif = require('node-onvif');
const onvifSoap = require('node-onvif/lib/modules/soap');
const url = require('url');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const { resolveUserPass } = require('../camera-credentials');

const CAMERA_DATA_FILE = path.join(__dirname, '../data/cameras.json');
const DISCOVER_PROBE_TIMEOUT_MS = Number(process.env.CAMERA_DISCOVER_PROBE_TIMEOUT_MS || 6000);
const DISCOVER_CONNECT_TIMEOUT_MS = Number(process.env.CAMERA_DISCOVER_CONNECT_TIMEOUT_MS || 400);
const DISCOVER_HTTP_TIMEOUT_MS = Number(process.env.CAMERA_DISCOVER_HTTP_TIMEOUT_MS || 900);
const DISCOVER_CONCURRENCY = Number(process.env.CAMERA_DISCOVER_CONCURRENCY || 80);
const DISCOVER_IP_RANGE = (process.env.CAMERA_DISCOVER_IP_RANGE || '2-254').trim();
const DISCOVER_COMMON_SUBNETS = (process.env.CAMERA_DISCOVER_COMMON_SUBNETS || '192.168.1,192.168.0')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
const DISCOVER_PORTS = (process.env.CAMERA_DISCOVER_PORTS || '5000,80,8080,8899')
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v) && v > 0 && v < 65536);

function withTimeout(promise, timeoutMs, label = 'timeout') {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(label)), timeoutMs))
    ]);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientNetError(err) {
    const msg = String(err?.message || err || '').toLowerCase();
    return (
        msg.includes('ehostunreach') ||
        msg.includes('etimedout') ||
        msg.includes('econnreset') ||
        msg.includes('econnrefused') ||
        msg.includes('socket hang up') ||
        msg.includes('network error')
    );
}

async function initDeviceWithRetry({ xaddr, user, pass }, maxAttempts = 3) {
    const creds = resolveUserPass(user, pass);
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const device = new onvif.OnvifDevice({ xaddr, user: creds.user, pass: creds.pass });
            await withTimeout(device.init(), 7000, 'device-init-timeout');
            return device;
        } catch (e) {
            lastErr = e;
            const retryable = isTransientNetError(e);
            if (!retryable || attempt >= maxAttempts) break;
            await sleep(250 * attempt);
        }
    }
    throw lastErr || new Error('device-init-failed');
}

function parseIpRange(rangeText) {
    const m = String(rangeText || '').match(/^(\d{1,3})\s*-\s*(\d{1,3})$/);
    if (!m) return { start: 2, end: 254 };
    const start = Math.max(1, Math.min(254, Number(m[1])));
    const end = Math.max(1, Math.min(254, Number(m[2])));
    return { start: Math.min(start, end), end: Math.max(start, end) };
}

function getPrefixFromIp(ip) {
    if (!ip || typeof ip !== 'string') return null;
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    if (parts.some((p) => Number(p) < 0 || Number(p) > 255)) return null;
    return `${parts[0]}.${parts[1]}.${parts[2]}`;
}

function loadKnownIpPrefixes() {
    const out = new Set();
    try {
        if (!fs.existsSync(CAMERA_DATA_FILE)) return out;
        const cameras = JSON.parse(fs.readFileSync(CAMERA_DATA_FILE, 'utf8'));
        for (const cam of cameras || []) {
            const fromRtsp = cam?.rtspUrl && cam.rtspUrl.startsWith('rtsp://')
                ? new URL(cam.rtspUrl.replace(/rtsp:\/\/[^@]+@/, 'rtsp://')).hostname
                : null;
            const fromIp = cam?.ip ? (() => {
                try { return new URL(cam.ip).hostname; } catch (e) { return null; }
            })() : null;
            const p1 = getPrefixFromIp(fromRtsp);
            const p2 = getPrefixFromIp(fromIp);
            if (p1) out.add(p1);
            if (p2) out.add(p2);
        }
    } catch (e) {
        console.warn('[DISCOVER] No se pudieron leer prefijos conocidos:', e.message || e);
    }
    return out;
}

function resolveScanPrefixes() {
    const prefixes = new Set();

    const envPrefixes = (process.env.CAMERA_DISCOVER_SUBNETS || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    envPrefixes.forEach((p) => {
        const clean = p.replace(/\/\d+$/, '');
        const prefix = getPrefixFromIp(`${clean}.1`) || getPrefixFromIp(clean);
        if (prefix) prefixes.add(prefix);
    });

    const ifaces = os.networkInterfaces();
    Object.values(ifaces).flat().forEach((info) => {
        if (!info || info.internal || info.family !== 'IPv4') return;
        const p = getPrefixFromIp(info.address);
        if (p) prefixes.add(p);
    });

    loadKnownIpPrefixes().forEach((p) => prefixes.add(p));
    DISCOVER_COMMON_SUBNETS.forEach((raw) => {
        const p = getPrefixFromIp(`${raw}.1`) || getPrefixFromIp(raw);
        if (p) prefixes.add(p);
    });

    if (prefixes.size === 0) {
        prefixes.add('192.168.1');
    }
    return [...prefixes].filter((prefix) => {
        const [a, b] = prefix.split('.').map((n) => Number(n));
        if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
        if (a === 127) return false;
        if (a === 169 && b === 254) return false;
        if (a === 172 && b >= 16 && b <= 31) return false; // docker/virtual ranges
        return true;
    });
}

function tcpConnectProbe(ip, port, timeoutMs) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let done = false;
        const finish = (ok) => {
            if (done) return;
            done = true;
            try { socket.destroy(); } catch (e) {}
            resolve(ok);
        };

        socket.setTimeout(timeoutMs);
        socket.once('connect', () => finish(true));
        socket.once('timeout', () => finish(false));
        socket.once('error', () => finish(false));
        socket.connect(port, ip);
    });
}

async function looksLikeOnvifService(xaddr) {
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
        const signal = AbortSignal.timeout(DISCOVER_HTTP_TIMEOUT_MS);
        const res = await fetch(xaddr, {
            method: 'POST',
            headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
            body: soapProbe,
            signal
        });
        const text = (await res.text()).slice(0, 3000);
        const looksSoap = /soap|onvif|getservicesresponse|www\.onvif\.org/i.test(text);
        const looksHtml = /<!doctype html|<html\b/i.test(text);
        if (!looksSoap || looksHtml) return false;
        if ([200, 400, 401, 403, 405, 415].includes(res.status)) {
            return true;
        }
    } catch (e) {}
    return false;
}

async function mapLimit(items, limit, task) {
    const out = [];
    let index = 0;
    const workers = new Array(Math.max(1, limit)).fill(null).map(async () => {
        while (index < items.length) {
            const i = index++;
            try {
                out[i] = await task(items[i], i);
            } catch (e) {
                out[i] = null;
            }
        }
    });
    await Promise.all(workers);
    return out;
}

function dedupeByAddress(items) {
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

async function discoverByActiveScan() {
    const prefixes = resolveScanPrefixes();
    const { start, end } = parseIpRange(DISCOVER_IP_RANGE);
    const candidates = [];
    prefixes.forEach((prefix) => {
        for (let host = start; host <= end; host += 1) {
            for (const port of DISCOVER_PORTS) {
                candidates.push({ ip: `${prefix}.${host}`, port });
            }
        }
    });

    const found = await mapLimit(candidates, DISCOVER_CONCURRENCY, async ({ ip, port }) => {
        const open = await tcpConnectProbe(ip, port, DISCOVER_CONNECT_TIMEOUT_MS);
        if (!open) return null;
        const xaddr = `http://${ip}:${port}/onvif/device_service`;
        const onvifLike = await looksLikeOnvifService(xaddr);
        if (!onvifLike) return null;

        let name = `ONVIF Camera ${ip}`;
        let hardware = 'Unknown';
        try {
            const dev = await initDeviceWithRetry({ xaddr }, 1);
            const info = dev.getInformation() || {};
            name = info.model || info.manufacturer || name;
            hardware = info.hardwareId || info.firmwareVersion || hardware;
        } catch (e) {}

        return {
            urn: `active-${ip}-${port}`,
            name,
            address: xaddr,
            hardware
        };
    });

    const devices = dedupeByAddress(found.filter(Boolean)).map((d, idx) => ({
        id: idx,
        urn: d.urn,
        name: d.name,
        address: d.address,
        hardware: d.hardware
    }));
    return { devices, prefixes };
}

router.get('/discover', async (req, res) => {
    try {
        console.log('Empezando descubrimiento de cámaras (WS-Discovery)...');
        const device_info_list = await withTimeout(onvif.startProbe(), DISCOVER_PROBE_TIMEOUT_MS, 'probe-timeout');

        let method = 'ws-discovery';
        let scannedPrefixes = [];
        let friendlyList = (device_info_list || []).map((info, idx) => ({
            id: idx,
            urn: info.urn,
            name: info.name,
            address: info.xaddrs[0], 
            hardware: info.hardware || 'Unknown'
        }));

        if (friendlyList.length === 0) {
            console.log('[DISCOVER] WS-Discovery no devolvió cámaras. Ejecutando escaneo activo...');
            const scan = await discoverByActiveScan();
            friendlyList = scan.devices;
            scannedPrefixes = scan.prefixes || [];
            method = 'active-scan';
            console.log(`[DISCOVER] Escaneo activo finalizó con ${friendlyList.length} cámaras.`);
        }

        res.json({
            success: true,
            devices: friendlyList,
            count: friendlyList.length,
            method,
            scannedPrefixes
        });
    } catch (error) {
        console.error('Error descubriendo cámaras:', error);
        try {
            const fallback = await discoverByActiveScan();
            return res.json({
                success: true,
                devices: fallback.devices,
                count: fallback.devices.length,
                method: 'active-scan-fallback',
                scannedPrefixes: fallback.prefixes || [],
                warning: `WS-Discovery failed: ${error.message || String(error)}`
            });
        } catch (fallbackError) {
            return res.status(500).json({
                success: false,
                error: error.message,
                fallbackError: fallbackError.message || String(fallbackError)
            });
        }
    }
});

router.post('/connect', async (req, res) => {
    const { url, user, pass } = req.body;
    
    if (!url) {
        return res.status(400).json({ success: false, error: 'Se requiere la URL de la cámara (xaddrs)' });
    }

    try {
        const creds = resolveUserPass(user, pass);
        let device = await initDeviceWithRetry({
            xaddr: url,
            user: creds.user,
            pass: creds.pass
        }, 3);
        
        const profile_list = device.getProfileList();
        const ptz_support = device.services.ptz ? true : false;
        
        const profilesDetails = profile_list.map(profile => {
            const hasVideo = profile.video && profile.video.encoder;
            let rtspUrl = device.getUdpStreamUrl(profile.token);
            
            // Inject credentials into URL if present
            if (creds.pass && rtspUrl && !rtspUrl.includes('@')) {
                rtspUrl = rtspUrl.replace('rtsp://', `rtsp://${creds.user}:${creds.pass}@`);
            }

            return {
                name: profile.name,
                token: profile.token,
                resolution: hasVideo ? `${profile.video.encoder.resolution.width}x${profile.video.encoder.resolution.height}` : 'Unknown',
                codec: hasVideo ? profile.video.encoder.encoding : 'Unknown',
                rtspUrl: rtspUrl
            };
        });

        const deviceInfo = device.getInformation() || {};

        // INJECT COMBINED AI OPTION
        // Always offer combined mode when we have at least 1 RTSP URL.
        // If only one unique URL exists, combined mode will reuse that source:
        // idle -> low-res passthrough, motion -> enhancement path.
        const uniqueRtspUrls = [...new Set(profilesDetails.map((p) => p.rtspUrl).filter(Boolean))];
        console.log(`[ONVIF] Detectados ${profilesDetails.length} perfiles (${uniqueRtspUrls.length} URLs RTSP únicas) para ${url}`);
        if (uniqueRtspUrls.length >= 1) {
            console.log(`[ONVIF] Inyectando perfil sintético Combined AI para ${url}`);
            profilesDetails.push({
                name: 'Combined AI Stream (Specialized)',
                token: 'combined_ai',
                resolution: uniqueRtspUrls.length >= 2 ? '1280x720 (Dual Stream Optimized)' : '1280x720 (Single Stream Optimized)',
                codec: 'H.264',
                rtspUrl: 'combined' // Special keyword for the backend
            });
        } else {
            console.log(`[ONVIF] No se inyecta Combined AI para ${url}: no se encontró URL RTSP útil.`);
        }

        res.json({
            success: true,
            device_info: deviceInfo,
            profiles: profilesDetails,
            ptz: ptz_support
        });
    } catch (error) {
         console.error('Error conectando a la cámara:', error);
         res.status(500).json({ success: false, error: error.message || 'Error de conexión' });
    }
});

router.post('/ptz/move', async (req, res) => {
    const { url, user, pass, direction } = req.body;
    if (!url || !direction) return res.status(400).json({ success: false, error: 'Faltan parámetros' });

    try {
        const creds = resolveUserPass(user, pass);
        let device = new onvif.OnvifDevice({ xaddr: url, user: creds.user, pass: creds.pass });
        await device.init();
        if (!device.services.ptz) return res.status(400).json({ success: false, error: 'Cámara no soporta PTZ' });

        let speed = { x: 0, y: 0, z: 0 };
        const s = 0.5; // Velocidad fija

        switch (direction) {
            case 'up': speed.y = s; break;
            case 'down': speed.y = -s; break;
            case 'left': speed.x = -s; break;
            case 'right': speed.x = s; break;
            case 'zoom-in': speed.z = s; break;
            case 'zoom-out': speed.z = -s; break;
        }

        await device.ptzMove({ speed });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/ptz/stop', async (req, res) => {
    const { url, user, pass } = req.body;
    try {
        const creds = resolveUserPass(user, pass);
        let device = new onvif.OnvifDevice({ xaddr: url, user: creds.user, pass: creds.pass });
        await device.init();
        await device.ptzStop();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/snapshot', async (req, res) => {
    const { url, user, pass } = req.body;
    try {
        const creds = resolveUserPass(user, pass);
        let device = new onvif.OnvifDevice({ xaddr: url, user: creds.user, pass: creds.pass });
        await device.init();
        const snapshotUrl = await device.fetchSnapshot();
        // device.fetchSnapshot() returns a buffer with the jpeg image
        res.set('Content-Type', 'image/jpeg');
        res.send(snapshotUrl);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

async function sendAuxiliaryCommand(device, profileToken, command) {
    if (!device?.services?.ptz?.xaddr) {
        throw new Error('PTZ service not available for auxiliary commands');
    }
    const soapBody = [
        '<tptz:SendAuxiliaryCommand>',
        `<tptz:ProfileToken>${profileToken}</tptz:ProfileToken>`,
        `<tptz:AuxiliaryData>${command}</tptz:AuxiliaryData>`,
        '</tptz:SendAuxiliaryCommand>'
    ].join('');

    const soap = onvifSoap.createRequestSoap({
        body: soapBody,
        xmlns: [
            'xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl"',
            'xmlns:tt="http://www.onvif.org/ver10/schema"'
        ],
        diff: device.time_diff || 0,
        user: device.user || '',
        pass: device.pass || ''
    });
    return onvifSoap.requestCommand(url.parse(device.services.ptz.xaddr), 'SendAuxiliaryCommand', soap);
}

router.post('/light/toggle', async (req, res) => {
    const { url: xaddr, user, pass, enabled } = req.body;
    if (!xaddr) {
        return res.status(400).json({ success: false, error: 'Falta url ONVIF de la cámara' });
    }

    try {
        const creds = resolveUserPass(user, pass);
        const device = new onvif.OnvifDevice({ xaddr, user: creds.user, pass: creds.pass });
        await device.init();

        const profileList = device.getProfileList() || [];
        const profileToken = profileList[0]?.token;
        if (!profileToken) {
            return res.status(400).json({ success: false, error: 'No se encontró ProfileToken ONVIF' });
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
        for (const cmd of candidates) {
            try {
                await sendAuxiliaryCommand(device, profileToken, cmd);
                return res.json({ success: true, enabled: !!enabled, command: cmd });
            } catch (e) {
                lastError = e;
            }
        }

        return res.status(400).json({
            success: false,
            error: 'La cámara no aceptó comandos ONVIF de luz/auxiliar',
            detail: lastError ? String(lastError.message || lastError) : null
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message || String(error) });
    }
});

module.exports = router;

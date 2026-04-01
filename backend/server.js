const express = require('express');
const cors = require('cors');
const path = require('path');
const cameraRoutes = require('./routes/camera');
const savedCamerasRoutes = require('./routes/saved-cameras');
const mapsRoutes = require('./routes/maps');
// const streamRoutes = require('./routes/stream'); // Removed in favor of centralized ws proxy
const WebSocket = require('ws');
const streamManager = require('./stream-manager');
const fs = require('fs');
const cameraEventMonitor = require('./camera-event-monitor');
const CameraConnectivityMonitor = require('./camera-connectivity-monitor');
const { resolveCameraStreamUrls, deriveCompanionRtsp, parseResolutionHint } = require('./rtsp-utils');

const app = express();
const PORT = process.env.PORT || 4000;
const DETECTOR_URL = 'http://localhost:5000';
const RECONSTRUCTOR_URL = (process.env.RECONSTRUCTOR_URL || 'http://localhost:5001').replace(/\/$/, '');
const CAMERA_FILE = path.join(__dirname, 'data', 'cameras.json');
const KEEPALIVE_SYNC_MS = Number(process.env.CAMERA_KEEPALIVE_SYNC_MS || 10000);

app.use(cors());
app.use(express.json());

function escLabel(v) {
    return String(v ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/"/g, '\\"');
}

function metricLine(name, labels, value) {
    const entries = Object.entries(labels || {}).filter(([, v]) => v !== null && v !== undefined && v !== '');
    const labelStr = entries.length
        ? `{${entries.map(([k, v]) => `${k}="${escLabel(v)}"`).join(',')}}`
        : '';
    return `${name}${labelStr} ${value}`;
}

function toNumOrNaN(v) {
    if (v === null || v === undefined || v === '') return NaN;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
}

function selectReconstructorPair(cam) {
    const { rtspUrl, allRtspUrls } = resolveCameraStreamUrls(cam);
    const labels = Array.isArray(cam?.sourceLabels) ? cam.sourceLabels : [];
    const raw = [];

    if ((cam?.type || 'single') === 'combined' || rtspUrl === 'combined') {
        raw.push(...allRtspUrls);
        if (rtspUrl && rtspUrl !== 'combined') raw.push(rtspUrl);
    } else {
        if (rtspUrl && rtspUrl !== 'combined') raw.push(rtspUrl);
        raw.push(...allRtspUrls);
    }

    const seen = new Set();
    const candidates = [];
    raw.forEach((url, index) => {
        if (!url) return;
        let nextUrl = url;
        if (seen.has(nextUrl)) {
            const companion = deriveCompanionRtsp(nextUrl);
            if (companion && !seen.has(companion)) nextUrl = companion;
        }
        if (!nextUrl || seen.has(nextUrl)) return;
        seen.add(nextUrl);
        const res = parseResolutionHint(labels[index] || '');
        candidates.push({
            url: nextUrl,
            index,
            pixels: res?.pixels ?? null
        });
    });

    if (candidates.length === 0) return null;
    const withRes = candidates.filter((c) => Number.isFinite(c.pixels));
    if (withRes.length > 0) {
        const main = [...withRes].sort((a, b) => b.pixels - a.pixels)[0];
        const sub = [...withRes].sort((a, b) => a.pixels - b.pixels)[0];
        return { id: cam.id, main: main.url, sub: sub.url };
    }
    const main = candidates[0].url;
    const sub = (candidates[1] && candidates[1].url) || deriveCompanionRtsp(main) || main;
    return { id: cam.id, main, sub };
}

function loadSavedCamerasSafe() {
    try {
        if (!fs.existsSync(CAMERA_FILE)) return [];
        const raw = JSON.parse(fs.readFileSync(CAMERA_FILE, 'utf8'));
        return Array.isArray(raw) ? raw : [];
    } catch (e) {
        console.error('[KEEPALIVE] Error leyendo cameras.json:', e?.message || e);
        return [];
    }
}

async function syncKeepaliveFromSavedCameras() {
    try {
        const cameras = loadSavedCamerasSafe();
        const configs = cameras.map((cam) => {
            const urls = resolveCameraStreamUrls(cam);
            return {
                id: cam.id,
                type: cam.type || 'single',
                rtspUrl: urls.rtspUrl,
                allRtspUrls: urls.allRtspUrls
            };
        });
        streamManager.syncKeepaliveConfigs(configs);

        const reconStreams = cameras
            .map((cam) => selectReconstructorPair(cam))
            .filter((v) => !!v && !!v.id && !!v.main && !!v.sub);
        try {
            await fetch(`${RECONSTRUCTOR_URL}/configure`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ streams: reconStreams, prune: true })
            });
        } catch (reconErr) {
            console.error('[RECON-SYNC] Error sincronizando sesiones de reconstructor:', reconErr?.message || reconErr);
        }
    } catch (e) {
        console.error('[KEEPALIVE] Sync error:', e?.message || e);
    }
}

// Routes
app.use('/api', cameraRoutes);
app.use('/api/saved-cameras', savedCamerasRoutes);
app.use('/api/maps', mapsRoutes);
// app.use('/api/stream', streamRoutes); // Removed

// Serve recordings as static files
app.use('/recordings', express.static('/app/recordings'));

// Detector proxy endpoints
app.get('/api/detector/status', async (req, res) => {
    try {
        const response = await fetch(`${DETECTOR_URL}/status`);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.json({ success: false, cameras: {}, error: 'Detector service not available' });
    }
});

app.get('/api/detector/events', async (req, res) => {
    try {
        const response = await fetch(`${DETECTOR_URL}/events`);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.json({ success: false, events: [] });
    }
});

app.get('/api/detector/recordings', async (req, res) => {
    try {
        const query = new URLSearchParams(req.query).toString();
        const suffix = query ? `?${query}` : '';
        const response = await fetch(`${DETECTOR_URL}/recordings${suffix}`);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.json({ success: false, recordings: [] });
    }
});

app.delete('/api/detector/recordings/:filename', async (req, res) => {
    try {
        const { filename } = req.params;
        const response = await fetch(`${DETECTOR_URL}/recordings/${filename}`, { method: 'DELETE' });
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.json({ success: false, error: 'Detector service not available' });
    }
});

// Camera-native ONVIF motion events
app.get('/api/camera-motion', (req, res) => {
    res.json({ success: true, cameras: cameraEventMonitor.getAll() });
});

app.get('/api/camera-motion/:id', (req, res) => {
    const { id } = req.params;
    res.json({ success: true, id, ...cameraEventMonitor.getMotion(id) });
});


const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend server running on http://0.0.0.0:${PORT}`);
});

cameraEventMonitor.start();
const connectivityMonitor = new CameraConnectivityMonitor({
    cameraFile: CAMERA_FILE,
    streamManager,
    cameraEventMonitor
});
connectivityMonitor.start();
setTimeout(() => {
    syncKeepaliveFromSavedCameras().catch((e) => {
        console.error('[SYNC] Initial sync error:', e?.message || e);
    });
}, 1500);
setInterval(() => {
    syncKeepaliveFromSavedCameras().catch((e) => {
        console.error('[SYNC] Periodic sync error:', e?.message || e);
    });
}, Math.max(3000, KEEPALIVE_SYNC_MS));

app.get('/api/monitoring/connectivity', (req, res) => {
    try {
        res.json(connectivityMonitor.getSnapshot());
    } catch (error) {
        res.status(500).json({ success: false, error: error.message || String(error) });
    }
});

app.post('/api/monitoring/probe', async (req, res) => {
    try {
        const snapshot = await connectivityMonitor.forceProbe();
        res.json(snapshot);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message || String(error) });
    }
});

app.get('/metrics', (req, res) => {
    try {
        const snap = connectivityMonitor.getSnapshot();
        const lines = [];

        lines.push('# HELP ipcam_monitor_cameras_total Total cameras under connectivity monitor');
        lines.push('# TYPE ipcam_monitor_cameras_total gauge');
        lines.push(`ipcam_monitor_cameras_total ${snap?.summary?.cameras ?? 0}`);
        lines.push('# HELP ipcam_monitor_online_total Cameras currently online');
        lines.push('# TYPE ipcam_monitor_online_total gauge');
        lines.push(`ipcam_monitor_online_total ${snap?.summary?.online ?? 0}`);
        lines.push('# HELP ipcam_monitor_offline_total Cameras currently offline');
        lines.push('# TYPE ipcam_monitor_offline_total gauge');
        lines.push(`ipcam_monitor_offline_total ${snap?.summary?.offline ?? 0}`);

        lines.push('# HELP ipcam_monitor_running Whether monitor probe cycle is currently running');
        lines.push('# TYPE ipcam_monitor_running gauge');
        lines.push(`ipcam_monitor_running ${snap?.running ? 1 : 0}`);
        lines.push('# HELP ipcam_monitor_last_probe_duration_ms Last full probe cycle duration in milliseconds');
        lines.push('# TYPE ipcam_monitor_last_probe_duration_ms gauge');
        lines.push(`ipcam_monitor_last_probe_duration_ms ${Number.isFinite(Number(snap?.lastProbeDurationMs)) ? Number(snap.lastProbeDurationMs) : 'NaN'}`);
        lines.push('# HELP ipcam_monitor_updated_at_seconds Last monitor update epoch timestamp');
        lines.push('# TYPE ipcam_monitor_updated_at_seconds gauge');
        lines.push(`ipcam_monitor_updated_at_seconds ${snap?.updatedAt ? (snap.updatedAt / 1000).toFixed(3) : 'NaN'}`);

        lines.push('# HELP ipcam_camera_up Camera connectivity status (1 up, 0 down)');
        lines.push('# TYPE ipcam_camera_up gauge');
        lines.push('# HELP ipcam_camera_latency_ms First valid frame latency in milliseconds');
        lines.push('# TYPE ipcam_camera_latency_ms gauge');
        lines.push('# HELP ipcam_camera_input_kbps Estimated input bitrate in kbps');
        lines.push('# TYPE ipcam_camera_input_kbps gauge');
        lines.push('# HELP ipcam_camera_decode_health_percent Decode health score percent');
        lines.push('# TYPE ipcam_camera_decode_health_percent gauge');
        lines.push('# HELP ipcam_camera_ws_output_kbps Output websocket bitrate in kbps');
        lines.push('# TYPE ipcam_camera_ws_output_kbps gauge');
        lines.push('# HELP ipcam_camera_ws_clients Current websocket clients');
        lines.push('# TYPE ipcam_camera_ws_clients gauge');
        lines.push('# HELP ipcam_camera_ws_restarts_total Stream restarts total');
        lines.push('# TYPE ipcam_camera_ws_restarts_total gauge');
        lines.push('# HELP ipcam_camera_ws_stalls_total Stream stalls total');
        lines.push('# TYPE ipcam_camera_ws_stalls_total gauge');
        lines.push('# HELP ipcam_camera_keepalive_desired Camera keepalive desired state (1/0)');
        lines.push('# TYPE ipcam_camera_keepalive_desired gauge');
        lines.push('# HELP ipcam_camera_keepalive_active Camera keepalive active state (1/0)');
        lines.push('# TYPE ipcam_camera_keepalive_active gauge');
        lines.push('# HELP ipcam_camera_keepalive_restarts_total Camera keepalive restarts total');
        lines.push('# TYPE ipcam_camera_keepalive_restarts_total gauge');
        lines.push('# HELP ipcam_camera_keepalive_last_byte_seconds Camera keepalive last byte epoch timestamp');
        lines.push('# TYPE ipcam_camera_keepalive_last_byte_seconds gauge');
        lines.push('# HELP ipcam_camera_motion_active Camera motion active (1/0)');
        lines.push('# TYPE ipcam_camera_motion_active gauge');
        lines.push('# HELP ipcam_camera_last_check_seconds Camera probe check epoch timestamp');
        lines.push('# TYPE ipcam_camera_last_check_seconds gauge');
        lines.push('# HELP ipcam_camera_selected_source_index Selected source index currently used by aggregate camera health');
        lines.push('# TYPE ipcam_camera_selected_source_index gauge');
        lines.push('# HELP ipcam_camera_availability_score Camera availability score (0 down, 1 degraded, 2 up)');
        lines.push('# TYPE ipcam_camera_availability_score gauge');
        lines.push('# HELP ipcam_camera_degraded Camera is degraded (1/0)');
        lines.push('# TYPE ipcam_camera_degraded gauge');

        lines.push('# HELP ipcam_camera_source_up Source-channel connectivity status (1 up, 0 down)');
        lines.push('# TYPE ipcam_camera_source_up gauge');
        lines.push('# HELP ipcam_camera_source_availability_score Source-channel availability score (0 down, 1 degraded, 2 up)');
        lines.push('# TYPE ipcam_camera_source_availability_score gauge');
        lines.push('# HELP ipcam_camera_source_degraded Source-channel degraded state (1/0)');
        lines.push('# TYPE ipcam_camera_source_degraded gauge');
        lines.push('# HELP ipcam_camera_source_latency_ms First valid frame latency in milliseconds per source channel');
        lines.push('# TYPE ipcam_camera_source_latency_ms gauge');
        lines.push('# HELP ipcam_camera_source_input_kbps Estimated input bitrate in kbps per source channel');
        lines.push('# TYPE ipcam_camera_source_input_kbps gauge');
        lines.push('# HELP ipcam_camera_source_decode_health_percent Decode health score percent per source channel');
        lines.push('# TYPE ipcam_camera_source_decode_health_percent gauge');
        lines.push('# HELP ipcam_camera_source_fps Frames per second per source channel');
        lines.push('# TYPE ipcam_camera_source_fps gauge');
        lines.push('# HELP ipcam_camera_source_width_px Source channel frame width in pixels');
        lines.push('# TYPE ipcam_camera_source_width_px gauge');
        lines.push('# HELP ipcam_camera_source_height_px Source channel frame height in pixels');
        lines.push('# TYPE ipcam_camera_source_height_px gauge');
        lines.push('# HELP ipcam_camera_source_last_check_seconds Source channel probe check epoch timestamp');
        lines.push('# TYPE ipcam_camera_source_last_check_seconds gauge');
        lines.push('# HELP ipcam_camera_source_info Source channel static info as labels (value always 1)');
        lines.push('# TYPE ipcam_camera_source_info gauge');

        const cameras = snap?.cameras || [];
        cameras.forEach((cam) => {
            const last = cam?.last || {};
            const labels = {
                camera_id: cam?.id,
                camera_name: cam?.name,
                camera_type: cam?.type,
                transport: last?.transport || 'unknown'
            };

            lines.push(metricLine('ipcam_camera_up', labels, last?.up ? 1 : 0));
            lines.push(metricLine('ipcam_camera_latency_ms', labels, Number.isFinite(toNumOrNaN(last?.latencyMs)) ? toNumOrNaN(last?.latencyMs) : 'NaN'));
            lines.push(metricLine('ipcam_camera_input_kbps', labels, Number.isFinite(toNumOrNaN(last?.inputKbps)) ? toNumOrNaN(last?.inputKbps) : 'NaN'));
            lines.push(metricLine('ipcam_camera_decode_health_percent', labels, Number.isFinite(toNumOrNaN(last?.decodeHealth)) ? toNumOrNaN(last?.decodeHealth) : 'NaN'));
            lines.push(metricLine('ipcam_camera_ws_output_kbps', labels, Number.isFinite(toNumOrNaN(last?.ws?.outputKbps)) ? toNumOrNaN(last?.ws?.outputKbps) : 0));
            lines.push(metricLine('ipcam_camera_ws_clients', labels, Number.isFinite(toNumOrNaN(last?.ws?.clients)) ? toNumOrNaN(last?.ws?.clients) : 0));
            lines.push(metricLine('ipcam_camera_ws_restarts_total', labels, Number.isFinite(toNumOrNaN(last?.ws?.restarts)) ? toNumOrNaN(last?.ws?.restarts) : 0));
            lines.push(metricLine('ipcam_camera_ws_stalls_total', labels, Number.isFinite(toNumOrNaN(last?.ws?.stalls)) ? toNumOrNaN(last?.ws?.stalls) : 0));
            lines.push(metricLine('ipcam_camera_keepalive_desired', labels, last?.ws?.keepalive?.desired ? 1 : 0));
            lines.push(metricLine('ipcam_camera_keepalive_active', labels, last?.ws?.keepalive?.active ? 1 : 0));
            lines.push(metricLine('ipcam_camera_keepalive_restarts_total', labels, Number.isFinite(toNumOrNaN(last?.ws?.keepalive?.restarts)) ? toNumOrNaN(last?.ws?.keepalive?.restarts) : 0));
            lines.push(metricLine('ipcam_camera_keepalive_last_byte_seconds', labels, last?.ws?.keepalive?.lastByteAt ? (last.ws.keepalive.lastByteAt / 1000).toFixed(3) : 'NaN'));
            lines.push(metricLine('ipcam_camera_motion_active', labels, last?.motion?.active ? 1 : 0));
            lines.push(metricLine('ipcam_camera_last_check_seconds', labels, last?.checkedAt ? (last.checkedAt / 1000).toFixed(3) : 'NaN'));
            lines.push(metricLine('ipcam_camera_selected_source_index', labels, Number.isFinite(toNumOrNaN(last?.selectedSourceIndex)) ? toNumOrNaN(last?.selectedSourceIndex) : 'NaN'));
            lines.push(metricLine('ipcam_camera_availability_score', labels, Number.isFinite(toNumOrNaN(last?.availabilityScore)) ? toNumOrNaN(last?.availabilityScore) : (last?.up ? 2 : 0)));
            lines.push(metricLine('ipcam_camera_degraded', labels, last?.availability === 'degraded' ? 1 : 0));

            const sources = Array.isArray(cam?.sources) ? cam.sources : [];
            sources.forEach((src) => {
                const sourceLast = src?.last || {};
                const sourceLabels = {
                    camera_id: cam?.id,
                    camera_name: cam?.name,
                    camera_type: cam?.type,
                    source_id: src?.id,
                    source_index: src?.index,
                    source_name: src?.name,
                    transport: sourceLast?.transport || 'unknown'
                };

                lines.push(metricLine('ipcam_camera_source_up', sourceLabels, sourceLast?.up ? 1 : 0));
                lines.push(metricLine('ipcam_camera_source_availability_score', sourceLabels, Number.isFinite(toNumOrNaN(sourceLast?.availabilityScore)) ? toNumOrNaN(sourceLast?.availabilityScore) : (sourceLast?.up ? 2 : 0)));
                lines.push(metricLine('ipcam_camera_source_degraded', sourceLabels, sourceLast?.availability === 'degraded' ? 1 : 0));
                lines.push(metricLine('ipcam_camera_source_latency_ms', sourceLabels, Number.isFinite(toNumOrNaN(sourceLast?.latencyMs)) ? toNumOrNaN(sourceLast?.latencyMs) : 'NaN'));
                lines.push(metricLine('ipcam_camera_source_input_kbps', sourceLabels, Number.isFinite(toNumOrNaN(sourceLast?.inputKbps)) ? toNumOrNaN(sourceLast?.inputKbps) : 'NaN'));
                lines.push(metricLine('ipcam_camera_source_decode_health_percent', sourceLabels, Number.isFinite(toNumOrNaN(sourceLast?.decodeHealth)) ? toNumOrNaN(sourceLast?.decodeHealth) : 'NaN'));
                lines.push(metricLine('ipcam_camera_source_fps', sourceLabels, Number.isFinite(toNumOrNaN(sourceLast?.fps)) ? toNumOrNaN(sourceLast?.fps) : 'NaN'));
                lines.push(metricLine('ipcam_camera_source_width_px', sourceLabels, Number.isFinite(toNumOrNaN(sourceLast?.width)) ? toNumOrNaN(sourceLast?.width) : 'NaN'));
                lines.push(metricLine('ipcam_camera_source_height_px', sourceLabels, Number.isFinite(toNumOrNaN(sourceLast?.height)) ? toNumOrNaN(sourceLast?.height) : 'NaN'));
                lines.push(metricLine('ipcam_camera_source_last_check_seconds', sourceLabels, sourceLast?.checkedAt ? (sourceLast.checkedAt / 1000).toFixed(3) : 'NaN'));
                lines.push(metricLine('ipcam_camera_source_info', {
                    ...sourceLabels,
                    codec: sourceLast?.codec || 'unknown',
                    source_url: src?.sourceUrl || 'unknown'
                }, 1));
            });
        });

        res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.send(`${lines.join('\n')}\n`);
    } catch (error) {
        res.status(500).send(`# metrics_error ${escLabel(error.message || String(error))}\n`);
    }
});

// WebSocket Server for Streams
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
    const url = req.url;
    // Format: /stream/:id
    const match = url.match(/\/stream\/([^\/]+)/);
    
    if (match) {
        const cameraId = match[1];
        
        // Find cámara RTSP URL in cameras.json
        if (!fs.existsSync(CAMERA_FILE)) {
            console.error('[WS] cameras.json no existe');
            ws.close();
            return;
        }

        try {
            const cameras = JSON.parse(fs.readFileSync(CAMERA_FILE, 'utf8'));
            const cam = cameras.find(c => c.id === cameraId);

            if (!cam) {
                console.error(`[WS] Cámara no encontrada: ${cameraId}`);
                ws.close();
                return;
            }

            const { rtspUrl, allRtspUrls } = resolveCameraStreamUrls(cam);
            streamManager.handleConnection(ws, cameraId, rtspUrl, cam.type, allRtspUrls);
        } catch (e) {
            console.error('[WS] Error cargando cámaras:', e?.message || e);
            ws.close();
        }
    } else {
        ws.close();
    }
});

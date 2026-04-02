const express = require('express');
const cors = require('cors');
const path = require('path');
const { randomUUID } = require('crypto');
const cameraRoutes = require('./routes/camera');
const savedCamerasRoutes = require('./routes/saved-cameras');
const mapsRoutes = require('./routes/maps');
const detectorRoutes = require('./routes/detector');
const { createMonitoringApiRouter, createMetricsRouter } = require('./routes/monitoring');
// const streamRoutes = require('./routes/stream'); // Removed in favor of centralized ws proxy
const WebSocket = require('ws');
const streamManager = require('./stream-manager');
const fs = require('fs');
const cameraEventMonitor = require('./camera-event-monitor');
const CameraConnectivityMonitor = require('./camera-connectivity-monitor');
const { resolveCameraStreamUrls, deriveCompanionRtsp, parseResolutionHint } = require('./rtsp-utils');
const { loadSchemaSummaries } = require('./src/contracts/schema-registry');
const { ConnectivityMonitoringService } = require('./src/domains/monitoring/connectivity-monitoring-service');

const app = express();
const PORT = process.env.PORT || 4000;
const RECONSTRUCTOR_URL = (process.env.RECONSTRUCTOR_URL || 'http://localhost:5001').replace(/\/$/, '');
const CAMERA_FILE = path.join(__dirname, 'data', 'cameras.json');
const KEEPALIVE_SYNC_MS = Number(process.env.CAMERA_KEEPALIVE_SYNC_MS || 10000);

app.use(cors());
app.use(express.json());

function resolveCorrelationId(req) {
    const headerValue = req.get('x-correlation-id');
    if (typeof headerValue === 'string' && headerValue.trim()) {
        return headerValue.trim().slice(0, 128);
    }
    return randomUUID();
}

app.use((req, res, next) => {
    req.correlationId = resolveCorrelationId(req);
    res.set('x-correlation-id', req.correlationId);
    next();
});

app.use((req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (payload) => {
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
            if (!Object.prototype.hasOwnProperty.call(payload, 'correlationId')) {
                payload.correlationId = req.correlationId;
            }
        }
        return originalJson(payload);
    };
    next();
});

const connectivityMonitor = new CameraConnectivityMonitor({
    cameraFile: CAMERA_FILE,
    streamManager,
    cameraEventMonitor
});
const monitoringService = new ConnectivityMonitoringService({ connectivityMonitor });

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
app.get('/api/contracts', (req, res) => {
    const schemas = loadSchemaSummaries().map((schema) => {
        const { filePath, ...safe } = schema;
        return safe;
    });
    const invalidSchemas = schemas.filter((schema) => !schema.ok).length;
    res.json({
        success: true,
        schemaCount: schemas.length,
        invalidSchemas,
        schemas
    });
});
app.use('/api/contracts/schemas', express.static(path.join(__dirname, 'contracts', 'schemas')));

app.use('/api', cameraRoutes);
app.use('/api/saved-cameras', savedCamerasRoutes);
app.use('/api/maps', mapsRoutes);
app.use('/api/detector', detectorRoutes);
app.use('/api/monitoring', createMonitoringApiRouter({ monitoringService }));
app.use('/', createMetricsRouter({ monitoringService }));
// app.use('/api/stream', streamRoutes); // Removed

// Serve recordings as static files
app.use('/recordings', express.static('/app/recordings'));

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

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
const { StreamSyncOrchestrator } = require('./src/domains/streams/stream-sync-orchestrator');

const app = express();
const PORT = process.env.PORT || 4000;
const CAMERA_FILE = path.join(__dirname, 'data', 'cameras.json');

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
const streamSyncOrchestrator = new StreamSyncOrchestrator({
    cameraFile: CAMERA_FILE,
    streamManager,
    resolveCameraStreamUrls,
    deriveCompanionRtsp,
    parseResolutionHint
});

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
streamSyncOrchestrator.start();

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

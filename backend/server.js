const express = require('express');
const cors = require('cors');
const path = require('path');
const cameraRoutes = require('./routes/camera');
const savedCamerasRoutes = require('./routes/saved-cameras');
// const streamRoutes = require('./routes/stream'); // Removed in favor of centralized ws proxy
const WebSocket = require('ws');
const streamManager = require('./stream-manager');
const fs = require('fs');
const cameraEventMonitor = require('./camera-event-monitor');

const app = express();
const PORT = process.env.PORT || 4000;
const DETECTOR_URL = 'http://localhost:5000';

app.use(cors());
app.use(express.json());

// Routes
app.use('/api', cameraRoutes);
app.use('/api/saved-cameras', savedCamerasRoutes);
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

// WebSocket Server for Streams
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
    const url = req.url;
    // Format: /stream/:id
    const match = url.match(/\/stream\/([^\/]+)/);
    
    if (match) {
        const cameraId = match[1];
        
        // Find cámara RTSP URL in cameras.json
        const camsPath = path.join(__dirname, 'data', 'cameras.json');
        if (fs.existsSync(camsPath)) {
            const cameras = JSON.parse(fs.readFileSync(camsPath, 'utf8'));
            const cam = cameras.find(c => c.id === cameraId);
            
            if (cam) {
                let rtspUrl = cam.rtspUrl;
                const camUser = cam.user || cam.username || 'admin';
                const camPass = cam.pass || cam.password || '';

                if (camPass && rtspUrl && !rtspUrl.includes('@')) {
                    rtspUrl = rtspUrl.replace('rtsp://', `rtsp://${camUser}:${camPass}@`);
                }
                
                // Also process allRtspUrls for combined streams
                let allRtspUrls = (cam.allRtspUrls || []).map(url => {
                    if (camPass && !url.includes('@')) {
                        return url.replace('rtsp://', `rtsp://${camUser}:${camPass}@`);
                    }
                    return url;
                });

                streamManager.handleConnection(ws, cameraId, rtspUrl, cam.type, allRtspUrls);
            } else {
                console.error(`[WS] Cámara no encontrada: ${cameraId}`);
                ws.close();
            }
        }
    } else {
        ws.close();
    }
});

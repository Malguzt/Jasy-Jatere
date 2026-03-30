const express = require('express');
const router = express.Router();
const Stream = require('node-rtsp-stream');
const { execSync } = require('child_process');

const isFFmpegInstalled = () => {
    try {
        execSync('ffmpeg -version', { stdio: 'ignore' });
        return true;
    } catch (e) {
        return false;
    }
};

const activeStreams = {};
let nextPort = 9999; 

router.post('/start', (req, res) => {
    const { rtspUrl, id, user, pass } = req.body;
    
    if (!rtspUrl || !id) {
        return res.status(400).json({ success: false, error: 'Faltan parámetros' });
    }

    if (!isFFmpegInstalled()) {
        return res.status(500).json({ success: false, error: 'FFmpeg no está instalado en tu sistema local. Ejecuta sudo apt install ffmpeg para solucionarlo.' });
    }

    if (activeStreams[id]) {
        return res.json({ success: true, wsPort: activeStreams[id].port, message: 'Stream ya activo' });
    }

    let finalUrl = rtspUrl;
    if (pass && !rtspUrl.includes('@')) {
        const effectiveUser = user || 'admin';
        finalUrl = rtspUrl.replace('rtsp://', `rtsp://${effectiveUser}:${pass}@`);
    }

    const port = nextPort++;
    
    try {
        const stream = new Stream({
            name: `cam-${id}`,
            streamUrl: finalUrl,
            wsPort: port,
            ffmpegOptions: {
                '-stats': '',
                '-r': 24,
                '-s': '640x360', 
                '-q:v': 5 
            }
        });

        activeStreams[id] = { stream, port };

        stream.on('exitWithError', () => {
             console.error(`Stream cam-${id} cerró con error`);
             delete activeStreams[id];
        });

        res.json({ success: true, wsPort: port });
    } catch (error) {
        console.error('Error starting stream:', error);
        res.status(500).json({ success: false, error: 'No se pudo iniciar ffmpeg' });
    }
});

router.post('/stop', (req, res) => {
    const { id } = req.body;
    if (activeStreams[id]) {
        activeStreams[id].stream.stop();
        delete activeStreams[id];
        return res.json({ success: true, message: 'Stream detenido' });
    }
    res.json({ success: true, message: 'No había stream activo' });
});

module.exports = router;

const express = require('express');
const router = express.Router();
const onvif = require('node-onvif');

router.get('/discover', async (req, res) => {
    try {
        console.log('Empezando descubrimiento de cámaras (WS-Discovery)...');
        const device_info_list = await onvif.startProbe();
        
        const friendlyList = device_info_list.map((info, idx) => ({
            id: idx,
            urn: info.urn,
            name: info.name,
            address: info.xaddrs[0], 
            hardware: info.hardware || 'Unknown'
        }));

        res.json({ success: true, devices: friendlyList, count: friendlyList.length });
    } catch (error) {
        console.error('Error descubriendo cámaras:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/connect', async (req, res) => {
    const { url, user, pass } = req.body;
    
    if (!url) {
        return res.status(400).json({ success: false, error: 'Se requiere la URL de la cámara (xaddrs)' });
    }

    try {
        let device = new onvif.OnvifDevice({
            xaddr: url,
            user: user || '',
            pass: pass || ''
        });

        await device.init();
        
        const profile_list = device.getProfileList();
        const ptz_support = device.services.ptz ? true : false;
        
        const profilesDetails = profile_list.map(profile => {
            const hasVideo = profile.video && profile.video.encoder;
            return {
                name: profile.name,
                token: profile.token,
                resolution: hasVideo ? `${profile.video.encoder.resolution.width}x${profile.video.encoder.resolution.height}` : 'Unknown',
                codec: hasVideo ? profile.video.encoder.encoding : 'Unknown',
                rtspUrl: device.getUdpStreamUrl(profile.token)
            };
        });

        const deviceInfo = device.getInformation() || {};

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
        let device = new onvif.OnvifDevice({ xaddr: url, user, pass });
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
        let device = new onvif.OnvifDevice({ xaddr: url, user, pass });
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
        let device = new onvif.OnvifDevice({ xaddr: url, user, pass });
        await device.init();
        const snapshotUrl = await device.fetchSnapshot();
        // device.fetchSnapshot() returns a buffer with the jpeg image
        res.set('Content-Type', 'image/jpeg');
        res.send(snapshotUrl);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

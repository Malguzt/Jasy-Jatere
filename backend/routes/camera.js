const express = require('express');
const router = express.Router();
const onvif = require('node-onvif');
const onvifSoap = require('node-onvif/lib/modules/soap');
const url = require('url');

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
            let rtspUrl = device.getUdpStreamUrl(profile.token);
            
            // Inject credentials into URL if present
            if (user && pass && rtspUrl && !rtspUrl.includes('@')) {
                rtspUrl = rtspUrl.replace('rtsp://', `rtsp://${user}:${pass}@`);
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
        // Offer combined mode only when we have at least 2 distinct RTSP URLs.
        const uniqueRtspUrls = [...new Set(profilesDetails.map((p) => p.rtspUrl).filter(Boolean))];
        console.log(`[ONVIF] Detectados ${profilesDetails.length} perfiles (${uniqueRtspUrls.length} URLs RTSP únicas) para ${url}`);
        if (uniqueRtspUrls.length >= 2) {
            console.log(`[ONVIF] Inyectando perfil sintético Combined AI para ${url}`);
            profilesDetails.push({
                name: 'Combined AI Stream (Specialized)',
                token: 'combined_ai',
                resolution: '1280x720 (Optimized)',
                codec: 'H.264',
                rtspUrl: 'combined' // Special keyword for the backend
            });
        } else {
            console.log(`[ONVIF] No se inyecta Combined AI para ${url}: la cámara expone una sola URL RTSP útil.`);
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
        const device = new onvif.OnvifDevice({ xaddr, user: user || '', pass: pass || '' });
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

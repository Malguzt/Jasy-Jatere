const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const dataFile = path.join(__dirname, '../data/cameras.json');

router.get('/', (req, res) => {
    try {
        if (!fs.existsSync(dataFile)) return res.json({ success: true, cameras: [] });
        const data = fs.readFileSync(dataFile, 'utf8');
        res.json({ success: true, cameras: JSON.parse(data) });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Database read error' });
    }
});

router.post('/', (req, res) => {
    const { name, rtspUrl, ip, user, pass } = req.body;
    if (!rtspUrl) return res.status(400).json({ success: false, error: 'rtspUrl es necesario' });

    try {
        let cameras = [];
        if (fs.existsSync(dataFile)) {
            cameras = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
        }
        
        const newCamera = {
            id: Date.now().toString(),
            name: name || 'Cámara Sin Nombre',
            rtspUrl,
            allRtspUrls: req.body.allRtspUrls || [], // Support for combined streams
            type: req.body.type || 'single',        // Type flag
            ip,
            user,
            pass,
            wsPort: null
        };

        cameras.push(newCamera);
        fs.writeFileSync(dataFile, JSON.stringify(cameras, null, 2));
        res.json({ success: true, camera: newCamera });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error guardando cámara' });
    }
});

router.delete('/:id', (req, res) => {
    try {
        if (fs.existsSync(dataFile)) {
            let cameras = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
            cameras = cameras.filter(cam => cam.id !== req.params.id);
            fs.writeFileSync(dataFile, JSON.stringify(cameras, null, 2));
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error borrando cámara' });
    }
});

router.patch('/:id', (req, res) => {
    const { user, pass, name } = req.body;
    try {
        if (!fs.existsSync(dataFile)) return res.status(404).json({ success: false, error: 'Database not found' });
        
        let data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
        const index = data.findIndex(cam => cam.id === req.params.id);
        
        if (index === -1) return res.status(404).json({ success: false, error: 'Camera not found' });
        
        if (user !== undefined) data[index].user = user;
        if (pass !== undefined) data[index].pass = pass;
        if (name !== undefined) data[index].name = name;
        
        fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
        res.json({ success: true, camera: data[index] });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error updating camera' });
    }
});

module.exports = router;

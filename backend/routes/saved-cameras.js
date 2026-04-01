const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { validateCameraRtspPayload } = require('../rtsp-validator');
const { resolveCameraCredentials } = require('../camera-credentials');

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
        const creds = resolveCameraCredentials({ user, pass });
        const type = req.body.type || 'single';
        const sourceLabels = Array.isArray(req.body.sourceLabels) ? req.body.sourceLabels : [];
        const payloadForValidation = {
            type,
            rtspUrl,
            allRtspUrls: Array.isArray(req.body.allRtspUrls) ? req.body.allRtspUrls : [],
            user: creds.user,
            pass: creds.pass
        };

        validateCameraRtspPayload(payloadForValidation)
            .then((validation) => {
                const newCamera = {
                    id: Date.now().toString(),
                    name: name || 'Cámara Sin Nombre',
                    rtspUrl,
                    allRtspUrls: payloadForValidation.allRtspUrls,
                    sourceLabels,
                    type,
                    ip,
                    user: creds.user,
                    pass: creds.pass,
                    wsPort: null,
                    validation: {
                        checkedAt: Date.now(),
                        ok: !!validation.ok,
                        errors: validation.errors || [],
                        checks: validation.checks,
                        warnings: validation.warnings || []
                    }
                };

                cameras.push(newCamera);
                fs.writeFileSync(dataFile, JSON.stringify(cameras, null, 2));
                return res.json({
                    success: true,
                    camera: newCamera,
                    validation,
                    acceptedWithIssues: !validation.ok
                });
            })
            .catch((error) => {
                const newCamera = {
                    id: Date.now().toString(),
                    name: name || 'Cámara Sin Nombre',
                    rtspUrl,
                    allRtspUrls: payloadForValidation.allRtspUrls,
                    sourceLabels,
                    type,
                    ip,
                    user: creds.user,
                    pass: creds.pass,
                    wsPort: null,
                    validation: {
                        checkedAt: Date.now(),
                        ok: false,
                        errors: [`No se pudo validar RTSP: ${error.message || String(error)}`],
                        checks: [],
                        warnings: []
                    }
                };
                cameras.push(newCamera);
                fs.writeFileSync(dataFile, JSON.stringify(cameras, null, 2));
                return res.json({
                    success: true,
                    camera: newCamera,
                    validation: newCamera.validation,
                    acceptedWithIssues: true
                });
            });
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

        const next = { ...data[index] };
        if (user !== undefined) next.user = user;
        if (pass !== undefined) next.pass = pass;
        if (name !== undefined) next.name = name;
        if (req.body.rtspUrl !== undefined) next.rtspUrl = req.body.rtspUrl;
        if (req.body.type !== undefined) next.type = req.body.type;
        if (req.body.allRtspUrls !== undefined) {
            next.allRtspUrls = Array.isArray(req.body.allRtspUrls) ? req.body.allRtspUrls : [];
        }
        if (req.body.sourceLabels !== undefined) {
            next.sourceLabels = Array.isArray(req.body.sourceLabels) ? req.body.sourceLabels : [];
        }

        const rtspShapeChanged =
            req.body.rtspUrl !== undefined ||
            req.body.type !== undefined ||
            req.body.allRtspUrls !== undefined;

        const shouldValidate = !!rtspShapeChanged;
        const applyAndSave = (validation = null) => {
            if (validation) {
                next.validation = {
                    checkedAt: Date.now(),
                    ok: validation.ok === undefined ? true : !!validation.ok,
                    errors: validation.errors || [],
                    checks: validation.checks,
                    warnings: validation.warnings || []
                };
            }
            data[index] = next;
            fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
            return res.json({
                success: true,
                camera: data[index],
                validation,
                acceptedWithIssues: !!validation && validation.ok === false
            });
        };

        if (!shouldValidate) {
            return applyAndSave(null);
        }

        const payloadForValidation = {
            type: next.type || 'single',
            rtspUrl: next.rtspUrl,
            allRtspUrls: Array.isArray(next.allRtspUrls) ? next.allRtspUrls : [],
            user: next.user,
            pass: next.pass
        };

        return validateCameraRtspPayload(payloadForValidation)
            .then((validation) => {
                next.validation = {
                    checkedAt: Date.now(),
                    ok: !!validation.ok,
                    errors: validation.errors || [],
                    checks: validation.checks,
                    warnings: validation.warnings || []
                };
                return applyAndSave(validation);
            })
            .catch((error) => {
                next.validation = {
                    checkedAt: Date.now(),
                    ok: false,
                    errors: [`No se pudo validar RTSP: ${error.message || String(error)}`],
                    checks: [],
                    warnings: []
                };
                return applyAndSave(next.validation);
            });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error updating camera' });
    }
});

module.exports = router;

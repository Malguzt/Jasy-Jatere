const express = require('express');
const { validateBody } = require('../src/contracts/validator');
const { badRequest, internalError } = require('../src/http/respond');
const { OnvifCameraService } = require('../src/domains/cameras/onvif-camera-service');

function sendCameraError(res, error, fallbackMessage) {
    const message = error?.message || fallbackMessage || 'Unexpected camera error';
    const details = error?.details;
    if (Number(error?.status) === 400) {
        return badRequest(res, { error: message, details });
    }
    return internalError(res, { error: message, details });
}

function createCameraRouter({ cameraService = new OnvifCameraService() } = {}) {
    const router = express.Router();

    router.get('/discover', async (req, res) => {
        try {
            const discovery = await cameraService.discover();
            return res.json({
                success: true,
                ...discovery
            });
        } catch (error) {
            return sendCameraError(res, error, 'Error descubriendo cámaras');
        }
    });

    router.post('/connect', validateBody('jasy-jatere/contracts/camera-connect-request/v1'), async (req, res) => {
        try {
            const result = await cameraService.connect(req.body || {});
            return res.json({
                success: true,
                ...result
            });
        } catch (error) {
            return sendCameraError(res, error, 'Error de conexión');
        }
    });

    router.post('/ptz/move', validateBody('jasy-jatere/contracts/ptz-move-request/v1'), async (req, res) => {
        try {
            await cameraService.movePtz(req.body || {});
            return res.json({ success: true });
        } catch (error) {
            return sendCameraError(res, error, 'Error moviendo PTZ');
        }
    });

    router.post('/ptz/stop', validateBody('jasy-jatere/contracts/ptz-stop-request/v1'), async (req, res) => {
        try {
            await cameraService.stopPtz(req.body || {});
            return res.json({ success: true });
        } catch (error) {
            return sendCameraError(res, error, 'Error deteniendo PTZ');
        }
    });

    router.post('/snapshot', validateBody('jasy-jatere/contracts/snapshot-request/v1'), async (req, res) => {
        try {
            const imageBuffer = await cameraService.snapshot(req.body || {});
            res.set('Content-Type', 'image/jpeg');
            return res.send(imageBuffer);
        } catch (error) {
            return sendCameraError(res, error, 'Error obteniendo snapshot');
        }
    });

    router.post('/light/toggle', validateBody('jasy-jatere/contracts/light-toggle-request/v1'), async (req, res) => {
        try {
            const result = await cameraService.toggleLight(req.body || {});
            return res.json({ success: true, ...result });
        } catch (error) {
            return sendCameraError(res, error, 'Error enviando comando de luz');
        }
    });

    return router;
}

const defaultRouter = createCameraRouter();

module.exports = defaultRouter;
module.exports.createCameraRouter = createCameraRouter;

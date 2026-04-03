const express = require('express');
const { validateBody } = require('../src/contracts/validator');
const { badRequest, notFound, internalError } = require('../src/http/respond');

function sendSavedCameraError(res, error, fallbackMessage) {
    const message = error?.message || fallbackMessage || 'Unexpected saved-cameras error';
    const details = error?.details;
    if (Number(error?.status) === 400) {
        return badRequest(res, { error: message, details });
    }
    if (Number(error?.status) === 404) {
        return notFound(res, { error: message, details });
    }
    return internalError(res, { error: message, details });
}

function createSavedCamerasRouter({ savedCamerasService }) {
    const router = express.Router();

    router.get('/', (req, res) => {
        try {
            return res.json({ success: true, cameras: savedCamerasService.listCameras() });
        } catch (error) {
            return sendSavedCameraError(res, error, 'Database read error');
        }
    });

    router.post('/', validateBody('jasy-jatere/contracts/saved-camera-create-request/v1'), async (req, res) => {
        try {
            const result = await savedCamerasService.createCamera(req.body || {});
            return res.json({ success: true, ...result });
        } catch (error) {
            return sendSavedCameraError(res, error, 'Error guardando cámara');
        }
    });

    router.delete('/:id', (req, res) => {
        try {
            savedCamerasService.deleteCamera(req.params.id);
            return res.json({ success: true });
        } catch (error) {
            return sendSavedCameraError(res, error, 'Error borrando cámara');
        }
    });

    router.patch('/:id', validateBody('jasy-jatere/contracts/saved-camera-patch-request/v1'), async (req, res) => {
        try {
            const result = await savedCamerasService.updateCamera(req.params.id, req.body || {});
            return res.json({ success: true, ...result });
        } catch (error) {
            return sendSavedCameraError(res, error, 'Error updating camera');
        }
    });

    return router;
}

module.exports = {
    createSavedCamerasRouter
};

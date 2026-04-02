const express = require('express');
const { internalError } = require('../src/http/respond');

function sendCameraMotionError(res, error, fallbackMessage) {
    return internalError(res, {
        error: error?.message || fallbackMessage || 'Unexpected camera motion error',
        details: error?.details
    });
}

function createCameraMotionRouter({ cameraMotionService }) {
    const router = express.Router();

    router.get('/', (req, res) => {
        try {
            return res.json({
                success: true,
                cameras: cameraMotionService.listMotionState()
            });
        } catch (error) {
            return sendCameraMotionError(res, error, 'Failed to read camera motion state');
        }
    });

    router.get('/:id', (req, res) => {
        try {
            return res.json({
                success: true,
                id: req.params.id,
                ...cameraMotionService.getMotionState(req.params.id)
            });
        } catch (error) {
            return sendCameraMotionError(res, error, 'Failed to read camera motion state');
        }
    });

    return router;
}

module.exports = {
    createCameraMotionRouter
};

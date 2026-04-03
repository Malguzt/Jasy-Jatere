const express = require('express');
const { internalError } = require('../src/http/respond');

function createInternalConfigRouter({ workerConfigService }) {
    const router = express.Router();

    router.get('/cameras', (req, res) => {
        try {
            const snapshot = workerConfigService.getCameraSnapshot();
            return res.json({ success: true, ...snapshot });
        } catch (error) {
            return internalError(res, {
                error: error?.message || 'Failed to build camera config snapshot',
                code: error?.code || 'CAMERA_CONFIG_FAILED'
            });
        }
    });

    router.get('/streams', async (req, res) => {
        try {
            const snapshot = await workerConfigService.getStreamSnapshot();
            return res.json({ success: true, ...snapshot });
        } catch (error) {
            return internalError(res, {
                error: error?.message || 'Failed to build stream config snapshot',
                code: error?.code || 'STREAM_CONFIG_FAILED'
            });
        }
    });

    router.get('/retention', (req, res) => {
        try {
            const snapshot = workerConfigService.getRetentionSnapshot();
            return res.json({ success: true, ...snapshot });
        } catch (error) {
            return internalError(res, {
                error: error?.message || 'Failed to build retention snapshot',
                code: error?.code || 'RETENTION_CONFIG_FAILED'
            });
        }
    });

    return router;
}

module.exports = {
    createInternalConfigRouter
};

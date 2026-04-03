const express = require('express');

function createDetectorRouter({ detectorProxyService }) {
    const router = express.Router();

    router.get('/status', async (req, res) => {
        const payload = await detectorProxyService.readStatus();
        return res.json(payload);
    });

    router.get('/events', async (req, res) => {
        const payload = await detectorProxyService.readEvents();
        return res.json(payload);
    });

    router.get('/recordings', (req, res) => {
        res.set('x-deprecated-endpoint', '/api/detector/recordings');
        res.set('x-replacement-endpoint', '/api/recordings');
        return res.status(410).json({
            success: false,
            error: 'Endpoint retired. Use /api/recordings',
            code: 'DETECTOR_RECORDINGS_ENDPOINT_RETIRED'
        });
    });

    router.delete('/recordings/:filename', (req, res) => {
        res.set('x-deprecated-endpoint', '/api/detector/recordings/:filename');
        res.set('x-replacement-endpoint', '/api/recordings/:filename');
        return res.status(410).json({
            success: false,
            error: 'Endpoint retired. Use /api/recordings/:filename',
            code: 'DETECTOR_RECORDING_DELETE_ENDPOINT_RETIRED'
        });
    });

    return router;
}

module.exports = {
    createDetectorRouter
};

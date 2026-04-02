const express = require('express');
const { DetectorProxyService } = require('../src/domains/perception/detector-proxy-service');
const { RecordingCatalogService } = require('../src/domains/recordings/recording-catalog-service');

const router = express.Router();
const detectorProxyService = new DetectorProxyService();
const recordingCatalogService = new RecordingCatalogService();

router.get('/status', async (req, res) => {
    const payload = await detectorProxyService.readStatus();
    return res.json(payload);
});

router.get('/events', async (req, res) => {
    const payload = await detectorProxyService.readEvents();
    return res.json(payload);
});

router.get('/recordings', async (req, res) => {
    try {
        const recordings = recordingCatalogService.listRecordings(req.query || {});
        return res.json({ success: true, recordings });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error?.message || 'Failed to load recordings'
        });
    }
});

router.delete('/recordings/:filename', async (req, res) => {
    try {
        const outcome = recordingCatalogService.removeRecording(req.params.filename);
        return res.json({ success: true, ...outcome });
    } catch (error) {
        return res.status(Number(error?.status) || 500).json({
            success: false,
            error: error?.message || 'Failed to delete recording'
        });
    }
});

module.exports = router;

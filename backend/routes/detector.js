const express = require('express');
const { DetectorProxyService } = require('../src/domains/perception/detector-proxy-service');

const router = express.Router();
const detectorProxyService = new DetectorProxyService();

router.get('/status', async (req, res) => {
    const payload = await detectorProxyService.readStatus();
    return res.json(payload);
});

router.get('/events', async (req, res) => {
    const payload = await detectorProxyService.readEvents();
    return res.json(payload);
});

router.get('/recordings', async (req, res) => {
    const payload = await detectorProxyService.listRecordings(req.query || {});
    return res.json(payload);
});

router.delete('/recordings/:filename', async (req, res) => {
    const payload = await detectorProxyService.deleteRecording(req.params.filename);
    return res.json(payload);
});

module.exports = router;

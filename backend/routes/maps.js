const express = require('express');
const { validateBody } = require('../src/contracts/validator');

function sendMapsError(res, error) {
    const status = Number(error?.status) || 500;
    const payload = {
        success: false,
        error: error?.message || String(error)
    };
    if (error?.code) payload.code = error.code;
    if (error?.details !== undefined) payload.details = error.details;
    return res.status(status).json(payload);
}

function createMapsRouter({ mapsService }) {
    const router = express.Router();

    router.get('/health', (req, res) => {
        try {
            return res.json({ success: true, ...mapsService.getHealth() });
        } catch (error) {
            return sendMapsError(res, error);
        }
    });

    router.post('/generate', validateBody('jasy-jatere/contracts/map-generate-request/v1'), (req, res) => {
        try {
            const job = mapsService.createGenerationJob(req.body || {});
            return res.status(202).json({
                success: true,
                job
            });
        } catch (error) {
            return sendMapsError(res, error);
        }
    });

    router.post('/manual', validateBody('jasy-jatere/contracts/map-manual-request/v1'), (req, res) => {
        try {
            const { map, summary } = mapsService.saveManualMap(req.body || {});
            return res.status(201).json({
                success: true,
                map,
                summary
            });
        } catch (error) {
            return sendMapsError(res, error);
        }
    });

    router.get('/corrections', (req, res) => {
        try {
            return res.json({ success: true, corrections: mapsService.getCorrections() });
        } catch (error) {
            return sendMapsError(res, error);
        }
    });

    router.get('/metrics', (req, res) => {
        try {
            return res.json({ success: true, ...mapsService.getMetrics() });
        } catch (error) {
            return sendMapsError(res, error);
        }
    });

    router.get('/jobs', (req, res) => {
        try {
            return res.json({ success: true, jobs: mapsService.listJobs(req.query.limit) });
        } catch (error) {
            return sendMapsError(res, error);
        }
    });

    router.get('/jobs/:jobId', (req, res) => {
        try {
            return res.json({ success: true, job: mapsService.getJob(req.params.jobId) });
        } catch (error) {
            return sendMapsError(res, error);
        }
    });

    router.post('/jobs/:jobId/cancel', (req, res) => {
        try {
            return res.json({ success: true, job: mapsService.cancelJob(req.params.jobId) });
        } catch (error) {
            return sendMapsError(res, error);
        }
    });

    router.post('/jobs/:jobId/retry', validateBody('jasy-jatere/contracts/map-retry-request/v1'), (req, res) => {
        try {
            const retried = mapsService.retryJob(req.params.jobId, req.body || {});
            return res.status(202).json({ success: true, job: retried });
        } catch (error) {
            return sendMapsError(res, error);
        }
    });

    router.get('/latest', (req, res) => {
        try {
            return res.json({ success: true, map: mapsService.getLatestMap() });
        } catch (error) {
            return sendMapsError(res, error);
        }
    });

    router.get('/history', (req, res) => {
        try {
            return res.json({ success: true, ...mapsService.getHistory() });
        } catch (error) {
            return sendMapsError(res, error);
        }
    });

    router.post('/:mapId/promote', (req, res) => {
        try {
            return res.json({ success: true, map: mapsService.promoteMap(req.params.mapId) });
        } catch (error) {
            return sendMapsError(res, error);
        }
    });

    router.get('/:mapId', (req, res) => {
        try {
            return res.json({ success: true, map: mapsService.getMap(req.params.mapId) });
        } catch (error) {
            return sendMapsError(res, error);
        }
    });

    return router;
}

module.exports = {
    createMapsRouter
};

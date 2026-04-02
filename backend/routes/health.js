const express = require('express');
const { internalError } = require('../src/http/respond');

function createHealthRouter({ platformHealthService }) {
    const router = express.Router();

    router.get('/live', (req, res) => {
        try {
            return res.json({
                success: true,
                liveness: platformHealthService.getLivenessSnapshot()
            });
        } catch (error) {
            return internalError(res, {
                error: error?.message || String(error)
            });
        }
    });

    router.get('/ready', (req, res) => {
        try {
            const readiness = platformHealthService.getReadinessSnapshot();
            return res.status(readiness.ready ? 200 : 503).json({
                success: readiness.ready,
                readiness
            });
        } catch (error) {
            return internalError(res, {
                error: error?.message || String(error)
            });
        }
    });

    router.get('/', (req, res) => {
        try {
            return res.json({
                success: true,
                health: platformHealthService.getHealthSnapshot()
            });
        } catch (error) {
            return internalError(res, {
                error: error?.message || String(error)
            });
        }
    });

    return router;
}

module.exports = {
    createHealthRouter
};

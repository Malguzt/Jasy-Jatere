const express = require('express');

function sendMonitoringJsonError(res, error) {
    const status = Number(error?.status) || 500;
    return res.status(status).json({
        success: false,
        error: error?.message || String(error)
    });
}

function createMonitoringApiRouter({ monitoringService }) {
    const router = express.Router();

    router.get('/connectivity', (req, res) => {
        try {
            return res.json(monitoringService.getConnectivitySnapshot());
        } catch (error) {
            return sendMonitoringJsonError(res, error);
        }
    });

    router.post('/probe', async (req, res) => {
        try {
            const snapshot = await monitoringService.forceConnectivityProbe();
            return res.json(snapshot);
        } catch (error) {
            return sendMonitoringJsonError(res, error);
        }
    });

    return router;
}

function createMetricsRouter({ monitoringService }) {
    const router = express.Router();

    router.get('/metrics', (req, res) => {
        try {
            const metricsText = monitoringService.renderPrometheusMetrics();
            res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
            return res.send(metricsText);
        } catch (error) {
            const payload = monitoringService.renderPrometheusError(error);
            return res.status(500).send(payload);
        }
    });

    return router;
}

module.exports = {
    createMonitoringApiRouter,
    createMetricsRouter
};

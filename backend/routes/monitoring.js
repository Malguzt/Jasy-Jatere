const express = require('express');
const { renderStreamRuntimePrometheusMetrics } = require('../src/domains/streams/stream-runtime-metrics');

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

function createMetricsRouter({ monitoringService, streamRuntimeService = null }) {
    const router = express.Router();

    router.get('/metrics', async (req, res) => {
        try {
            const metricsText = monitoringService.renderPrometheusMetrics();
            let streamMetricsText = '';
            if (streamRuntimeService && typeof streamRuntimeService.getRuntimeSnapshot === 'function') {
                const streamSnapshot = await streamRuntimeService.getRuntimeSnapshot();
                streamMetricsText = renderStreamRuntimePrometheusMetrics(streamSnapshot);
            }
            res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
            return res.send(`${metricsText}${streamMetricsText}`);
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

const express = require('express');
const { validateBody } = require('../src/contracts/validator');
const { badRequest, internalError } = require('../src/http/respond');

function sendStreamsError(res, error, fallbackMessage) {
    const message = error?.message || fallbackMessage || 'Unexpected streams error';
    const details = error?.details;
    const status = Number(error?.status) || 500;
    if (status === 400) {
        return badRequest(res, { error: message, details });
    }
    if (status >= 401 && status < 500) {
        return res.status(status).json({
            success: false,
            error: message,
            details
        });
    }
    if (status !== 500) {
        return res.status(status).json({
            success: false,
            error: message,
            details
        });
    }
    return internalError(res, { error: message, details });
}

function resolveStreamsService(streamControlService, streamControlProxyService) {
    return streamControlProxyService || streamControlService || null;
}

function createStreamsRouter({ streamControlService, streamControlProxyService = null }) {
    const router = express.Router();

    router.get('/capabilities', async (req, res) => {
        try {
            const service = resolveStreamsService(streamControlService, streamControlProxyService);
            if (!service || typeof service.getCapabilities !== 'function') {
                throw new Error('Streams capabilities service not configured');
            }
            const capabilities = await service.getCapabilities({
                requestHeaders: req.headers || {}
            });
            return res.json({
                success: true,
                capabilities
            });
        } catch (error) {
            return sendStreamsError(res, error, 'Failed to read stream capabilities');
        }
    });

    router.get('/runtime', async (req, res) => {
        try {
            const service = resolveStreamsService(streamControlService, streamControlProxyService);
            if (!service || typeof service.getRuntimeSnapshot !== 'function') {
                throw new Error('Streams service not configured');
            }
            const snapshot = await service.getRuntimeSnapshot();
            return res.json({
                success: true,
                ...snapshot
            });
        } catch (error) {
            return sendStreamsError(res, error, 'Failed to read stream runtime');
        }
    });

    router.post('/sync', validateBody('jasy-jatere/contracts/stream-sync-request/v1'), async (req, res) => {
        try {
            const service = resolveStreamsService(streamControlService, streamControlProxyService);
            if (!service || typeof service.triggerManualSync !== 'function') {
                throw new Error('Streams service not configured');
            }
            const manualSync = await service.triggerManualSync(req.body || {});
            return res.json({
                success: true,
                sync: manualSync
            });
        } catch (error) {
            return sendStreamsError(res, error, 'Failed to sync streams');
        }
    });

    return router;
}

module.exports = {
    createStreamsRouter
};

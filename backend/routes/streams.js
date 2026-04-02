const express = require('express');
const { validateBody } = require('../src/contracts/validator');
const { badRequest, internalError } = require('../src/http/respond');

function sendStreamsError(res, error, fallbackMessage) {
    const message = error?.message || fallbackMessage || 'Unexpected streams error';
    const details = error?.details;
    if (Number(error?.status) === 400) {
        return badRequest(res, { error: message, details });
    }
    return internalError(res, { error: message, details });
}

function createStreamsRouter({ streamControlService }) {
    const router = express.Router();

    router.get('/runtime', (req, res) => {
        try {
            const snapshot = streamControlService.getRuntimeSnapshot();
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
            const manualSync = await streamControlService.triggerManualSync(req.body || {});
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

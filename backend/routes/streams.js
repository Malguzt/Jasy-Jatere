const express = require('express');
const { validateBody } = require('../src/contracts/validator');
const { badRequest, internalError } = require('../src/http/respond');
const { renderStreamRuntimePrometheusMetrics } = require('../src/domains/streams/stream-runtime-metrics');

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

async function callStreamsServiceMethod({
    streamControlService,
    streamControlProxyService,
    method,
    args = [],
    missingServiceMessage
}) {
    const service = resolveStreamsService(streamControlService, streamControlProxyService);
    const handler = service && typeof service[method] === 'function' ? service[method] : null;
    if (!handler) {
        throw new Error(missingServiceMessage || `Streams service method is not configured: ${method}`);
    }
    return handler.apply(service, args);
}

function createStreamsRouter({ streamControlService, streamControlProxyService = null }) {
    const router = express.Router();

    router.get('/capabilities', async (req, res) => {
        try {
            const capabilities = await callStreamsServiceMethod({
                streamControlService,
                streamControlProxyService,
                method: 'getCapabilities',
                args: [{
                    requestHeaders: req.headers || {}
                }],
                missingServiceMessage: 'Streams capabilities service not configured'
            });
            return res.json({
                success: true,
                capabilities
            });
        } catch (error) {
            return sendStreamsError(res, error, 'Failed to read stream capabilities');
        }
    });

    router.get('/sessions/:cameraId', async (req, res) => {
        try {
            const session = await callStreamsServiceMethod({
                streamControlService,
                streamControlProxyService,
                method: 'getSessionDescriptor',
                args: [{
                    cameraId: req.params?.cameraId,
                    requestHeaders: req.headers || {}
                }],
                missingServiceMessage: 'Streams session service not configured'
            });
            return res.json({
                success: true,
                session
            });
        } catch (error) {
            return sendStreamsError(res, error, 'Failed to resolve stream session');
        }
    });

    router.get('/runtime', async (req, res) => {
        try {
            const snapshot = await callStreamsServiceMethod({
                streamControlService,
                streamControlProxyService,
                method: 'getRuntimeSnapshot',
                missingServiceMessage: 'Streams service not configured'
            });
            return res.json({
                success: true,
                ...snapshot
            });
        } catch (error) {
            return sendStreamsError(res, error, 'Failed to read stream runtime');
        }
    });

    router.get('/metrics', async (req, res) => {
        try {
            const snapshot = await callStreamsServiceMethod({
                streamControlService,
                streamControlProxyService,
                method: 'getRuntimeSnapshot',
                missingServiceMessage: 'Streams service not configured'
            });
            const metricsText = renderStreamRuntimePrometheusMetrics(snapshot);
            res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
            return res.send(metricsText);
        } catch (error) {
            return sendStreamsError(res, error, 'Failed to render stream runtime metrics');
        }
    });

    router.post('/webrtc/sessions', validateBody('jasy-jatere/contracts/stream-webrtc-session-create-request/v1'), async (req, res) => {
        try {
            const body = req.body || {};
            const offer = body.offer && typeof body.offer === 'object' ? body.offer : null;
            const session = await callStreamsServiceMethod({
                streamControlService,
                streamControlProxyService,
                method: 'createWebRtcSession',
                args: [{
                    cameraId: body.cameraId,
                    offerSdp: offer?.sdp || body.offerSdp,
                    offerType: offer?.type || body.offerType,
                    requestHeaders: req.headers || {}
                }],
                missingServiceMessage: 'Streams WebRTC session service not configured'
            });
            return res.json({
                success: true,
                session
            });
        } catch (error) {
            return sendStreamsError(res, error, 'Failed to create WebRTC session');
        }
    });

    router.post('/webrtc/sessions/:sessionId/candidates', validateBody('jasy-jatere/contracts/stream-webrtc-candidate-request/v1'), async (req, res) => {
        try {
            const body = req.body || {};
            const rawCandidate = body.candidate;
            const candidate = typeof rawCandidate === 'object' && rawCandidate
                ? rawCandidate.candidate
                : rawCandidate;
            const sdpMid = typeof rawCandidate === 'object' && rawCandidate ? rawCandidate.sdpMid : body.sdpMid;
            const sdpMLineIndex = typeof rawCandidate === 'object' && rawCandidate ? rawCandidate.sdpMLineIndex : body.sdpMLineIndex;
            const usernameFragment = typeof rawCandidate === 'object' && rawCandidate ? rawCandidate.usernameFragment : body.usernameFragment;

            const result = await callStreamsServiceMethod({
                streamControlService,
                streamControlProxyService,
                method: 'submitWebRtcCandidate',
                args: [{
                    sessionId: req.params?.sessionId,
                    cameraId: body.cameraId,
                    candidate,
                    sdpMid,
                    sdpMLineIndex,
                    usernameFragment,
                    requestHeaders: req.headers || {}
                }],
                missingServiceMessage: 'Streams WebRTC candidate service not configured'
            });
            return res.json({
                success: true,
                result
            });
        } catch (error) {
            return sendStreamsError(res, error, 'Failed to submit WebRTC ICE candidate');
        }
    });

    router.delete('/webrtc/sessions/:sessionId', validateBody('jasy-jatere/contracts/stream-webrtc-session-close-request/v1'), async (req, res) => {
        try {
            const body = req.body || {};
            const result = await callStreamsServiceMethod({
                streamControlService,
                streamControlProxyService,
                method: 'closeWebRtcSession',
                args: [{
                    sessionId: req.params?.sessionId,
                    cameraId: body.cameraId,
                    requestHeaders: req.headers || {}
                }],
                missingServiceMessage: 'Streams WebRTC close service not configured'
            });
            return res.json({
                success: true,
                result
            });
        } catch (error) {
            return sendStreamsError(res, error, 'Failed to close WebRTC session');
        }
    });

    router.post('/sync', validateBody('jasy-jatere/contracts/stream-sync-request/v1'), async (req, res) => {
        try {
            const manualSync = await callStreamsServiceMethod({
                streamControlService,
                streamControlProxyService,
                method: 'triggerManualSync',
                args: [req.body || {}],
                missingServiceMessage: 'Streams service not configured'
            });
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

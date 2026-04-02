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

    router.get('/sessions/:cameraId', async (req, res) => {
        try {
            const service = resolveStreamsService(streamControlService, streamControlProxyService);
            if (!service || typeof service.getSessionDescriptor !== 'function') {
                throw new Error('Streams session service not configured');
            }
            const session = await service.getSessionDescriptor({
                cameraId: req.params?.cameraId,
                requestHeaders: req.headers || {}
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

    router.post('/webrtc/sessions', validateBody('jasy-jatere/contracts/stream-webrtc-session-create-request/v1'), async (req, res) => {
        try {
            const service = resolveStreamsService(streamControlService, streamControlProxyService);
            if (!service || typeof service.createWebRtcSession !== 'function') {
                throw new Error('Streams WebRTC session service not configured');
            }
            const body = req.body || {};
            const offer = body.offer && typeof body.offer === 'object' ? body.offer : null;
            const session = await service.createWebRtcSession({
                cameraId: body.cameraId,
                offerSdp: offer?.sdp || body.offerSdp,
                offerType: offer?.type || body.offerType,
                requestHeaders: req.headers || {}
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
            const service = resolveStreamsService(streamControlService, streamControlProxyService);
            if (!service || typeof service.submitWebRtcCandidate !== 'function') {
                throw new Error('Streams WebRTC candidate service not configured');
            }
            const body = req.body || {};
            const rawCandidate = body.candidate;
            const candidate = typeof rawCandidate === 'object' && rawCandidate
                ? rawCandidate.candidate
                : rawCandidate;
            const sdpMid = typeof rawCandidate === 'object' && rawCandidate ? rawCandidate.sdpMid : body.sdpMid;
            const sdpMLineIndex = typeof rawCandidate === 'object' && rawCandidate ? rawCandidate.sdpMLineIndex : body.sdpMLineIndex;
            const usernameFragment = typeof rawCandidate === 'object' && rawCandidate ? rawCandidate.usernameFragment : body.usernameFragment;

            const result = await service.submitWebRtcCandidate({
                sessionId: req.params?.sessionId,
                cameraId: body.cameraId,
                candidate,
                sdpMid,
                sdpMLineIndex,
                usernameFragment,
                requestHeaders: req.headers || {}
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
            const service = resolveStreamsService(streamControlService, streamControlProxyService);
            if (!service || typeof service.closeWebRtcSession !== 'function') {
                throw new Error('Streams WebRTC close service not configured');
            }
            const body = req.body || {};
            const result = await service.closeWebRtcSession({
                sessionId: req.params?.sessionId,
                cameraId: body.cameraId,
                requestHeaders: req.headers || {}
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

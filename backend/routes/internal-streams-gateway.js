const express = require('express');
const { validateBody } = require('../src/contracts/validator');
const { renderStreamRuntimePrometheusMetrics } = require('../src/domains/streams/stream-runtime-metrics');

function sendGatewayError(res, error) {
    const status = Number(error?.status) || 500;
    return res.status(status).json({
        success: false,
        error: error?.message || String(error),
        details: error?.details
    });
}

function createInternalStreamsGatewayRouter({
    streamControlService,
    runtimeFlags = {}
} = {}) {
    const router = express.Router();

    router.get('/health', (req, res) => {
        return res.json({
            success: true,
            service: 'stream-gateway',
            streamRuntimeEnabled: !!runtimeFlags.streamRuntimeEnabled,
            streamWebSocketGatewayEnabled: !!runtimeFlags.streamWebSocketGatewayEnabled,
            streamWebRtcEnabled: !!runtimeFlags.streamWebRtcEnabled,
            streamWebRtcRequireHttps: !!runtimeFlags.streamWebRtcRequireHttps
        });
    });

    router.get('/runtime', async (req, res) => {
        try {
            const snapshot = await streamControlService.getRuntimeSnapshot();
            return res.json({
                success: true,
                ...snapshot
            });
        } catch (error) {
            return sendGatewayError(res, error);
        }
    });

    router.get('/metrics', async (req, res) => {
        try {
            const snapshot = await streamControlService.getRuntimeSnapshot();
            const metricsText = renderStreamRuntimePrometheusMetrics(snapshot);
            res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
            return res.send(metricsText);
        } catch (error) {
            return sendGatewayError(res, error);
        }
    });

    router.get('/capabilities', (req, res) => {
        try {
            return res.json({
                success: true,
                capabilities: streamControlService.getCapabilities({
                    requestHeaders: req.headers || {}
                })
            });
        } catch (error) {
            return sendGatewayError(res, error);
        }
    });

    router.get('/sessions/:cameraId', (req, res) => {
        try {
            return res.json({
                success: true,
                session: streamControlService.getSessionDescriptor({
                    cameraId: req.params?.cameraId,
                    requestHeaders: req.headers || {}
                })
            });
        } catch (error) {
            return sendGatewayError(res, error);
        }
    });

    router.post('/sync', validateBody('jasy-jatere/contracts/stream-sync-request/v1'), async (req, res) => {
        try {
            const sync = await streamControlService.triggerManualSync(req.body || {});
            return res.json({
                success: true,
                sync
            });
        } catch (error) {
            return sendGatewayError(res, error);
        }
    });

    router.post('/webrtc/sessions', validateBody('jasy-jatere/contracts/stream-webrtc-session-create-request/v1'), async (req, res) => {
        try {
            const body = req.body || {};
            const offer = body.offer && typeof body.offer === 'object' ? body.offer : null;
            const session = await streamControlService.createWebRtcSession({
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
            return sendGatewayError(res, error);
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

            const result = await streamControlService.submitWebRtcCandidate({
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
            return sendGatewayError(res, error);
        }
    });

    router.delete('/webrtc/sessions/:sessionId', validateBody('jasy-jatere/contracts/stream-webrtc-session-close-request/v1'), async (req, res) => {
        try {
            const body = req.body || {};
            const result = await streamControlService.closeWebRtcSession({
                sessionId: req.params?.sessionId,
                cameraId: body.cameraId,
                requestHeaders: req.headers || {}
            });
            return res.json({
                success: true,
                result
            });
        } catch (error) {
            return sendGatewayError(res, error);
        }
    });

    return router;
}

module.exports = {
    createInternalStreamsGatewayRouter
};

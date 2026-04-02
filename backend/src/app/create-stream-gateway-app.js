const express = require('express');
const cors = require('cors');
const path = require('path');
const { validateBody } = require('../contracts/validator');
const { attachCorrelationId, injectCorrelationIdIntoJson } = require('../http/correlation-id-middleware');
const { PlatformRuntimeCoordinator } = require('./platform-runtime-coordinator');
const { createStreamGatewayServices } = require('./create-stream-gateway-services');
const { resolveRuntimeFlags } = require('./runtime-flags');
const { renderStreamRuntimePrometheusMetrics } = require('../domains/streams/stream-runtime-metrics');

function sendGatewayError(res, error) {
    const status = Number(error?.status) || 500;
    return res.status(status).json({
        success: false,
        error: error?.message || String(error),
        details: error?.details
    });
}

function createStreamGatewayApp({
    cameraFile = path.join(__dirname, '..', '..', 'data', 'cameras.json'),
    runtimeFlags = resolveRuntimeFlags()
} = {}) {
    const app = express();

    app.use(cors());
    app.use(express.json());
    app.use(attachCorrelationId());
    app.use(injectCorrelationIdIntoJson());

    const services = createStreamGatewayServices({
        cameraFile,
        runtimeFlags
    });

    const platformRuntimeCoordinator = new PlatformRuntimeCoordinator({
        streamSyncOrchestrator: services.streamSyncOrchestrator,
        streamWebSocketGateway: services.streamWebSocketGateway,
        streamRuntimeEnabled: runtimeFlags.streamRuntimeEnabled,
        streamWebSocketGatewayEnabled: runtimeFlags.streamWebSocketGatewayEnabled
    });

    app.get('/api/internal/streams/health', (req, res) => {
        return res.json({
            success: true,
            service: 'stream-gateway',
            streamRuntimeEnabled: runtimeFlags.streamRuntimeEnabled,
            streamWebSocketGatewayEnabled: runtimeFlags.streamWebSocketGatewayEnabled,
            streamWebRtcEnabled: runtimeFlags.streamWebRtcEnabled,
            streamWebRtcRequireHttps: runtimeFlags.streamWebRtcRequireHttps
        });
    });

    app.get('/livez', (req, res) => {
        return res.json({
            success: true,
            service: 'stream-gateway',
            status: 'alive'
        });
    });

    app.get('/readyz', async (req, res) => {
        try {
            await services.streamControlService.getRuntimeSnapshot();
            return res.json({
                success: true,
                service: 'stream-gateway',
                status: 'ready'
            });
        } catch (error) {
            return res.status(503).json({
                success: false,
                service: 'stream-gateway',
                status: 'degraded',
                error: error?.message || String(error)
            });
        }
    });

    app.get('/api/internal/streams/runtime', async (req, res) => {
        try {
            const snapshot = await services.streamControlService.getRuntimeSnapshot();
            return res.json({
                success: true,
                ...snapshot
            });
        } catch (error) {
            return sendGatewayError(res, error);
        }
    });

    app.get('/api/internal/streams/metrics', async (req, res) => {
        try {
            const snapshot = await services.streamControlService.getRuntimeSnapshot();
            const metricsText = renderStreamRuntimePrometheusMetrics(snapshot);
            res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
            return res.send(metricsText);
        } catch (error) {
            return sendGatewayError(res, error);
        }
    });

    app.get('/api/internal/streams/capabilities', (req, res) => {
        try {
            return res.json({
                success: true,
                capabilities: services.streamControlService.getCapabilities({
                    requestHeaders: req.headers || {}
                })
            });
        } catch (error) {
            return sendGatewayError(res, error);
        }
    });

    app.get('/api/internal/streams/sessions/:cameraId', (req, res) => {
        try {
            return res.json({
                success: true,
                session: services.streamControlService.getSessionDescriptor({
                    cameraId: req.params?.cameraId,
                    requestHeaders: req.headers || {}
                })
            });
        } catch (error) {
            return sendGatewayError(res, error);
        }
    });

    app.post('/api/internal/streams/sync', validateBody('jasy-jatere/contracts/stream-sync-request/v1'), async (req, res) => {
        try {
            const sync = await services.streamControlService.triggerManualSync(req.body || {});
            return res.json({
                success: true,
                sync
            });
        } catch (error) {
            return sendGatewayError(res, error);
        }
    });

    app.post('/api/internal/streams/webrtc/sessions', validateBody('jasy-jatere/contracts/stream-webrtc-session-create-request/v1'), async (req, res) => {
        try {
            const body = req.body || {};
            const offer = body.offer && typeof body.offer === 'object' ? body.offer : null;
            const session = await services.streamControlService.createWebRtcSession({
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

    app.post('/api/internal/streams/webrtc/sessions/:sessionId/candidates', validateBody('jasy-jatere/contracts/stream-webrtc-candidate-request/v1'), async (req, res) => {
        try {
            const body = req.body || {};
            const rawCandidate = body.candidate;
            const candidate = typeof rawCandidate === 'object' && rawCandidate
                ? rawCandidate.candidate
                : rawCandidate;
            const sdpMid = typeof rawCandidate === 'object' && rawCandidate ? rawCandidate.sdpMid : body.sdpMid;
            const sdpMLineIndex = typeof rawCandidate === 'object' && rawCandidate ? rawCandidate.sdpMLineIndex : body.sdpMLineIndex;
            const usernameFragment = typeof rawCandidate === 'object' && rawCandidate ? rawCandidate.usernameFragment : body.usernameFragment;

            const result = await services.streamControlService.submitWebRtcCandidate({
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

    app.delete('/api/internal/streams/webrtc/sessions/:sessionId', validateBody('jasy-jatere/contracts/stream-webrtc-session-close-request/v1'), async (req, res) => {
        try {
            const body = req.body || {};
            const result = await services.streamControlService.closeWebRtcSession({
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

    return {
        app,
        platformRuntimeCoordinator
    };
}

module.exports = {
    createStreamGatewayApp
};

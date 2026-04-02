const express = require('express');
const cors = require('cors');
const path = require('path');
const { createInternalStreamsGatewayRouter } = require('../../routes/internal-streams-gateway');
const { attachCorrelationId, injectCorrelationIdIntoJson } = require('../http/correlation-id-middleware');
const { PlatformRuntimeCoordinator } = require('./platform-runtime-coordinator');
const { createStreamGatewayServices } = require('./create-stream-gateway-services');
const { resolveRuntimeFlags } = require('./runtime-flags');

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

    app.use('/api/internal/streams', createInternalStreamsGatewayRouter({
        streamControlService: services.streamControlService
    }));

    return {
        app,
        platformRuntimeCoordinator
    };
}

module.exports = {
    createStreamGatewayApp
};

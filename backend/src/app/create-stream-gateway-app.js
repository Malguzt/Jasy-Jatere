const express = require('express');
const cors = require('cors');
const path = require('path');
const { createInternalStreamsGatewayRouter } = require('../../routes/internal-streams-gateway');
const { createStreamGatewayProbesRouter } = require('../../routes/stream-gateway-probes');
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

    app.use('/api/internal/streams', createInternalStreamsGatewayRouter({
        streamControlService: services.streamControlService,
        runtimeFlags
    }));
    app.use('/', createStreamGatewayProbesRouter({
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

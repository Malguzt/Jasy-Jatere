const express = require('express');
const cors = require('cors');
const path = require('path');
const { attachCorrelationId, injectCorrelationIdIntoJson } = require('../http/correlation-id-middleware');
const { PlatformRuntimeCoordinator } = require('./platform-runtime-coordinator');
const { createStreamGatewayServices } = require('./create-stream-gateway-services');
const { registerStreamGatewayRoutes } = require('./create-stream-gateway-routes');
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

    registerStreamGatewayRoutes({
        app,
        services,
        runtimeFlags
    });

    return {
        app,
        platformRuntimeCoordinator
    };
}

module.exports = {
    createStreamGatewayApp
};

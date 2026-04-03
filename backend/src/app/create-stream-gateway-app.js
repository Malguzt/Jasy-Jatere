const path = require('path');
const { PlatformRuntimeCoordinator } = require('./platform-runtime-coordinator');
const { createStreamGatewayServices } = require('./create-stream-gateway-services');
const { registerStreamGatewayRoutes } = require('./create-stream-gateway-routes');
const { resolveRuntimeFlags } = require('./runtime-flags');
const { createHttpAppBase } = require('./create-http-app-base');

function createStreamGatewayApp({
    cameraFile = path.join(__dirname, '..', '..', 'data', 'cameras.json'),
    runtimeFlags = resolveRuntimeFlags()
} = {}) {
    const app = createHttpAppBase();

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

const express = require('express');
const cors = require('cors');
const path = require('path');
const { PlatformRuntimeCoordinator } = require('./platform-runtime-coordinator');
const { createBackendServices } = require('./create-backend-services');
const { registerBackendRoutes } = require('./create-backend-routes');
const { resolveRuntimeFlags } = require('./runtime-flags');
const { attachCorrelationId, injectCorrelationIdIntoJson } = require('../http/correlation-id-middleware');

function createBackendApp({
    cameraFile = path.join(__dirname, '..', '..', 'data', 'cameras.json'),
    runtimeFlags = resolveRuntimeFlags()
} = {}) {
    const app = express();

    app.use(cors());
    app.use(express.json());
    app.use(attachCorrelationId());
    app.use(injectCorrelationIdIntoJson());

    const services = createBackendServices({
        cameraFile,
        runtimeFlags
    });
    const platformRuntimeCoordinator = new PlatformRuntimeCoordinator({
        cameraEventMonitor: services.cameraEventMonitor,
        connectivityMonitor: services.connectivityMonitor,
        streamSyncOrchestrator: services.streamSyncOrchestrator,
        streamWebSocketGateway: services.streamWebSocketGateway,
        recordingRetentionJob: services.recordingRetentionJob,
        streamRuntimeEnabled: runtimeFlags.streamRuntimeEnabled,
        streamWebSocketGatewayEnabled:
            runtimeFlags.streamWebSocketGatewayEnabled ||
            (
                runtimeFlags.streamProxyModeEnabled &&
                !!String(runtimeFlags.streamGatewayApiUrl || '').trim()
            )
    });

    registerBackendRoutes({
        app,
        services
    });

    app.use('/recordings', express.static('/app/recordings'));

    return {
        app,
        platformRuntimeCoordinator
    };
}

module.exports = {
    createBackendApp
};

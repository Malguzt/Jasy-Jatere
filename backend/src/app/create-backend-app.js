const express = require('express');
const { PlatformRuntimeCoordinator } = require('./platform-runtime-coordinator');
const { createBackendServices } = require('./create-backend-services');
const { registerBackendRoutes } = require('./create-backend-routes');
const { resolveRuntimeFlags } = require('./runtime-flags');
const { createHttpAppBase } = require('./create-http-app-base');

function createBackendApp({
    runtimeFlags = resolveRuntimeFlags()
} = {}) {
    const effectiveRuntimeFlags = {
        ...(runtimeFlags || {}),
        streamProxyModeEnabled: true,
        streamProxyRequired: true,
        streamRuntimeEnabled: false,
        streamWebSocketGatewayEnabled: false
    };
    const app = createHttpAppBase();

    const services = createBackendServices({
        runtimeFlags: effectiveRuntimeFlags
    });
    const platformRuntimeCoordinator = new PlatformRuntimeCoordinator({
        cameraEventMonitor: services.cameraEventMonitor,
        connectivityMonitor: services.connectivityMonitor,
        streamSyncOrchestrator: services.streamSyncOrchestrator,
        streamWebSocketGateway: services.streamWebSocketGateway,
        recordingRetentionJob: services.recordingRetentionJob,
        streamRuntimeEnabled: effectiveRuntimeFlags.streamRuntimeEnabled,
        streamWebSocketGatewayEnabled:
            effectiveRuntimeFlags.streamWebSocketGatewayEnabled ||
            (
                effectiveRuntimeFlags.streamProxyModeEnabled &&
                !!String(effectiveRuntimeFlags.streamGatewayApiUrl || '').trim()
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

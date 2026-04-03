const streamManager = require('../../stream-manager');
const { resolveCameraStreamUrls, deriveCompanionRtsp, parseResolutionHint } = require('../../rtsp-utils');
const { StreamSyncOrchestrator } = require('../domains/streams/stream-sync-orchestrator');
const { StreamControlService } = require('../domains/streams/stream-control-service');
const { StreamWebSocketGateway } = require('../domains/streams/stream-websocket-gateway');
const {
    buildStreamControlRuntimeOptions
} = require('./composition-options');

function createStreamRuntimeStack({
    cameraFile,
    cameraInventoryService,
    runtimeFlags,
    streamManagerInstance = streamManager
}) {
    const streamControlRuntimeOptions = buildStreamControlRuntimeOptions(runtimeFlags);

    const streamSyncOrchestrator = new StreamSyncOrchestrator({
        cameraFile,
        cameraInventoryService,
        streamManager: streamManagerInstance,
        resolveCameraStreamUrls,
        deriveCompanionRtsp,
        parseResolutionHint
    });

    const streamControlService = new StreamControlService({
        streamManager: streamManagerInstance,
        cameraInventoryService,
        streamSyncOrchestrator,
        ...streamControlRuntimeOptions
    });

    const streamWebSocketGateway = new StreamWebSocketGateway({
        cameraFile,
        cameraInventoryService,
        streamManager: streamManagerInstance,
        resolveCameraStreamUrls
    });

    return {
        streamSyncOrchestrator,
        streamControlService,
        streamWebSocketGateway,
        streamControlRuntimeOptions
    };
}

module.exports = {
    createStreamRuntimeStack
};

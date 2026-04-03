const streamManager = require('../../stream-manager');
const { resolveCameraStreamUrls, deriveCompanionRtsp, parseResolutionHint } = require('../../rtsp-utils');
const { StreamSyncOrchestrator } = require('../domains/streams/stream-sync-orchestrator');
const { StreamWebSocketGateway } = require('../domains/streams/stream-websocket-gateway');
const { StreamControlService } = require('../domains/streams/stream-control-service');
const {
    buildLegacyFileFallbackOptions,
    buildStreamControlRuntimeOptions
} = require('./composition-options');
const { createMetadataContext } = require('./create-metadata-context');
const { createCameraInventoryStack } = require('./create-camera-inventory-stack');

function createStreamGatewayServices({
    cameraFile,
    runtimeFlags,
    metadataDriver = String(process.env.METADATA_STORE_DRIVER || 'sqlite').toLowerCase()
}) {
    const metadataContext = createMetadataContext({ metadataDriver });
    const driver = metadataContext.metadataDriver;
    const sqliteStore = metadataContext.sqliteStore;
    const legacyFileFallbackOptions = buildLegacyFileFallbackOptions(runtimeFlags);
    const streamControlRuntimeOptions = buildStreamControlRuntimeOptions(runtimeFlags);

    const cameraInventoryStack = createCameraInventoryStack({
        cameraFile,
        runtimeFlags,
        metadataDriver: driver,
        sqliteStore
    });
    const cameraInventoryService = cameraInventoryStack.cameraInventoryService;

    const streamSyncOrchestrator = new StreamSyncOrchestrator({
        cameraFile,
        cameraInventoryService,
        streamManager,
        resolveCameraStreamUrls,
        deriveCompanionRtsp,
        parseResolutionHint,
        ...legacyFileFallbackOptions
    });

    const streamControlService = new StreamControlService({
        streamManager,
        cameraInventoryService,
        streamSyncOrchestrator,
        ...streamControlRuntimeOptions
    });

    const streamWebSocketGateway = new StreamWebSocketGateway({
        cameraFile,
        cameraInventoryService,
        streamManager,
        resolveCameraStreamUrls,
        ...legacyFileFallbackOptions
    });

    return {
        metadataDriver: driver,
        sqliteStore,
        cameraInventoryService,
        streamSyncOrchestrator,
        streamControlService,
        streamWebSocketGateway
    };
}

module.exports = {
    createStreamGatewayServices
};

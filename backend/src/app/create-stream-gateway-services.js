const { createMetadataContext } = require('./create-metadata-context');
const { createCameraInventoryStack } = require('./create-camera-inventory-stack');
const { createStreamRuntimeStack } = require('./create-stream-runtime-stack');

function createStreamGatewayServices({
    cameraFile,
    runtimeFlags,
    metadataDriver = String(process.env.METADATA_STORE_DRIVER || 'sqlite').toLowerCase()
}) {
    const metadataContext = createMetadataContext({ metadataDriver });
    const driver = metadataContext.metadataDriver;
    const sqliteStore = metadataContext.sqliteStore;
    const cameraInventoryStack = createCameraInventoryStack({
        cameraFile,
        runtimeFlags,
        metadataDriver: driver,
        sqliteStore
    });
    const cameraInventoryService = cameraInventoryStack.cameraInventoryService;
    const streamRuntimeStack = createStreamRuntimeStack({
        cameraFile,
        cameraInventoryService,
        runtimeFlags
    });

    return {
        metadataDriver: driver,
        sqliteStore,
        cameraInventoryService,
        streamSyncOrchestrator: streamRuntimeStack.streamSyncOrchestrator,
        streamControlService: streamRuntimeStack.streamControlService,
        streamWebSocketGateway: streamRuntimeStack.streamWebSocketGateway
    };
}

module.exports = {
    createStreamGatewayServices
};

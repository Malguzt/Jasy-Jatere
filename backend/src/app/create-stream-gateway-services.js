const { createMetadataContext } = require('./create-metadata-context');
const { createCameraInventoryStack } = require('./create-camera-inventory-stack');
const { createStreamRuntimeStack } = require('./create-stream-runtime-stack');

function createStreamGatewayServices({
    runtimeFlags,
    metadataDriver
}) {
    const metadataContext = createMetadataContext({
        metadataDriver: metadataDriver || runtimeFlags?.metadataStoreDriver,
        metadataSqlitePath: runtimeFlags?.metadataSqlitePath
    });
    const driver = metadataContext.metadataDriver;
    const sqliteStore = metadataContext.sqliteStore;
    const cameraInventoryStack = createCameraInventoryStack({
        metadataDriver: driver,
        sqliteStore,
        cameraCredentialsMasterKey: runtimeFlags?.cameraCredentialsMasterKey
    });
    const cameraInventoryService = cameraInventoryStack.cameraInventoryService;
    const streamRuntimeStack = createStreamRuntimeStack({
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

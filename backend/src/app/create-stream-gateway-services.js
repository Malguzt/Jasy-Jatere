const streamManager = require('../../stream-manager');
const { resolveCameraStreamUrls, deriveCompanionRtsp, parseResolutionHint } = require('../../rtsp-utils');
const { CameraMetadataRepository } = require('../infrastructure/repositories/camera-metadata-repository');
const { CameraInventoryService } = require('../domains/cameras/camera-inventory-service');
const { StreamSyncOrchestrator } = require('../domains/streams/stream-sync-orchestrator');
const { StreamWebSocketGateway } = require('../domains/streams/stream-websocket-gateway');
const { StreamControlService } = require('../domains/streams/stream-control-service');
const {
    buildRepositoryCompatOptions,
    buildLegacyFileFallbackOptions,
    buildStreamControlRuntimeOptions
} = require('./composition-options');
const { createMetadataContext } = require('./create-metadata-context');

function createStreamGatewayServices({
    cameraFile,
    runtimeFlags,
    metadataDriver = String(process.env.METADATA_STORE_DRIVER || 'sqlite').toLowerCase()
}) {
    const metadataContext = createMetadataContext({ metadataDriver });
    const driver = metadataContext.metadataDriver;
    const sqliteStore = metadataContext.sqliteStore;
    const repositoryCompatOptions = buildRepositoryCompatOptions(runtimeFlags);
    const legacyFileFallbackOptions = buildLegacyFileFallbackOptions(runtimeFlags);
    const streamControlRuntimeOptions = buildStreamControlRuntimeOptions(runtimeFlags);

    const cameraRepository = new CameraMetadataRepository({
        legacyFile: cameraFile,
        driver,
        sqliteStore,
        ...repositoryCompatOptions
    });
    const cameraInventoryService = new CameraInventoryService({
        repository: cameraRepository
    });

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

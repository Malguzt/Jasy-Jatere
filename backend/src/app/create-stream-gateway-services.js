const streamManager = require('../../stream-manager');
const { resolveCameraStreamUrls, deriveCompanionRtsp, parseResolutionHint } = require('../../rtsp-utils');
const { CameraMetadataRepository } = require('../infrastructure/repositories/camera-metadata-repository');
const { MetadataSqliteStore } = require('../infrastructure/sqlite/metadata-sqlite-store');
const { CameraInventoryService } = require('../domains/cameras/camera-inventory-service');
const { StreamSyncOrchestrator } = require('../domains/streams/stream-sync-orchestrator');
const { StreamWebSocketGateway } = require('../domains/streams/stream-websocket-gateway');
const { StreamControlService } = require('../domains/streams/stream-control-service');
const {
    buildRepositoryCompatOptions,
    buildLegacyFileFallbackOptions,
    buildStreamControlRuntimeOptions
} = require('./composition-options');

function createStreamGatewayServices({
    cameraFile,
    runtimeFlags,
    metadataDriver = String(process.env.METADATA_STORE_DRIVER || 'sqlite').toLowerCase()
}) {
    const sqliteStore = metadataDriver === 'sqlite' ? new MetadataSqliteStore() : null;
    if (metadataDriver === 'sqlite') {
        sqliteStore.migrate();
    }
    const repositoryCompatOptions = buildRepositoryCompatOptions(runtimeFlags);
    const legacyFileFallbackOptions = buildLegacyFileFallbackOptions(runtimeFlags);
    const streamControlRuntimeOptions = buildStreamControlRuntimeOptions(runtimeFlags);

    const cameraRepository = new CameraMetadataRepository({
        legacyFile: cameraFile,
        driver: metadataDriver,
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
        metadataDriver,
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

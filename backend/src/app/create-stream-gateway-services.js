const streamManager = require('../../stream-manager');
const { resolveCameraStreamUrls, deriveCompanionRtsp, parseResolutionHint } = require('../../rtsp-utils');
const { CameraMetadataRepository } = require('../infrastructure/repositories/camera-metadata-repository');
const { MetadataSqliteStore } = require('../infrastructure/sqlite/metadata-sqlite-store');
const { CameraInventoryService } = require('../domains/cameras/camera-inventory-service');
const { StreamSyncOrchestrator } = require('../domains/streams/stream-sync-orchestrator');
const { StreamWebSocketGateway } = require('../domains/streams/stream-websocket-gateway');
const { StreamControlService } = require('../domains/streams/stream-control-service');

function createStreamGatewayServices({
    cameraFile,
    runtimeFlags,
    metadataDriver = String(process.env.METADATA_STORE_DRIVER || 'sqlite').toLowerCase()
}) {
    const sqliteStore = metadataDriver === 'sqlite' ? new MetadataSqliteStore() : null;
    if (metadataDriver === 'sqlite') {
        sqliteStore.migrate();
    }

    const cameraRepository = new CameraMetadataRepository({
        legacyFile: cameraFile,
        driver: metadataDriver,
        sqliteStore,
        dualWritePrimary: runtimeFlags.legacyCompatExportsEnabled,
        dualWriteLegacy: runtimeFlags.legacyCompatExportsEnabled,
        legacyReadFallback: runtimeFlags.legacyCompatExportsEnabled
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
        legacyFileFallbackEnabled: runtimeFlags.legacyCompatExportsEnabled
    });

    const streamControlService = new StreamControlService({
        streamManager,
        cameraInventoryService,
        streamSyncOrchestrator,
        streamWebSocketGatewayEnabled: runtimeFlags.streamWebSocketGatewayEnabled,
        streamWebRtcEnabled: runtimeFlags.streamWebRtcEnabled,
        streamWebRtcRequireHttps: runtimeFlags.streamWebRtcRequireHttps,
        streamWebRtcSignalingUrl: runtimeFlags.streamWebRtcSignalingUrl,
        streamWebRtcIceServersJson: runtimeFlags.streamWebRtcIceServersJson,
        streamWebRtcSignalingRetries: runtimeFlags.streamWebRtcSignalingRetries,
        streamPublicBaseUrl: runtimeFlags.streamPublicBaseUrl
    });

    const streamWebSocketGateway = new StreamWebSocketGateway({
        cameraFile,
        cameraInventoryService,
        streamManager,
        resolveCameraStreamUrls,
        legacyFileFallbackEnabled: runtimeFlags.legacyCompatExportsEnabled
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

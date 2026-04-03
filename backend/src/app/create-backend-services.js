const streamManager = require('../../stream-manager');
const { CameraEventMonitor } = require('../../camera-event-monitor');
const CameraConnectivityMonitor = require('../../camera-connectivity-monitor');
const { resolveCameraStreamUrls, deriveCompanionRtsp, parseResolutionHint } = require('../../rtsp-utils');
const { ContractsService } = require('../domains/contracts/contracts-service');
const { ConnectivityMonitoringService } = require('../domains/monitoring/connectivity-monitoring-service');
const { CameraMotionService } = require('../domains/monitoring/camera-motion-service');
const { PlatformHealthService } = require('../domains/platform/platform-health-service');
const { StreamSyncOrchestrator } = require('../domains/streams/stream-sync-orchestrator');
const { StreamWebSocketGateway } = require('../domains/streams/stream-websocket-gateway');
const { StreamWebSocketProxyGateway } = require('../domains/streams/stream-websocket-proxy-gateway');
const { StreamControlService } = require('../domains/streams/stream-control-service');
const { StreamGatewayProxyService } = require('../domains/streams/stream-gateway-proxy-service');
const { CameraMetadataRepository } = require('../infrastructure/repositories/camera-metadata-repository');
const { RecordingCatalogRepository } = require('../infrastructure/repositories/recording-catalog-repository');
const { ObservationEventRepository } = require('../infrastructure/repositories/observation-event-repository');
const { HealthSnapshotRepository } = require('../infrastructure/repositories/health-snapshot-repository');
const { CameraInventoryService } = require('../domains/cameras/camera-inventory-service');
const { SavedCamerasService } = require('../domains/cameras/saved-cameras-service');
const { OnvifCameraService } = require('../domains/cameras/onvif-camera-service');
const { WorkerConfigService } = require('../domains/platform/worker-config-service');
const { RecordingCatalogService } = require('../domains/recordings/recording-catalog-service');
const { RecordingRetentionJob } = require('../domains/recordings/recording-retention-job');
const { PerceptionIngestService } = require('../domains/perception/perception-ingest-service');
const { DetectorProxyService } = require('../domains/perception/detector-proxy-service');
const { MapsService } = require('../domains/maps/maps-service');
const {
    buildRepositoryCompatOptions,
    buildLegacyFileFallbackOptions,
    buildStreamControlRuntimeOptions
} = require('./composition-options');
const { createMetadataContext } = require('./create-metadata-context');

function createBackendServices({
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
    const recordingCatalogRepository = new RecordingCatalogRepository({
        driver,
        sqliteStore,
        ...repositoryCompatOptions
    });
    const observationRepository = new ObservationEventRepository({
        driver,
        sqliteStore,
        maxEntries: runtimeFlags.observationMaxEntries,
        dualWriteLegacy: runtimeFlags.legacyCompatExportsEnabled
    });
    const healthSnapshotRepository = new HealthSnapshotRepository({
        driver,
        sqliteStore,
        dualWriteFile: runtimeFlags.legacyCompatExportsEnabled,
        legacyReadFallback: runtimeFlags.legacyCompatExportsEnabled
    });
    const cameraInventoryService = new CameraInventoryService({
        repository: cameraRepository
    });
    const savedCamerasService = new SavedCamerasService({
        repository: cameraRepository
    });
    const onvifCameraService = new OnvifCameraService({
        cameraDataFile: cameraFile,
        cameraInventoryService,
        ...legacyFileFallbackOptions
    });
    const cameraEventMonitor = new CameraEventMonitor({
        cameraFile,
        cameraInventoryService,
        ...legacyFileFallbackOptions
    });

    const connectivityMonitor = new CameraConnectivityMonitor({
        cameraFile,
        streamManager,
        cameraEventMonitor,
        cameraInventoryService,
        ...legacyFileFallbackOptions
    });
    const monitoringService = new ConnectivityMonitoringService({
        connectivityMonitor,
        healthSnapshotRepository
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
    const streamGatewayApiUrl = String(runtimeFlags.streamGatewayApiUrl || '').trim();
    const streamControlProxyService = streamGatewayApiUrl
        ? new StreamGatewayProxyService({
            gatewayApiBaseUrl: streamGatewayApiUrl
        })
        : null;
    const cameraMotionService = new CameraMotionService({
        cameraEventMonitor
    });
    const contractsService = new ContractsService();
    const workerConfigService = new WorkerConfigService({
        cameraInventoryService,
        streamSyncOrchestrator,
        runtimeFlags
    });
    const recordingCatalogService = new RecordingCatalogService({
        repository: recordingCatalogRepository
    });
    const recordingRetentionJob = new RecordingRetentionJob({
        recordingCatalogService,
        enabled: runtimeFlags.recordingRetentionEnabled,
        intervalMs: runtimeFlags.recordingRetentionIntervalMs,
        maxAgeDays: runtimeFlags.recordingRetentionMaxAgeDays,
        maxEntries: runtimeFlags.recordingRetentionMaxEntries
    });
    const platformHealthService = new PlatformHealthService({
        contractsService,
        monitoringService,
        streamControlService,
        streamControlProxyService,
        streamProxyModeEnabled: runtimeFlags.streamProxyModeEnabled,
        streamProxyRequired: runtimeFlags.streamProxyRequired,
        recordingRetentionJob
    });
    const perceptionIngestService = new PerceptionIngestService({
        observationRepository,
        recordingCatalogService
    });
    const streamWebSocketGateway =
        runtimeFlags.streamProxyModeEnabled && streamGatewayApiUrl
            ? new StreamWebSocketProxyGateway({
                gatewayApiBaseUrl: streamGatewayApiUrl
            })
            : new StreamWebSocketGateway({
                cameraFile,
                cameraInventoryService,
                streamManager,
                resolveCameraStreamUrls,
                ...legacyFileFallbackOptions
            });
    const mapsService = new MapsService();
    const detectorProxyService = new DetectorProxyService();

    return {
        metadataDriver: driver,
        sqliteStore,
        cameraInventoryService,
        savedCamerasService,
        onvifCameraService,
        cameraEventMonitor,
        connectivityMonitor,
        monitoringService,
        streamSyncOrchestrator,
        streamControlService,
        streamControlProxyService,
        cameraMotionService,
        contractsService,
        workerConfigService,
        recordingCatalogService,
        recordingRetentionJob,
        platformHealthService,
        perceptionIngestService,
        streamWebSocketGateway,
        mapsService,
        detectorProxyService
    };
}

module.exports = {
    createBackendServices
};

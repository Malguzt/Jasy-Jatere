const { CameraEventMonitor } = require('../../camera-event-monitor');
const CameraConnectivityMonitor = require('../../camera-connectivity-monitor');
const streamManager = require('../../stream-manager');
const { ContractsService } = require('../domains/contracts/contracts-service');
const { ConnectivityMonitoringService } = require('../domains/monitoring/connectivity-monitoring-service');
const { CameraMotionService } = require('../domains/monitoring/camera-motion-service');
const { PlatformHealthService } = require('../domains/platform/platform-health-service');
const { StreamWebSocketProxyGateway } = require('../domains/streams/stream-websocket-proxy-gateway');
const { StreamGatewayProxyService } = require('../domains/streams/stream-gateway-proxy-service');
const { RecordingCatalogRepository } = require('../infrastructure/repositories/recording-catalog-repository');
const { ObservationEventRepository } = require('../infrastructure/repositories/observation-event-repository');
const { HealthSnapshotRepository } = require('../infrastructure/repositories/health-snapshot-repository');
const { SavedCamerasService } = require('../domains/cameras/saved-cameras-service');
const { OnvifCameraService } = require('../domains/cameras/onvif-camera-service');
const { WorkerConfigService } = require('../domains/platform/worker-config-service');
const { RecordingCatalogService } = require('../domains/recordings/recording-catalog-service');
const { RecordingRetentionJob } = require('../domains/recordings/recording-retention-job');
const { PerceptionIngestService } = require('../domains/perception/perception-ingest-service');
const { DetectorProxyService } = require('../domains/perception/detector-proxy-service');
const { MapsService } = require('../domains/maps/maps-service');
const { createMetadataContext } = require('./create-metadata-context');
const { createCameraInventoryStack } = require('./create-camera-inventory-stack');
const { createStreamRuntimeStack } = require('./create-stream-runtime-stack');

function createBackendServices({
    cameraFile,
    runtimeFlags,
    metadataDriver
}) {
    const metadataContext = createMetadataContext({ metadataDriver });
    const driver = metadataContext.metadataDriver;
    const sqliteStore = metadataContext.sqliteStore;

    const cameraInventoryStack = createCameraInventoryStack({
        cameraFile,
        metadataDriver: driver,
        sqliteStore
    });
    const cameraRepository = cameraInventoryStack.cameraRepository;
    const cameraInventoryService = cameraInventoryStack.cameraInventoryService;

    const recordingCatalogRepository = new RecordingCatalogRepository({
        driver,
        sqliteStore
    });
    const observationRepository = new ObservationEventRepository({
        driver,
        sqliteStore,
        maxEntries: runtimeFlags.observationMaxEntries
    });
    const healthSnapshotRepository = new HealthSnapshotRepository({
        driver,
        sqliteStore
    });
    const savedCamerasService = new SavedCamerasService({
        repository: cameraRepository
    });
    const onvifCameraService = new OnvifCameraService({
        cameraInventoryService
    });
    const cameraEventMonitor = new CameraEventMonitor({
        cameraFile,
        cameraInventoryService
    });

    const connectivityMonitor = new CameraConnectivityMonitor({
        cameraFile,
        streamManager,
        cameraEventMonitor,
        cameraInventoryService
    });
    const monitoringService = new ConnectivityMonitoringService({
        connectivityMonitor,
        healthSnapshotRepository
    });
    const streamGatewayApiUrl = String(runtimeFlags.streamGatewayApiUrl || '').trim();
    const streamProxyRuntimeActive =
        runtimeFlags.streamProxyModeEnabled === true && streamGatewayApiUrl.length > 0;
    const streamRuntimeStack = streamProxyRuntimeActive
        ? null
        : createStreamRuntimeStack({
            cameraInventoryService,
            runtimeFlags,
            streamManagerInstance: streamManager
        });
    const streamSyncOrchestrator = streamRuntimeStack?.streamSyncOrchestrator || null;
    const streamControlService = streamRuntimeStack?.streamControlService || null;
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
        streamProxyRuntimeActive
            ? new StreamWebSocketProxyGateway({
                gatewayApiBaseUrl: streamGatewayApiUrl
            })
            : streamRuntimeStack?.streamWebSocketGateway || null;
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

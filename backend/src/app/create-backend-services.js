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
const mapsStorage = require('../../maps/storage');
const mapsJobs = require('../../maps/job-queue');
const mapsCorrections = require('../../maps/corrections');
const { loadSchemaSummaries } = require('../contracts/schema-registry');

function createBackendServices({
    runtimeFlags,
    metadataDriver
}) {
    const effectiveRuntimeFlags = {
        ...(runtimeFlags || {}),
        streamProxyModeEnabled: true,
        streamProxyRequired: true,
        streamRuntimeEnabled: false,
        streamWebSocketGatewayEnabled: false
    };
    const metadataContext = createMetadataContext({ metadataDriver });
    const driver = metadataContext.metadataDriver;
    const sqliteStore = metadataContext.sqliteStore;

    const cameraInventoryStack = createCameraInventoryStack({
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
        maxEntries: effectiveRuntimeFlags.observationMaxEntries
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
        cameraInventoryService
    });

    const connectivityMonitor = new CameraConnectivityMonitor({
        streamManager,
        cameraEventMonitor,
        cameraInventoryService
    });
    const monitoringService = new ConnectivityMonitoringService({
        connectivityMonitor,
        healthSnapshotRepository
    });
    const streamGatewayApiUrl = String(effectiveRuntimeFlags.streamGatewayApiUrl || '').trim();
    const streamProxyRuntimeActive = streamGatewayApiUrl.length > 0;
    const streamSyncOrchestrator = null;
    const streamControlService = null;
    const streamControlProxyService = streamGatewayApiUrl
        ? new StreamGatewayProxyService({
            gatewayApiBaseUrl: streamGatewayApiUrl
        })
        : null;
    const cameraMotionService = new CameraMotionService({
        cameraEventMonitor
    });
    const contractsService = new ContractsService({
        loadSchemaSummariesFn: loadSchemaSummaries
    });
    const workerConfigService = new WorkerConfigService({
        cameraInventoryService,
        streamSyncOrchestrator,
        streamControlProxyService,
        runtimeFlags: effectiveRuntimeFlags
    });
    const recordingCatalogService = new RecordingCatalogService({
        repository: recordingCatalogRepository
    });
    const recordingRetentionJob = new RecordingRetentionJob({
        recordingCatalogService,
        enabled: effectiveRuntimeFlags.recordingRetentionEnabled,
        intervalMs: effectiveRuntimeFlags.recordingRetentionIntervalMs,
        maxAgeDays: effectiveRuntimeFlags.recordingRetentionMaxAgeDays,
        maxEntries: effectiveRuntimeFlags.recordingRetentionMaxEntries
    });
    const platformHealthService = new PlatformHealthService({
        contractsService,
        monitoringService,
        streamControlService,
        streamControlProxyService,
        streamProxyModeEnabled: effectiveRuntimeFlags.streamProxyModeEnabled,
        streamProxyRequired: effectiveRuntimeFlags.streamProxyRequired,
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
            : null;
    const mapsService = new MapsService({
        storage: mapsStorage,
        jobs: mapsJobs,
        corrections: mapsCorrections
    });
    const detectorProxyService = new DetectorProxyService({
        detectorUrl: effectiveRuntimeFlags.detectorUrl
    });

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

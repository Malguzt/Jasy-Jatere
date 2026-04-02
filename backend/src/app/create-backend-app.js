const express = require('express');
const cors = require('cors');
const path = require('path');
const cameraRoutes = require('../../routes/camera');
const savedCamerasRoutes = require('../../routes/saved-cameras');
const mapsRoutes = require('../../routes/maps');
const detectorRoutes = require('../../routes/detector');
const { createMonitoringApiRouter, createMetricsRouter } = require('../../routes/monitoring');
const { createContractsRouter } = require('../../routes/contracts');
const { createStreamsRouter } = require('../../routes/streams');
const { createCameraMotionRouter } = require('../../routes/camera-motion');
const { createHealthRouter } = require('../../routes/health');
const { createInternalConfigRouter } = require('../../routes/internal-config');
const { createRecordingsRouter } = require('../../routes/recordings');
const { createPerceptionRouter } = require('../../routes/perception');
const streamManager = require('../../stream-manager');
const { CameraEventMonitor } = require('../../camera-event-monitor');
const CameraConnectivityMonitor = require('../../camera-connectivity-monitor');
const { resolveCameraStreamUrls, deriveCompanionRtsp, parseResolutionHint } = require('../../rtsp-utils');
const { ContractsService } = require('../domains/contracts/contracts-service');
const { PlatformRuntimeCoordinator } = require('./platform-runtime-coordinator');
const { resolveRuntimeFlags } = require('./runtime-flags');
const { ConnectivityMonitoringService } = require('../domains/monitoring/connectivity-monitoring-service');
const { CameraMotionService } = require('../domains/monitoring/camera-motion-service');
const { PlatformHealthService } = require('../domains/platform/platform-health-service');
const { StreamSyncOrchestrator } = require('../domains/streams/stream-sync-orchestrator');
const { StreamWebSocketGateway } = require('../domains/streams/stream-websocket-gateway');
const { StreamControlService } = require('../domains/streams/stream-control-service');
const { StreamGatewayProxyService } = require('../domains/streams/stream-gateway-proxy-service');
const { CameraMetadataRepository } = require('../infrastructure/repositories/camera-metadata-repository');
const { RecordingCatalogRepository } = require('../infrastructure/repositories/recording-catalog-repository');
const { ObservationEventRepository } = require('../infrastructure/repositories/observation-event-repository');
const { HealthSnapshotRepository } = require('../infrastructure/repositories/health-snapshot-repository');
const { MetadataSqliteStore } = require('../infrastructure/sqlite/metadata-sqlite-store');
const { CameraInventoryService } = require('../domains/cameras/camera-inventory-service');
const { WorkerConfigService } = require('../domains/platform/worker-config-service');
const { RecordingCatalogService } = require('../domains/recordings/recording-catalog-service');
const { RecordingRetentionJob } = require('../domains/recordings/recording-retention-job');
const { PerceptionIngestService } = require('../domains/perception/perception-ingest-service');
const { attachCorrelationId, injectCorrelationIdIntoJson } = require('../http/correlation-id-middleware');

function createBackendApp({
    cameraFile = path.join(__dirname, '..', '..', 'data', 'cameras.json'),
    runtimeFlags = resolveRuntimeFlags()
} = {}) {
    const app = express();

    app.use(cors());
    app.use(express.json());
    app.use(attachCorrelationId());
    app.use(injectCorrelationIdIntoJson());

    const metadataDriver = String(process.env.METADATA_STORE_DRIVER || 'sqlite').toLowerCase();
    const sqliteStore = metadataDriver === 'sqlite' ? new MetadataSqliteStore() : null;
    if (metadataDriver === 'sqlite') {
        sqliteStore.migrate();
    }

    const cameraRepository = new CameraMetadataRepository({
        legacyFile: cameraFile,
        driver: metadataDriver,
        sqliteStore
    });
    const recordingCatalogRepository = new RecordingCatalogRepository({
        driver: metadataDriver,
        sqliteStore
    });
    const observationRepository = new ObservationEventRepository({
        driver: metadataDriver,
        sqliteStore
    });
    const healthSnapshotRepository = new HealthSnapshotRepository({
        driver: metadataDriver,
        sqliteStore
    });
    const cameraInventoryService = new CameraInventoryService({
        repository: cameraRepository
    });
    const cameraEventMonitor = new CameraEventMonitor({
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
    const streamSyncOrchestrator = new StreamSyncOrchestrator({
        cameraFile,
        cameraInventoryService,
        streamManager,
        resolveCameraStreamUrls,
        deriveCompanionRtsp,
        parseResolutionHint
    });
    const streamControlService = new StreamControlService({
        streamManager,
        streamSyncOrchestrator,
        streamWebSocketGatewayEnabled: runtimeFlags.streamWebSocketGatewayEnabled,
        streamWebRtcEnabled: runtimeFlags.streamWebRtcEnabled,
        streamWebRtcRequireHttps: runtimeFlags.streamWebRtcRequireHttps
    });
    const streamGatewayApiUrl = String(process.env.STREAM_GATEWAY_API_URL || '').trim();
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
        streamSyncOrchestrator
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
        recordingRetentionJob
    });
    const perceptionIngestService = new PerceptionIngestService({
        observationRepository,
        recordingCatalogService
    });
    const streamWebSocketGateway = new StreamWebSocketGateway({
        cameraFile,
        cameraInventoryService,
        streamManager,
        resolveCameraStreamUrls
    });
    const platformRuntimeCoordinator = new PlatformRuntimeCoordinator({
        cameraEventMonitor,
        connectivityMonitor,
        streamSyncOrchestrator,
        streamWebSocketGateway,
        recordingRetentionJob,
        streamRuntimeEnabled: runtimeFlags.streamRuntimeEnabled,
        streamWebSocketGatewayEnabled: runtimeFlags.streamWebSocketGatewayEnabled
    });

    app.use('/api/contracts', createContractsRouter({ contractsService }));

    app.use('/api/cameras', cameraRoutes);
    app.use('/api/saved-cameras', savedCamerasRoutes);
    app.use('/api/maps', mapsRoutes);
    app.use('/api/detector', detectorRoutes);
    app.use('/api/monitoring', createMonitoringApiRouter({ monitoringService }));
    app.use('/api/streams', createStreamsRouter({
        streamControlService,
        streamControlProxyService
    }));
    app.use('/api/camera-motion', createCameraMotionRouter({ cameraMotionService }));
    app.use('/api/health', createHealthRouter({ platformHealthService }));
    app.use('/api/internal/config', createInternalConfigRouter({ workerConfigService }));
    app.use('/api/recordings', createRecordingsRouter({ recordingCatalogService }));
    app.use('/api/perception', createPerceptionRouter({ perceptionIngestService }));
    app.use('/', createMetricsRouter({ monitoringService }));
    app.get('/livez', (req, res) => {
        return res.json({
            success: true,
            liveness: platformHealthService.getLivenessSnapshot()
        });
    });
    app.get('/readyz', (req, res) => {
        const readiness = platformHealthService.getReadinessSnapshot();
        return res.status(readiness.ready ? 200 : 503).json({
            success: readiness.ready,
            readiness
        });
    });

    app.use('/recordings', express.static('/app/recordings'));

    return {
        app,
        platformRuntimeCoordinator
    };
}

module.exports = {
    createBackendApp
};

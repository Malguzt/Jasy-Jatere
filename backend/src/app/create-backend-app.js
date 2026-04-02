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
const { ConnectivityMonitoringService } = require('../domains/monitoring/connectivity-monitoring-service');
const { CameraMotionService } = require('../domains/monitoring/camera-motion-service');
const { PlatformHealthService } = require('../domains/platform/platform-health-service');
const { StreamSyncOrchestrator } = require('../domains/streams/stream-sync-orchestrator');
const { StreamWebSocketGateway } = require('../domains/streams/stream-websocket-gateway');
const { StreamControlService } = require('../domains/streams/stream-control-service');
const { CameraMetadataRepository } = require('../infrastructure/repositories/camera-metadata-repository');
const { CameraInventoryService } = require('../domains/cameras/camera-inventory-service');
const { WorkerConfigService } = require('../domains/platform/worker-config-service');
const { RecordingCatalogService } = require('../domains/recordings/recording-catalog-service');
const { PerceptionIngestService } = require('../domains/perception/perception-ingest-service');
const { attachCorrelationId, injectCorrelationIdIntoJson } = require('../http/correlation-id-middleware');

function createBackendApp({
    cameraFile = path.join(__dirname, '..', '..', 'data', 'cameras.json')
} = {}) {
    const app = express();

    app.use(cors());
    app.use(express.json());
    app.use(attachCorrelationId());
    app.use(injectCorrelationIdIntoJson());

    const cameraRepository = new CameraMetadataRepository({
        legacyFile: cameraFile
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
    const monitoringService = new ConnectivityMonitoringService({ connectivityMonitor });
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
        streamSyncOrchestrator
    });
    const cameraMotionService = new CameraMotionService({
        cameraEventMonitor
    });
    const contractsService = new ContractsService();
    const platformHealthService = new PlatformHealthService({
        contractsService,
        monitoringService,
        streamControlService
    });
    const workerConfigService = new WorkerConfigService({
        cameraInventoryService,
        streamSyncOrchestrator
    });
    const recordingCatalogService = new RecordingCatalogService();
    const perceptionIngestService = new PerceptionIngestService({
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
        streamWebSocketGateway
    });

    app.use('/api/contracts', createContractsRouter({ contractsService }));

    // Canonical camera API namespace.
    app.use('/api/cameras', cameraRoutes);
    // Legacy compatibility mount (to be removed after frontend migration).
    app.use('/api', cameraRoutes);
    app.use('/api/saved-cameras', savedCamerasRoutes);
    app.use('/api/maps', mapsRoutes);
    app.use('/api/detector', detectorRoutes);
    app.use('/api/monitoring', createMonitoringApiRouter({ monitoringService }));
    app.use('/api/streams', createStreamsRouter({ streamControlService }));
    app.use('/api/camera-motion', createCameraMotionRouter({ cameraMotionService }));
    app.use('/api/health', createHealthRouter({ platformHealthService }));
    app.use('/api/internal/config', createInternalConfigRouter({ workerConfigService }));
    app.use('/api/recordings', createRecordingsRouter({ recordingCatalogService }));
    app.use('/api/perception', createPerceptionRouter({ perceptionIngestService }));
    app.use('/', createMetricsRouter({ monitoringService }));

    app.use('/recordings', express.static('/app/recordings'));

    return {
        app,
        platformRuntimeCoordinator
    };
}

module.exports = {
    createBackendApp
};

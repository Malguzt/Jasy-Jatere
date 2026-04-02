const express = require('express');
const cors = require('cors');
const path = require('path');
const { createCameraRouter } = require('../../routes/camera');
const { createSavedCamerasRouter } = require('../../routes/saved-cameras');
const { createMapsRouter } = require('../../routes/maps');
const { createDetectorRouter } = require('../../routes/detector');
const { createMonitoringApiRouter, createMetricsRouter } = require('../../routes/monitoring');
const { createContractsRouter } = require('../../routes/contracts');
const { createStreamsRouter } = require('../../routes/streams');
const { createCameraMotionRouter } = require('../../routes/camera-motion');
const { createHealthRouter } = require('../../routes/health');
const { createInternalConfigRouter } = require('../../routes/internal-config');
const { createRecordingsRouter } = require('../../routes/recordings');
const { createPerceptionRouter } = require('../../routes/perception');
const { PlatformRuntimeCoordinator } = require('./platform-runtime-coordinator');
const { createBackendServices } = require('./create-backend-services');
const { resolveRuntimeFlags } = require('./runtime-flags');
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

    const services = createBackendServices({
        cameraFile,
        runtimeFlags
    });
    const platformRuntimeCoordinator = new PlatformRuntimeCoordinator({
        cameraEventMonitor: services.cameraEventMonitor,
        connectivityMonitor: services.connectivityMonitor,
        streamSyncOrchestrator: services.streamSyncOrchestrator,
        streamWebSocketGateway: services.streamWebSocketGateway,
        recordingRetentionJob: services.recordingRetentionJob,
        streamRuntimeEnabled: runtimeFlags.streamRuntimeEnabled,
        streamWebSocketGatewayEnabled:
            runtimeFlags.streamWebSocketGatewayEnabled ||
            (
                runtimeFlags.streamProxyModeEnabled &&
                !!String(runtimeFlags.streamGatewayApiUrl || '').trim()
            )
    });

    app.use('/api/contracts', createContractsRouter({ contractsService: services.contractsService }));

    app.use('/api/cameras', createCameraRouter({ cameraService: services.onvifCameraService }));
    app.use('/api/saved-cameras', createSavedCamerasRouter({ savedCamerasService: services.savedCamerasService }));
    app.use('/api/maps', createMapsRouter({ mapsService: services.mapsService }));
    app.use('/api/detector', createDetectorRouter({ detectorProxyService: services.detectorProxyService }));
    app.use('/api/monitoring', createMonitoringApiRouter({ monitoringService: services.monitoringService }));
    app.use('/api/streams', createStreamsRouter({
        streamControlService: services.streamControlService,
        streamControlProxyService: services.streamControlProxyService
    }));
    app.use('/api/camera-motion', createCameraMotionRouter({ cameraMotionService: services.cameraMotionService }));
    app.use('/api/health', createHealthRouter({ platformHealthService: services.platformHealthService }));
    app.use('/api/internal/config', createInternalConfigRouter({ workerConfigService: services.workerConfigService }));
    app.use('/api/recordings', createRecordingsRouter({ recordingCatalogService: services.recordingCatalogService }));
    app.use('/api/perception', createPerceptionRouter({ perceptionIngestService: services.perceptionIngestService }));
    app.use('/', createMetricsRouter({
        monitoringService: services.monitoringService,
        streamRuntimeService: services.streamControlProxyService || services.streamControlService
    }));
    app.get('/livez', (req, res) => {
        return res.json({
            success: true,
            liveness: services.platformHealthService.getLivenessSnapshot()
        });
    });
    app.get('/readyz', async (req, res) => {
        const readiness = await services.platformHealthService.getReadinessSnapshot();
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

const { createCameraRouter } = require('../../routes/camera');
const { createSavedCamerasRouter } = require('../../routes/saved-cameras');
const { createMapsRouter } = require('../../routes/maps');
const { createDetectorRouter } = require('../../routes/detector');
const { createMonitoringApiRouter, createMetricsRouter } = require('../../routes/monitoring');
const { createContractsRouter } = require('../../routes/contracts');
const { createStreamsRouter } = require('../../routes/streams');
const { createCameraMotionRouter } = require('../../routes/camera-motion');
const { createHealthRouter } = require('../../routes/health');
const { createControlPlaneProbesRouter } = require('../../routes/control-plane-probes');
const { createInternalConfigRouter } = require('../../routes/internal-config');
const { createRecordingsRouter } = require('../../routes/recordings');
const { createPerceptionRouter } = require('../../routes/perception');

function registerBackendRoutes({
    app,
    services
}) {
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
    app.use('/', createControlPlaneProbesRouter({ platformHealthService: services.platformHealthService }));
}

module.exports = {
    registerBackendRoutes
};

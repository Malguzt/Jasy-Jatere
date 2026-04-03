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
    const routeRegistrations = [
        {
            path: '/api/contracts',
            router: createContractsRouter({ contractsService: services.contractsService })
        },
        {
            path: '/api/cameras',
            router: createCameraRouter({ cameraService: services.onvifCameraService })
        },
        {
            path: '/api/saved-cameras',
            router: createSavedCamerasRouter({ savedCamerasService: services.savedCamerasService })
        },
        {
            path: '/api/maps',
            router: createMapsRouter({ mapsService: services.mapsService })
        },
        {
            path: '/api/detector',
            router: createDetectorRouter({ detectorProxyService: services.detectorProxyService })
        },
        {
            path: '/api/monitoring',
            router: createMonitoringApiRouter({ monitoringService: services.monitoringService })
        },
        {
            path: '/api/streams',
            router: createStreamsRouter({
                streamControlService: services.streamControlService,
                streamControlProxyService: services.streamControlProxyService
            })
        },
        {
            path: '/api/camera-motion',
            router: createCameraMotionRouter({ cameraMotionService: services.cameraMotionService })
        },
        {
            path: '/api/health',
            router: createHealthRouter({ platformHealthService: services.platformHealthService })
        },
        {
            path: '/api/internal/config',
            router: createInternalConfigRouter({ workerConfigService: services.workerConfigService })
        },
        {
            path: '/api/recordings',
            router: createRecordingsRouter({ recordingCatalogService: services.recordingCatalogService })
        },
        {
            path: '/api/perception',
            router: createPerceptionRouter({ perceptionIngestService: services.perceptionIngestService })
        },
        {
            path: '/',
            router: createMetricsRouter({
                monitoringService: services.monitoringService,
                streamRuntimeService: services.streamControlProxyService || services.streamControlService
            })
        },
        {
            path: '/',
            router: createControlPlaneProbesRouter({ platformHealthService: services.platformHealthService })
        }
    ];

    routeRegistrations.forEach(({ path, router }) => {
        app.use(path, router);
    });
}

module.exports = {
    registerBackendRoutes
};

const test = require('node:test');
const assert = require('node:assert/strict');

const { createBackendServices } = require('../src/app/create-backend-services');

function makeRuntimeFlags(overrides = {}) {
    return {
        streamGatewayApiUrl: 'http://stream-gateway:4100/api/internal/streams',
        streamProxyModeEnabled: true,
        streamProxyRequired: true,
        streamRuntimeEnabled: false,
        streamWebSocketGatewayEnabled: false,
        streamWebRtcEnabled: false,
        streamWebRtcRequireHttps: true,
        streamWebRtcSignalingUrl: '',
        streamWebRtcIceServersJson: '',
        streamWebRtcSignalingRetries: 1,
        streamPublicBaseUrl: '',
        recordingRetentionEnabled: false,
        recordingRetentionIntervalMs: 60000,
        recordingRetentionMaxAgeDays: null,
        recordingRetentionMaxEntries: null,
        recordingsMaxSizeGb: 50,
        recordingsDeleteOldestBatch: 100,
        observationMaxEntries: 2500,
        mapsDataDir: '',
        mapperUrl: 'http://mapper:5002',
        mapMapperTimeoutMs: 45000,
        mapMaxJobsHistory: 120,
        mapPlanAEnabled: true,
        mapPlanBEnabled: true,
        mapPlanCEnabled: true,
        mapPlanDEnabled: true,
        mapApplyManualCorrections: true,
        mapCorrectionHistoryLimit: 20,
        ...overrides
    };
}

test('createBackendServices returns composed control-plane services', () => {
    const services = createBackendServices({
        runtimeFlags: makeRuntimeFlags()
    });

    assert.equal(typeof services, 'object');
    assert.equal(typeof services.cameraInventoryService?.listCameras, 'function');
    assert.equal(typeof services.streamControlProxyService?.getRuntimeSnapshot, 'function');
    assert.equal(services.streamControlService, null);
    assert.equal(services.streamSyncOrchestrator, null);
    assert.equal(typeof services.platformHealthService?.getReadinessSnapshot, 'function');
    assert.equal(typeof services.streamWebSocketGateway?.attach, 'function');
    assert.equal(typeof services.recordingRetentionJob?.runOnce, 'function');
    assert.equal(typeof services.mapsService?.getHealth, 'function');
    const mapsHealth = services.mapsService.getHealth();
    assert.equal(mapsHealth.runtime.mapperUrl, 'http://mapper:5002');
    assert.equal(mapsHealth.runtime.mapperTimeoutMs, 45000);
    assert.equal(mapsHealth.runtime.maxJobs, 120);
    assert.equal(mapsHealth.runtime.plans.A, true);
});

test('createBackendServices leaves stream services unavailable when gateway api url is missing', () => {
    const services = createBackendServices({
        runtimeFlags: makeRuntimeFlags({
            streamGatewayApiUrl: ''
        })
    });

    assert.equal(services.streamControlProxyService, null);
    assert.equal(services.streamControlService, null);
    assert.equal(services.streamSyncOrchestrator, null);
    assert.equal(services.streamWebSocketGateway, null);
});

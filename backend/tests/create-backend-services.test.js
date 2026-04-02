const test = require('node:test');
const assert = require('node:assert/strict');

const { createBackendServices } = require('../src/app/create-backend-services');

function makeRuntimeFlags(overrides = {}) {
    return {
        streamGatewayApiUrl: '',
        streamProxyModeEnabled: false,
        streamProxyRequired: false,
        streamRuntimeEnabled: true,
        streamWebSocketGatewayEnabled: true,
        streamWebRtcEnabled: false,
        streamWebRtcRequireHttps: true,
        streamWebRtcSignalingUrl: '',
        streamWebRtcIceServersJson: '',
        streamWebRtcSignalingRetries: 1,
        streamPublicBaseUrl: '',
        legacyCompatExportsEnabled: false,
        recordingRetentionEnabled: false,
        recordingRetentionIntervalMs: 60000,
        recordingRetentionMaxAgeDays: null,
        recordingRetentionMaxEntries: null,
        recordingsMaxSizeGb: 50,
        recordingsDeleteOldestBatch: 100,
        observationMaxEntries: 2500,
        ...overrides
    };
}

test('createBackendServices returns composed control-plane services', () => {
    const services = createBackendServices({
        cameraFile: '/tmp/non-existent-cameras-services.json',
        runtimeFlags: makeRuntimeFlags()
    });

    assert.equal(typeof services, 'object');
    assert.equal(typeof services.cameraInventoryService?.listCameras, 'function');
    assert.equal(typeof services.streamControlService?.getRuntimeSnapshot, 'function');
    assert.equal(typeof services.platformHealthService?.getReadinessSnapshot, 'function');
    assert.equal(typeof services.streamWebSocketGateway?.attach, 'function');
    assert.equal(typeof services.recordingRetentionJob?.runOnce, 'function');
});

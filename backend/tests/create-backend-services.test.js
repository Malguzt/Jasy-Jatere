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
        runtimeFlags: makeRuntimeFlags()
    });

    assert.equal(typeof services, 'object');
    assert.equal(typeof services.cameraInventoryService?.listCameras, 'function');
    assert.equal(typeof services.streamControlService?.getRuntimeSnapshot, 'function');
    assert.equal(typeof services.platformHealthService?.getReadinessSnapshot, 'function');
    assert.equal(typeof services.streamWebSocketGateway?.attach, 'function');
    assert.equal(typeof services.recordingRetentionJob?.runOnce, 'function');
});

test('createBackendServices skips local stream runtime stack when proxy runtime is active', () => {
    const services = createBackendServices({
        runtimeFlags: makeRuntimeFlags({
            streamProxyModeEnabled: true,
            streamProxyRequired: true,
            streamGatewayApiUrl: 'http://stream-gateway:4100/api/internal/streams',
            streamRuntimeEnabled: false
        })
    });

    assert.equal(typeof services.streamControlProxyService?.getRuntimeSnapshot, 'function');
    assert.equal(services.streamControlService, null);
    assert.equal(services.streamSyncOrchestrator, null);
    assert.equal(typeof services.streamWebSocketGateway?.attach, 'function');
});

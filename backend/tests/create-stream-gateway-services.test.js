const test = require('node:test');
const assert = require('node:assert/strict');

const { createStreamGatewayServices } = require('../src/app/create-stream-gateway-services');

function makeRuntimeFlags(overrides = {}) {
    return {
        streamRuntimeEnabled: true,
        streamWebSocketGatewayEnabled: true,
        streamWebRtcEnabled: false,
        streamWebRtcRequireHttps: true,
        streamWebRtcSignalingUrl: '',
        streamWebRtcIceServersJson: '',
        streamWebRtcSignalingRetries: 1,
        streamPublicBaseUrl: '',
        ...overrides
    };
}

test('createStreamGatewayServices returns composed stream-gateway services', () => {
    const services = createStreamGatewayServices({
        runtimeFlags: makeRuntimeFlags()
    });

    assert.equal(typeof services, 'object');
    assert.equal(typeof services.cameraInventoryService?.listCameras, 'function');
    assert.equal(typeof services.streamSyncOrchestrator?.syncNow, 'function');
    assert.equal(typeof services.streamControlService?.getRuntimeSnapshot, 'function');
    assert.equal(typeof services.streamWebSocketGateway?.attach, 'function');
});

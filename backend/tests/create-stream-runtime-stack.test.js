const test = require('node:test');
const assert = require('node:assert/strict');

const { createStreamRuntimeStack } = require('../src/app/create-stream-runtime-stack');

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

test('createStreamRuntimeStack returns composed stream runtime services', () => {
    const streamManagerInstance = {
        syncKeepaliveConfigs() {},
        handleConnection() {},
        getRuntimeState() {
            return { activeStreams: 0 };
        }
    };
    const cameraInventoryService = {
        listCameras() {
            return [];
        },
        findCamera() {
            return null;
        }
    };

    const stack = createStreamRuntimeStack({
        cameraInventoryService,
        runtimeFlags: makeRuntimeFlags(),
        streamManagerInstance
    });

    assert.equal(typeof stack.streamSyncOrchestrator?.syncNow, 'function');
    assert.equal(typeof stack.streamControlService?.getRuntimeSnapshot, 'function');
    assert.equal(typeof stack.streamWebSocketGateway?.attach, 'function');
    assert.equal(stack.streamSyncOrchestrator.streamManager, streamManagerInstance);
    assert.equal(stack.streamControlService.streamManager, streamManagerInstance);
    assert.equal(stack.streamWebSocketGateway.streamManager, streamManagerInstance);
    assert.equal(stack.streamControlRuntimeOptions.streamWebSocketGatewayEnabled, true);
    assert.equal(stack.streamControlRuntimeOptions.streamWebRtcEnabled, false);
});

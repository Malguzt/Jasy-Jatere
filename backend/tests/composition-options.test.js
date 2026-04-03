const test = require('node:test');
const assert = require('node:assert/strict');

const { buildStreamControlRuntimeOptions } = require('../src/app/composition-options');

test('buildStreamControlRuntimeOptions maps stream runtime flags transparently', () => {
    const options = buildStreamControlRuntimeOptions({
        streamWebSocketGatewayEnabled: true,
        streamWebRtcEnabled: true,
        streamWebRtcRequireHttps: false,
        streamWebRtcSignalingUrl: 'http://signal',
        streamWebRtcIceServersJson: '[]',
        streamWebRtcSignalingRetries: 3,
        streamWebRtcSignalingTimeoutMs: 9000,
        streamPublicBaseUrl: 'https://public.example'
    });

    assert.equal(options.streamWebSocketGatewayEnabled, true);
    assert.equal(options.streamWebRtcEnabled, true);
    assert.equal(options.streamWebRtcRequireHttps, false);
    assert.equal(options.streamWebRtcSignalingUrl, 'http://signal');
    assert.equal(options.streamWebRtcIceServersJson, '[]');
    assert.equal(options.streamWebRtcSignalingRetries, 3);
    assert.equal(options.webrtcSignalingTimeoutMs, 9000);
    assert.equal(options.streamPublicBaseUrl, 'https://public.example');
});

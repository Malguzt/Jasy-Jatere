const test = require('node:test');
const assert = require('node:assert/strict');

const { parseBoolEnv, resolveRuntimeFlags } = require('../src/app/runtime-flags');

test('parseBoolEnv parses common truthy/falsy env variants', () => {
    assert.equal(parseBoolEnv('1', false), true);
    assert.equal(parseBoolEnv('true', false), true);
    assert.equal(parseBoolEnv('yes', false), true);
    assert.equal(parseBoolEnv('0', true), false);
    assert.equal(parseBoolEnv('false', true), false);
    assert.equal(parseBoolEnv('off', true), false);
    assert.equal(parseBoolEnv(undefined, true), true);
    assert.equal(parseBoolEnv('', false), false);
    assert.equal(parseBoolEnv('unknown', true), true);
});

test('resolveRuntimeFlags returns stream-related runtime toggles', () => {
    const flags = resolveRuntimeFlags({
        STREAM_RUNTIME_ENABLED: '0',
        STREAM_WEBSOCKET_GATEWAY_ENABLED: 'false'
    });

    assert.deepEqual(flags, {
        streamRuntimeEnabled: false,
        streamWebSocketGatewayEnabled: false
    });
});

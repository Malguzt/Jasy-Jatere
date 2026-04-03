const test = require('node:test');
const assert = require('node:assert/strict');

const {
    parseBoolEnv,
    parsePositiveIntEnv,
    parsePositiveNumberEnv,
    parseOptionalPositiveIntEnv,
    resolveRuntimeFlags
} = require('../src/app/runtime-flags');

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
        STREAM_GATEWAY_API_URL: 'http://stream-gateway:4100/api/internal/streams',
        STREAM_PUBLIC_BASE_URL: 'https://streams.example.com',
        STREAM_WEBRTC_SIGNALING_URL: 'http://stream-gateway:4100/webrtc/sessions',
        STREAM_WEBRTC_ICE_SERVERS_JSON: '[{\"urls\":\"stun:stun.example.com:3478\"}]',
        STREAM_WEBRTC_SIGNALING_RETRIES: '2',
        STREAM_WEBRTC_SIGNALING_TIMEOUT_MS: '9000',
        STREAM_PROXY_MODE_ENABLED: '1',
        STREAM_PROXY_REQUIRED: '1',
        STREAM_RUNTIME_ENABLED: '1',
        STREAM_WEBSOCKET_GATEWAY_ENABLED: 'true',
        STREAM_WEBRTC_ENABLED: '1',
        STREAM_WEBRTC_REQUIRE_HTTPS: '0',
        RECORDING_RETENTION_ENABLED: '1',
        RECORDING_RETENTION_INTERVAL_MS: '120000',
        RECORDING_RETENTION_MAX_AGE_DAYS: '14',
        RECORDING_RETENTION_MAX_ENTRIES: '500',
        RECORDINGS_MAX_SIZE_GB: '64.5',
        RECORDINGS_DELETE_OLDEST_BATCH: '77',
        OBSERVATION_MAX_ENTRIES: '900'
    });

    assert.deepEqual(flags, {
        detectorUrl: 'http://localhost:5000',
        streamGatewayApiUrl: 'http://stream-gateway:4100/api/internal/streams',
        streamPublicBaseUrl: 'https://streams.example.com',
        streamWebRtcSignalingUrl: 'http://stream-gateway:4100/webrtc/sessions',
        streamWebRtcIceServersJson: '[{"urls":"stun:stun.example.com:3478"}]',
        streamWebRtcSignalingRetries: 2,
        streamWebRtcSignalingTimeoutMs: 9000,
        streamProxyModeEnabled: true,
        streamProxyRequired: true,
        streamRuntimeEnabled: false,
        streamWebSocketGatewayEnabled: false,
        streamWebRtcEnabled: true,
        streamWebRtcRequireHttps: false,
        recordingRetentionEnabled: true,
        recordingRetentionIntervalMs: 120000,
        recordingRetentionMaxAgeDays: 14,
        recordingRetentionMaxEntries: 500,
        recordingsMaxSizeGb: 64.5,
        recordingsDeleteOldestBatch: 77,
        observationMaxEntries: 900
    });
});

test('resolveRuntimeFlags normalizes detector url from env', () => {
    const flags = resolveRuntimeFlags({
        DETECTOR_URL: 'http://detector:5000/'
    });

    assert.equal(flags.detectorUrl, 'http://detector:5000/');
});

test('resolveRuntimeFlags enables proxy mode by default when stream gateway api url is set', () => {
    const flags = resolveRuntimeFlags({
        STREAM_GATEWAY_API_URL: 'http://stream-gateway:4100/api/internal/streams'
    });

    assert.equal(flags.streamProxyModeEnabled, true);
    assert.equal(flags.streamProxyRequired, true);
    assert.equal(flags.streamRuntimeEnabled, false);
    assert.equal(flags.streamWebSocketGatewayEnabled, false);
});

test('resolveRuntimeFlags keeps proxy mode enabled even when env requests disable', () => {
    const flags = resolveRuntimeFlags({
        STREAM_GATEWAY_API_URL: 'http://stream-gateway:4100/api/internal/streams',
        STREAM_PROXY_MODE_ENABLED: '0',
        STREAM_PROXY_REQUIRED: '0',
        STREAM_RUNTIME_ENABLED: '1',
        STREAM_WEBSOCKET_GATEWAY_ENABLED: '1'
    });

    assert.equal(flags.streamProxyModeEnabled, true);
    assert.equal(flags.streamProxyRequired, true);
    assert.equal(flags.streamRuntimeEnabled, false);
    assert.equal(flags.streamWebSocketGatewayEnabled, false);
});

test('resolveRuntimeFlags keeps websocket gateway disabled when gateway-only mode is enforced', () => {
    const flags = resolveRuntimeFlags({
        STREAM_GATEWAY_API_URL: '',
        STREAM_PROXY_MODE_ENABLED: '0',
        STREAM_PROXY_REQUIRED: '0'
    });

    assert.equal(flags.streamProxyModeEnabled, true);
    assert.equal(flags.streamWebSocketGatewayEnabled, false);
});

test('parsePositiveIntEnv and parseOptionalPositiveIntEnv normalize retention settings', () => {
    assert.equal(parsePositiveIntEnv('60000', 1), 60000);
    assert.equal(parsePositiveIntEnv('0', 42), 42);
    assert.equal(parsePositiveIntEnv('bad', 42), 42);

    assert.equal(parseOptionalPositiveIntEnv('30'), 30);
    assert.equal(parseOptionalPositiveIntEnv(''), null);
    assert.equal(parseOptionalPositiveIntEnv('0'), null);
    assert.equal(parseOptionalPositiveIntEnv('bad'), null);
});

test('parsePositiveNumberEnv normalizes decimal settings', () => {
    assert.equal(parsePositiveNumberEnv('60.5', 1), 60.5);
    assert.equal(parsePositiveNumberEnv('0', 42), 42);
    assert.equal(parsePositiveNumberEnv('bad', 42), 42);
});

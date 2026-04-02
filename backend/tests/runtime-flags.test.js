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
        STREAM_RUNTIME_ENABLED: '0',
        STREAM_WEBSOCKET_GATEWAY_ENABLED: 'false',
        STREAM_WEBRTC_ENABLED: '1',
        STREAM_WEBRTC_REQUIRE_HTTPS: '0',
        LEGACY_COMPAT_EXPORTS_ENABLED: '1',
        RECORDING_RETENTION_ENABLED: '1',
        RECORDING_RETENTION_INTERVAL_MS: '120000',
        RECORDING_RETENTION_MAX_AGE_DAYS: '14',
        RECORDING_RETENTION_MAX_ENTRIES: '500',
        RECORDINGS_MAX_SIZE_GB: '64.5',
        RECORDINGS_DELETE_OLDEST_BATCH: '77',
        OBSERVATION_MAX_ENTRIES: '900'
    });

    assert.deepEqual(flags, {
        streamRuntimeEnabled: false,
        streamWebSocketGatewayEnabled: false,
        streamWebRtcEnabled: true,
        streamWebRtcRequireHttps: false,
        legacyCompatExportsEnabled: true,
        recordingRetentionEnabled: true,
        recordingRetentionIntervalMs: 120000,
        recordingRetentionMaxAgeDays: 14,
        recordingRetentionMaxEntries: 500,
        recordingsMaxSizeGb: 64.5,
        recordingsDeleteOldestBatch: 77,
        observationMaxEntries: 900
    });
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

function parseBoolEnv(value, fallback = true) {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

function parsePositiveIntEnv(value, fallback) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
    return fallback;
}

function parsePositiveNumberEnv(value, fallback) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return fallback;
}

function parseOptionalPositiveIntEnv(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
    return null;
}

function resolveRuntimeFlags(env = process.env) {
    const streamGatewayApiUrl = String(env.STREAM_GATEWAY_API_URL || '').trim();
    const streamPublicBaseUrl = String(env.STREAM_PUBLIC_BASE_URL || '').trim();
    const streamWebRtcSignalingUrl = String(env.STREAM_WEBRTC_SIGNALING_URL || '').trim();
    const streamProxyModeEnabled = parseBoolEnv(env.STREAM_PROXY_MODE_ENABLED, !!streamGatewayApiUrl);
    const streamProxyRequired = parseBoolEnv(env.STREAM_PROXY_REQUIRED, streamProxyModeEnabled);

    return {
        streamGatewayApiUrl,
        streamPublicBaseUrl,
        streamWebRtcSignalingUrl,
        streamProxyModeEnabled,
        streamProxyRequired,
        streamRuntimeEnabled: streamProxyModeEnabled
            ? false
            : parseBoolEnv(env.STREAM_RUNTIME_ENABLED, true),
        streamWebSocketGatewayEnabled: streamProxyModeEnabled
            ? false
            : parseBoolEnv(env.STREAM_WEBSOCKET_GATEWAY_ENABLED, true),
        streamWebRtcEnabled: parseBoolEnv(env.STREAM_WEBRTC_ENABLED, false),
        streamWebRtcRequireHttps: parseBoolEnv(env.STREAM_WEBRTC_REQUIRE_HTTPS, true),
        legacyCompatExportsEnabled: parseBoolEnv(env.LEGACY_COMPAT_EXPORTS_ENABLED, false),
        recordingRetentionEnabled: parseBoolEnv(env.RECORDING_RETENTION_ENABLED, false),
        recordingRetentionIntervalMs: parsePositiveIntEnv(env.RECORDING_RETENTION_INTERVAL_MS, 60 * 60 * 1000),
        recordingRetentionMaxAgeDays: parseOptionalPositiveIntEnv(env.RECORDING_RETENTION_MAX_AGE_DAYS),
        recordingRetentionMaxEntries: parseOptionalPositiveIntEnv(env.RECORDING_RETENTION_MAX_ENTRIES),
        recordingsMaxSizeGb: parsePositiveNumberEnv(env.RECORDINGS_MAX_SIZE_GB, 50),
        recordingsDeleteOldestBatch: parsePositiveIntEnv(env.RECORDINGS_DELETE_OLDEST_BATCH, 100),
        observationMaxEntries: parsePositiveIntEnv(env.OBSERVATION_MAX_ENTRIES, 2500)
    };
}

module.exports = {
    parseBoolEnv,
    parsePositiveIntEnv,
    parsePositiveNumberEnv,
    parseOptionalPositiveIntEnv,
    resolveRuntimeFlags
};

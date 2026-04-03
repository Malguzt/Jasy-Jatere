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
    const detectorUrl = String(env.DETECTOR_URL || 'http://localhost:5000').trim();
    const streamGatewayApiUrl = String(env.STREAM_GATEWAY_API_URL || '').trim();
    const streamPublicBaseUrl = String(env.STREAM_PUBLIC_BASE_URL || '').trim();
    const streamWebRtcSignalingUrl = String(env.STREAM_WEBRTC_SIGNALING_URL || '').trim();
    const streamWebRtcIceServersJson = String(env.STREAM_WEBRTC_ICE_SERVERS_JSON || '').trim();
    const streamProxyModeEnabled = true;
    const streamProxyRequired = true;

    return {
        detectorUrl: detectorUrl || 'http://localhost:5000',
        streamGatewayApiUrl,
        streamPublicBaseUrl,
        streamWebRtcSignalingUrl,
        streamWebRtcIceServersJson,
        streamWebRtcSignalingRetries: parsePositiveIntEnv(env.STREAM_WEBRTC_SIGNALING_RETRIES, 1),
        streamWebRtcSignalingTimeoutMs: parsePositiveIntEnv(env.STREAM_WEBRTC_SIGNALING_TIMEOUT_MS, 7000),
        streamProxyModeEnabled,
        streamProxyRequired,
        streamRuntimeEnabled: false,
        streamWebSocketGatewayEnabled: false,
        streamWebRtcEnabled: parseBoolEnv(env.STREAM_WEBRTC_ENABLED, false),
        streamWebRtcRequireHttps: parseBoolEnv(env.STREAM_WEBRTC_REQUIRE_HTTPS, true),
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

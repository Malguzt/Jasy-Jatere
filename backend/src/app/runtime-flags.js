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

function parseStringEnv(value, fallback = '') {
    const normalized = String(value || '').trim();
    return normalized || fallback;
}

function resolveRuntimeFlags(env = process.env) {
    const detectorUrl = parseStringEnv(env.DETECTOR_URL, 'http://localhost:5000');
    const reconstructorUrl = parseStringEnv(env.RECONSTRUCTOR_URL, 'http://localhost:5001');
    const streamGatewayApiUrl = parseStringEnv(env.STREAM_GATEWAY_API_URL, '');
    const streamGatewayWsBaseUrl = parseStringEnv(env.STREAM_GATEWAY_WS_BASE_URL, '');
    const streamPublicBaseUrl = parseStringEnv(env.STREAM_PUBLIC_BASE_URL, '');
    const streamWebRtcSignalingUrl = parseStringEnv(env.STREAM_WEBRTC_SIGNALING_URL, '');
    const streamWebRtcIceServersJson = parseStringEnv(env.STREAM_WEBRTC_ICE_SERVERS_JSON, '');
    const streamProxyModeEnabled = parseBoolEnv(env.STREAM_PROXY_MODE_ENABLED, !!streamGatewayApiUrl);
    const streamProxyRequired = parseBoolEnv(env.STREAM_PROXY_REQUIRED, streamProxyModeEnabled);
    const metadataStoreDriver = parseStringEnv(env.METADATA_STORE_DRIVER, 'sqlite').toLowerCase();
    const metadataSqlitePath = parseStringEnv(env.METADATA_SQLITE_PATH, '');
    const cameraCredentialsMasterKey = parseStringEnv(env.CAMERA_CREDENTIALS_MASTER_KEY, '');
    const cameraDiscoverSubnets = parseStringEnv(env.CAMERA_DISCOVER_SUBNETS, '');
    const cameraDiscoverCommonSubnets = parseStringEnv(env.CAMERA_DISCOVER_COMMON_SUBNETS, '');
    const cameraDiscoverPorts = parseStringEnv(env.CAMERA_DISCOVER_PORTS, '');
    const cameraDiscoverIpRange = parseStringEnv(env.CAMERA_DISCOVER_IP_RANGE, '');

    return {
        detectorUrl,
        reconstructorUrl,
        streamGatewayApiUrl,
        streamGatewayWsBaseUrl,
        streamGatewayApiTimeoutMs: parsePositiveIntEnv(env.STREAM_GATEWAY_API_TIMEOUT_MS, 5000),
        streamPublicBaseUrl,
        streamWebRtcSignalingUrl,
        streamWebRtcIceServersJson,
        streamWebRtcSignalingRetries: parsePositiveIntEnv(env.STREAM_WEBRTC_SIGNALING_RETRIES, 1),
        streamWebRtcSignalingTimeoutMs: parsePositiveIntEnv(env.STREAM_WEBRTC_SIGNALING_TIMEOUT_MS, 7000),
        streamProxyModeEnabled,
        streamProxyRequired,
        streamRuntimeEnabled: streamProxyModeEnabled
            ? false
            : parseBoolEnv(env.STREAM_RUNTIME_ENABLED, true),
        streamWebSocketGatewayEnabled: streamProxyModeEnabled
            ? false
            : parseBoolEnv(env.STREAM_WEBSOCKET_GATEWAY_ENABLED, false),
        streamWebRtcEnabled: parseBoolEnv(env.STREAM_WEBRTC_ENABLED, false),
        streamWebRtcRequireHttps: parseBoolEnv(env.STREAM_WEBRTC_REQUIRE_HTTPS, true),
        cameraKeepaliveSyncMs: parsePositiveIntEnv(env.CAMERA_KEEPALIVE_SYNC_MS, 10000),
        cameraDiscoverProbeTimeoutMs: parsePositiveIntEnv(env.CAMERA_DISCOVER_PROBE_TIMEOUT_MS, 6000),
        cameraDiscoverConnectTimeoutMs: parsePositiveIntEnv(env.CAMERA_DISCOVER_CONNECT_TIMEOUT_MS, 400),
        cameraDiscoverHttpTimeoutMs: parsePositiveIntEnv(env.CAMERA_DISCOVER_HTTP_TIMEOUT_MS, 900),
        cameraDiscoverConcurrency: parsePositiveIntEnv(env.CAMERA_DISCOVER_CONCURRENCY, 80),
        cameraDiscoverSubnets,
        cameraDiscoverCommonSubnets,
        cameraDiscoverPorts,
        cameraDiscoverIpRange,
        metadataStoreDriver,
        metadataSqlitePath,
        cameraCredentialsMasterKey,
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
    parseStringEnv,
    parsePositiveIntEnv,
    parsePositiveNumberEnv,
    parseOptionalPositiveIntEnv,
    resolveRuntimeFlags
};

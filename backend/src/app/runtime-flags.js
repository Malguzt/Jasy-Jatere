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

function parseOptionalPositiveIntEnv(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
    return null;
}

function resolveRuntimeFlags(env = process.env) {
    return {
        streamRuntimeEnabled: parseBoolEnv(env.STREAM_RUNTIME_ENABLED, true),
        streamWebSocketGatewayEnabled: parseBoolEnv(env.STREAM_WEBSOCKET_GATEWAY_ENABLED, true),
        recordingRetentionEnabled: parseBoolEnv(env.RECORDING_RETENTION_ENABLED, false),
        recordingRetentionIntervalMs: parsePositiveIntEnv(env.RECORDING_RETENTION_INTERVAL_MS, 60 * 60 * 1000),
        recordingRetentionMaxAgeDays: parseOptionalPositiveIntEnv(env.RECORDING_RETENTION_MAX_AGE_DAYS),
        recordingRetentionMaxEntries: parseOptionalPositiveIntEnv(env.RECORDING_RETENTION_MAX_ENTRIES)
    };
}

module.exports = {
    parseBoolEnv,
    parsePositiveIntEnv,
    parseOptionalPositiveIntEnv,
    resolveRuntimeFlags
};

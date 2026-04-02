function parseBoolEnv(value, fallback = true) {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

function resolveRuntimeFlags(env = process.env) {
    return {
        streamRuntimeEnabled: parseBoolEnv(env.STREAM_RUNTIME_ENABLED, true),
        streamWebSocketGatewayEnabled: parseBoolEnv(env.STREAM_WEBSOCKET_GATEWAY_ENABLED, true)
    };
}

module.exports = {
    parseBoolEnv,
    resolveRuntimeFlags
};

function buildRepositoryCompatOptions(runtimeFlags = {}) {
    const enabled = runtimeFlags.legacyCompatExportsEnabled === true;
    return {
        dualWritePrimary: enabled,
        dualWriteLegacy: enabled,
        legacyReadFallback: enabled
    };
}

function buildLegacyFileFallbackOptions(runtimeFlags = {}) {
    return {
        legacyFileFallbackEnabled: runtimeFlags.legacyCompatExportsEnabled === true
    };
}

function buildStreamControlRuntimeOptions(runtimeFlags = {}) {
    return {
        streamWebSocketGatewayEnabled: runtimeFlags.streamWebSocketGatewayEnabled,
        streamWebRtcEnabled: runtimeFlags.streamWebRtcEnabled,
        streamWebRtcRequireHttps: runtimeFlags.streamWebRtcRequireHttps,
        streamWebRtcSignalingUrl: runtimeFlags.streamWebRtcSignalingUrl,
        streamWebRtcIceServersJson: runtimeFlags.streamWebRtcIceServersJson,
        streamWebRtcSignalingRetries: runtimeFlags.streamWebRtcSignalingRetries,
        webrtcSignalingTimeoutMs: runtimeFlags.streamWebRtcSignalingTimeoutMs,
        streamPublicBaseUrl: runtimeFlags.streamPublicBaseUrl
    };
}

module.exports = {
    buildRepositoryCompatOptions,
    buildLegacyFileFallbackOptions,
    buildStreamControlRuntimeOptions
};

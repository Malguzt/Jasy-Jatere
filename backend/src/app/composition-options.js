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
    buildLegacyFileFallbackOptions,
    buildStreamControlRuntimeOptions
};

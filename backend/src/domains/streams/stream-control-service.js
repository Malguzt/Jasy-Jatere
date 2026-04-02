function streamControlError(status, message, code = null, details = null) {
    const error = new Error(message || 'Stream control error');
    error.status = status;
    if (code) error.code = code;
    if (details !== null && details !== undefined) error.details = details;
    return error;
}

class StreamControlService {
    constructor({
        streamManager,
        streamSyncOrchestrator,
        streamWebSocketGatewayEnabled = true,
        streamWebRtcEnabled = false,
        streamWebRtcRequireHttps = true,
        now = () => Date.now()
    } = {}) {
        this.streamManager = streamManager;
        this.streamSyncOrchestrator = streamSyncOrchestrator;
        this.streamWebSocketGatewayEnabled = streamWebSocketGatewayEnabled !== false;
        this.streamWebRtcEnabled = streamWebRtcEnabled === true;
        this.streamWebRtcRequireHttps = streamWebRtcRequireHttps !== false;
        this.now = now;
        this.lastManualSync = null;
    }

    getCapabilities({ requestHeaders = {} } = {}) {
        const forwardedProto = String(requestHeaders['x-forwarded-proto'] || '').trim().toLowerCase();
        const origin = String(requestHeaders.origin || '').trim().toLowerCase();
        const secureByOrigin = origin.startsWith('https://');
        const secureByForwardedProto = forwardedProto === 'https';
        const secureContext = secureByOrigin || secureByForwardedProto;

        const webrtcConfigured = this.streamWebRtcEnabled;
        const webrtcEnabled = webrtcConfigured && (!this.streamWebRtcRequireHttps || secureContext);
        const webrtcReason = webrtcEnabled
            ? null
            : (webrtcConfigured && this.streamWebRtcRequireHttps && !secureContext
                ? 'webrtc-requires-https'
                : 'webrtc-disabled');

        const jsmpegEnabled = this.streamWebSocketGatewayEnabled;
        const defaultTransport = webrtcEnabled ? 'webrtc' : (jsmpegEnabled ? 'jsmpeg' : null);

        return {
            defaultTransport,
            preferredOrder: ['webrtc', 'jsmpeg'],
            transports: {
                webrtc: {
                    configured: webrtcConfigured,
                    enabled: webrtcEnabled,
                    requireHttps: this.streamWebRtcRequireHttps,
                    reason: webrtcReason
                },
                jsmpeg: {
                    enabled: jsmpegEnabled
                }
            }
        };
    }

    getRuntimeSnapshot() {
        if (!this.streamManager || typeof this.streamManager.getStatsSnapshot !== 'function') {
            throw streamControlError(500, 'Stream manager not configured', 'STREAM_MANAGER_NOT_CONFIGURED');
        }

        const streamStats = this.streamManager.getStatsSnapshot();
        const entries = Object.values(streamStats || {});
        const summary = {
            streams: entries.length,
            activeViewerStreams: entries.filter((entry) => !!entry?.active).length,
            keepaliveDesired: entries.filter((entry) => !!entry?.keepalive?.desired).length,
            keepaliveActive: entries.filter((entry) => !!entry?.keepalive?.active).length
        };

        const syncRuntime =
            this.streamSyncOrchestrator && typeof this.streamSyncOrchestrator.getRuntimeState === 'function'
                ? this.streamSyncOrchestrator.getRuntimeState()
                : null;

        return {
            summary,
            streamStats,
            syncRuntime,
            lastManualSync: this.lastManualSync
        };
    }

    async triggerManualSync(body = {}) {
        if (!this.streamSyncOrchestrator || typeof this.streamSyncOrchestrator.syncNow !== 'function') {
            throw streamControlError(500, 'Stream sync orchestrator not configured', 'STREAM_SYNC_NOT_CONFIGURED');
        }

        const reason = typeof body.reason === 'string' && body.reason.trim()
            ? body.reason.trim()
            : 'manual';
        const requestedBy = typeof body.requestedBy === 'string' && body.requestedBy.trim()
            ? body.requestedBy.trim()
            : 'operator';

        const result = await this.streamSyncOrchestrator.syncNow();
        const manualSync = {
            requestedAt: this.now(),
            reason,
            requestedBy,
            result
        };
        this.lastManualSync = manualSync;

        if (!result || result.success !== true) {
            throw streamControlError(500, 'Manual stream sync failed', 'STREAM_SYNC_FAILED', {
                result: result || null
            });
        }

        return manualSync;
    }
}

module.exports = {
    StreamControlService,
    streamControlError
};

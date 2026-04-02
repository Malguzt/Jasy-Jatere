function streamControlError(status, message, code = null, details = null) {
    const error = new Error(message || 'Stream control error');
    error.status = status;
    if (code) error.code = code;
    if (details !== null && details !== undefined) error.details = details;
    return error;
}

function stripTrailingSlash(value = '') {
    return String(value || '').replace(/\/+$/, '');
}

function toWebSocketBaseUrl(value = '') {
    const normalized = stripTrailingSlash(value);
    if (!normalized) return '';
    if (/^wss?:\/\//i.test(normalized)) return normalized;
    if (/^https?:\/\//i.test(normalized)) {
        return normalized.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
    }
    return '';
}

class StreamControlService {
    constructor({
        streamManager,
        cameraInventoryService = null,
        streamSyncOrchestrator,
        streamWebSocketGatewayEnabled = true,
        streamWebRtcEnabled = false,
        streamWebRtcRequireHttps = true,
        streamPublicBaseUrl = process.env.STREAM_PUBLIC_BASE_URL || '',
        now = () => Date.now()
    } = {}) {
        this.streamManager = streamManager;
        this.cameraInventoryService = cameraInventoryService;
        this.streamSyncOrchestrator = streamSyncOrchestrator;
        this.streamWebSocketGatewayEnabled = streamWebSocketGatewayEnabled !== false;
        this.streamWebRtcEnabled = streamWebRtcEnabled === true;
        this.streamWebRtcRequireHttps = streamWebRtcRequireHttps !== false;
        this.streamPublicBaseUrl = String(streamPublicBaseUrl || '').trim();
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

    ensureCameraExists(cameraId) {
        const normalizedCameraId = String(cameraId || '').trim();
        if (!normalizedCameraId) {
            throw streamControlError(400, 'cameraId is required', 'STREAM_CAMERA_ID_REQUIRED');
        }

        if (!this.cameraInventoryService || typeof this.cameraInventoryService.findCamera !== 'function') {
            return normalizedCameraId;
        }

        const camera = this.cameraInventoryService.findCamera(normalizedCameraId);
        if (!camera) {
            throw streamControlError(404, `Camera not found: ${normalizedCameraId}`, 'STREAM_CAMERA_NOT_FOUND');
        }
        return normalizedCameraId;
    }

    buildJsmpegTransportDescriptor(cameraId) {
        const path = `/stream/${encodeURIComponent(cameraId)}`;
        const webSocketBaseUrl = toWebSocketBaseUrl(this.streamPublicBaseUrl);
        return {
            enabled: true,
            path,
            url: webSocketBaseUrl ? `${webSocketBaseUrl}${path}` : null
        };
    }

    getSessionDescriptor({ cameraId, requestHeaders = {} } = {}) {
        const normalizedCameraId = this.ensureCameraExists(cameraId);
        const capabilities = this.getCapabilities({ requestHeaders });
        const jsmpegEnabled = capabilities?.transports?.jsmpeg?.enabled === true;
        const webrtc = capabilities?.transports?.webrtc || {};
        const webrtcEnabled = webrtc.enabled === true;
        const selectedTransport = jsmpegEnabled ? 'jsmpeg' : (webrtcEnabled ? 'webrtc' : null);

        if (!selectedTransport) {
            throw streamControlError(503, 'No stream transport available', 'STREAM_TRANSPORT_UNAVAILABLE', {
                cameraId: normalizedCameraId,
                capabilities
            });
        }

        return {
            cameraId: normalizedCameraId,
            selectedTransport,
            preferredTransport: capabilities?.defaultTransport || null,
            transports: {
                jsmpeg: jsmpegEnabled
                    ? this.buildJsmpegTransportDescriptor(normalizedCameraId)
                    : { enabled: false, path: null, url: null },
                webrtc: {
                    enabled: webrtcEnabled,
                    reason: webrtc.reason || null
                }
            },
            capabilities
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

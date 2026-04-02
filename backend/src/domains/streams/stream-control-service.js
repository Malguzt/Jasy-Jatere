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
        streamWebRtcSignalingUrl = process.env.STREAM_WEBRTC_SIGNALING_URL || '',
        fetchImpl = fetch,
        webrtcSignalingTimeoutMs = Number(process.env.STREAM_WEBRTC_SIGNALING_TIMEOUT_MS || 7000),
        streamPublicBaseUrl = process.env.STREAM_PUBLIC_BASE_URL || '',
        now = () => Date.now()
    } = {}) {
        this.streamManager = streamManager;
        this.cameraInventoryService = cameraInventoryService;
        this.streamSyncOrchestrator = streamSyncOrchestrator;
        this.streamWebSocketGatewayEnabled = streamWebSocketGatewayEnabled !== false;
        this.streamWebRtcEnabled = streamWebRtcEnabled === true;
        this.streamWebRtcRequireHttps = streamWebRtcRequireHttps !== false;
        this.streamWebRtcSignalingUrl = String(streamWebRtcSignalingUrl || '').trim();
        this.fetchImpl = fetchImpl;
        this.webrtcSignalingTimeoutMs = Number.isFinite(Number(webrtcSignalingTimeoutMs))
            ? Math.max(1000, Number(webrtcSignalingTimeoutMs))
            : 7000;
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
        const webrtcSignalingConfigured = !!this.streamWebRtcSignalingUrl;
        const webrtcEnabled = webrtcConfigured
            && webrtcSignalingConfigured
            && (!this.streamWebRtcRequireHttps || secureContext);
        const webrtcReason = webrtcEnabled
            ? null
            : (!webrtcConfigured
                ? 'webrtc-disabled'
                : (!webrtcSignalingConfigured
                    ? 'webrtc-signaling-missing'
                    : (this.streamWebRtcRequireHttps && !secureContext
                ? 'webrtc-requires-https'
                        : 'webrtc-disabled')));

        const jsmpegEnabled = this.streamWebSocketGatewayEnabled;
        const defaultTransport = webrtcEnabled ? 'webrtc' : (jsmpegEnabled ? 'jsmpeg' : null);

        return {
            defaultTransport,
            preferredOrder: ['webrtc', 'jsmpeg'],
            transports: {
                webrtc: {
                    configured: webrtcConfigured,
                    signalingConfigured: webrtcSignalingConfigured,
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
        const selectedTransport = webrtcEnabled
            ? 'webrtc'
            : (jsmpegEnabled ? 'jsmpeg' : null);

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
                    reason: webrtc.reason || null,
                    signalingPath: webrtcEnabled ? '/api/streams/webrtc/sessions' : null
                }
            },
            capabilities
        };
    }

    ensureWebRtcSessionAvailable({ requestHeaders = {} } = {}) {
        const capabilities = this.getCapabilities({ requestHeaders });
        const webrtc = capabilities?.transports?.webrtc || {};
        if (webrtc.enabled !== true) {
            throw streamControlError(503, 'WebRTC transport is not available', 'STREAM_WEBRTC_UNAVAILABLE', {
                reason: webrtc.reason || 'webrtc-disabled'
            });
        }
        if (typeof this.fetchImpl !== 'function') {
            throw streamControlError(500, 'Fetch implementation is not available', 'STREAM_WEBRTC_FETCH_UNAVAILABLE');
        }
    }

    async createWebRtcSession({
        cameraId,
        offerSdp,
        offerType = 'offer',
        requestHeaders = {}
    } = {}) {
        const normalizedCameraId = this.ensureCameraExists(cameraId);
        const normalizedOfferSdp = String(offerSdp || '').trim();
        const normalizedOfferType = String(offerType || 'offer').trim().toLowerCase();
        if (!normalizedOfferSdp) {
            throw streamControlError(400, 'offerSdp is required', 'STREAM_WEBRTC_OFFER_REQUIRED');
        }
        if (normalizedOfferType !== 'offer') {
            throw streamControlError(400, 'offerType must be "offer"', 'STREAM_WEBRTC_OFFER_TYPE_INVALID');
        }

        this.ensureWebRtcSessionAvailable({ requestHeaders });

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.webrtcSignalingTimeoutMs);
        try {
            const response = await this.fetchImpl(this.streamWebRtcSignalingUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    cameraId: normalizedCameraId,
                    offer: {
                        type: 'offer',
                        sdp: normalizedOfferSdp
                    }
                }),
                signal: controller.signal
            });
            let payload = null;
            try {
                payload = await response.json();
            } catch (error) {}

            if (!response.ok) {
                throw streamControlError(
                    502,
                    payload?.error || `WebRTC signaling responded with ${response.status}`,
                    'STREAM_WEBRTC_SIGNALING_UPSTREAM_ERROR',
                    { status: response.status, payload: payload || null }
                );
            }

            const answerSdp = String(payload?.answer?.sdp || payload?.answerSdp || '').trim();
            const answerType = String(payload?.answer?.type || payload?.answerType || 'answer').trim().toLowerCase();
            if (!answerSdp) {
                throw streamControlError(502, 'WebRTC signaling returned empty answer SDP', 'STREAM_WEBRTC_SIGNALING_INVALID_ANSWER');
            }
            if (answerType !== 'answer') {
                throw streamControlError(502, 'WebRTC signaling returned unsupported answer type', 'STREAM_WEBRTC_SIGNALING_INVALID_ANSWER_TYPE');
            }

            return {
                cameraId: normalizedCameraId,
                sessionId: payload?.sessionId || null,
                answer: {
                    type: 'answer',
                    sdp: answerSdp
                },
                iceServers: Array.isArray(payload?.iceServers) ? payload.iceServers : []
            };
        } catch (error) {
            if (error?.name === 'AbortError') {
                throw streamControlError(504, 'WebRTC signaling request timeout', 'STREAM_WEBRTC_SIGNALING_TIMEOUT');
            }
            if (error?.status) throw error;
            throw streamControlError(
                502,
                error?.message || String(error),
                'STREAM_WEBRTC_SIGNALING_UNREACHABLE'
            );
        } finally {
            clearTimeout(timeout);
        }
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

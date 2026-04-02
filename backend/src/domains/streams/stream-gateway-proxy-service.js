const { streamControlError } = require('./stream-control-service');

function stripTrailingSlash(value = '') {
    return String(value || '').replace(/\/+$/, '');
}

function pickHeaderValue(headers, key) {
    if (!headers || typeof headers !== 'object') return '';
    const direct = headers[key];
    const fallback = direct === undefined ? headers[String(key).toLowerCase()] : direct;
    if (Array.isArray(fallback)) {
        return String(fallback[0] || '').trim();
    }
    return String(fallback || '').trim();
}

class StreamGatewayProxyService {
    constructor({
        gatewayApiBaseUrl = process.env.STREAM_GATEWAY_API_URL || null,
        fetchImpl = fetch,
        requestTimeoutMs = Number(process.env.STREAM_GATEWAY_API_TIMEOUT_MS || 5000)
    } = {}) {
        this.gatewayApiBaseUrl = gatewayApiBaseUrl ? stripTrailingSlash(gatewayApiBaseUrl) : null;
        this.fetchImpl = fetchImpl;
        this.requestTimeoutMs = Number.isFinite(Number(requestTimeoutMs))
            ? Math.max(1000, Number(requestTimeoutMs))
            : 5000;
    }

    ensureConfigured() {
        if (!this.gatewayApiBaseUrl) {
            throw streamControlError(500, 'Stream gateway API URL is not configured', 'STREAM_GATEWAY_API_URL_MISSING');
        }
        if (typeof this.fetchImpl !== 'function') {
            throw streamControlError(500, 'Fetch implementation is not available', 'STREAM_GATEWAY_FETCH_UNAVAILABLE');
        }
    }

    buildForwardHeaders(requestHeaders = {}) {
        const forwarded = {};
        const supportedKeys = ['origin', 'x-forwarded-proto', 'x-forwarded-host', 'x-forwarded-port'];
        supportedKeys.forEach((key) => {
            const value = pickHeaderValue(requestHeaders, key);
            if (value) forwarded[key] = value;
        });
        return forwarded;
    }

    async requestJson(pathname, { method = 'GET', body = null, headers = {} } = {}) {
        this.ensureConfigured();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
        try {
            const response = await this.fetchImpl(`${this.gatewayApiBaseUrl}${pathname}`, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    ...headers
                },
                body: body ? JSON.stringify(body) : null,
                signal: controller.signal
            });

            let payload = null;
            try {
                payload = await response.json();
            } catch (error) {}

            if (!response.ok) {
                throw streamControlError(
                    502,
                    payload?.error || `Stream gateway responded with ${response.status}`,
                    'STREAM_GATEWAY_UPSTREAM_ERROR',
                    { status: response.status, payload: payload || null }
                );
            }

            return payload;
        } catch (error) {
            if (error?.name === 'AbortError') {
                throw streamControlError(504, 'Stream gateway request timeout', 'STREAM_GATEWAY_TIMEOUT');
            }
            if (error?.status) throw error;
            throw streamControlError(
                502,
                error?.message || String(error),
                'STREAM_GATEWAY_UNREACHABLE'
            );
        } finally {
            clearTimeout(timeout);
        }
    }

    async getRuntimeSnapshot() {
        const payload = await this.requestJson('/runtime');
        if (!payload?.success) {
            throw streamControlError(502, 'Invalid runtime payload from stream gateway', 'STREAM_GATEWAY_INVALID_RUNTIME');
        }
        return {
            summary: payload.summary || null,
            streamStats: payload.streamStats || {},
            syncRuntime: payload.syncRuntime || null,
            lastManualSync: payload.lastManualSync || null
        };
    }

    async triggerManualSync(body = {}) {
        const payload = await this.requestJson('/sync', {
            method: 'POST',
            body
        });
        if (!payload?.success) {
            throw streamControlError(502, 'Invalid sync payload from stream gateway', 'STREAM_GATEWAY_INVALID_SYNC');
        }
        return payload.sync || null;
    }

    async getCapabilities({ requestHeaders = {} } = {}) {
        const payload = await this.requestJson('/capabilities', {
            headers: this.buildForwardHeaders(requestHeaders)
        });
        if (!payload?.success || !payload?.capabilities) {
            throw streamControlError(502, 'Invalid capabilities payload from stream gateway', 'STREAM_GATEWAY_INVALID_CAPABILITIES');
        }
        return payload.capabilities;
    }

    async getSessionDescriptor({ cameraId, requestHeaders = {} } = {}) {
        const normalizedCameraId = String(cameraId || '').trim();
        if (!normalizedCameraId) {
            throw streamControlError(400, 'cameraId is required', 'STREAM_CAMERA_ID_REQUIRED');
        }
        const payload = await this.requestJson(`/sessions/${encodeURIComponent(normalizedCameraId)}`, {
            headers: this.buildForwardHeaders(requestHeaders)
        });
        if (!payload?.success || !payload?.session) {
            throw streamControlError(502, 'Invalid session payload from stream gateway', 'STREAM_GATEWAY_INVALID_SESSION');
        }
        return payload.session;
    }
}

module.exports = {
    StreamGatewayProxyService
};

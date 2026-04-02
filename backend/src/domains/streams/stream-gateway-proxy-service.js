const { streamControlError } = require('./stream-control-service');

function stripTrailingSlash(value = '') {
    return String(value || '').replace(/\/+$/, '');
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

    async requestJson(pathname, { method = 'GET', body = null } = {}) {
        this.ensureConfigured();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
        try {
            const response = await this.fetchImpl(`${this.gatewayApiBaseUrl}${pathname}`, {
                method,
                headers: {
                    'Content-Type': 'application/json'
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

    async getCapabilities() {
        const payload = await this.requestJson('/capabilities');
        if (!payload?.success || !payload?.capabilities) {
            throw streamControlError(502, 'Invalid capabilities payload from stream gateway', 'STREAM_GATEWAY_INVALID_CAPABILITIES');
        }
        return payload.capabilities;
    }
}

module.exports = {
    StreamGatewayProxyService
};

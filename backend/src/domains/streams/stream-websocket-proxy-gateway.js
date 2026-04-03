const WebSocket = require('ws');

function stripTrailingSlash(value = '') {
    return String(value || '').replace(/\/+$/, '');
}

function resolveGatewayWsBaseUrl({
    gatewayApiBaseUrl = '',
    gatewayWsBaseUrl = ''
} = {}) {
    const configuredWsBase = stripTrailingSlash(gatewayWsBaseUrl);
    if (configuredWsBase) return configuredWsBase;

    const normalizedApiBase = stripTrailingSlash(gatewayApiBaseUrl);
    if (!normalizedApiBase) return '';
    const withoutApiSuffix = normalizedApiBase.replace(/\/api\/internal\/streams$/i, '');
    if (/^wss?:\/\//i.test(withoutApiSuffix)) return withoutApiSuffix;
    if (/^https?:\/\//i.test(withoutApiSuffix)) {
        return withoutApiSuffix.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
    }
    return '';
}

class StreamWebSocketProxyGateway {
    constructor({
        gatewayApiBaseUrl = '',
        gatewayWsBaseUrl = '',
        webSocketLib = WebSocket,
        logger = console
    } = {}) {
        this.webSocketLib = webSocketLib;
        this.logger = logger;
        this.gatewayWsBaseUrl = resolveGatewayWsBaseUrl({
            gatewayApiBaseUrl,
            gatewayWsBaseUrl
        });
        this.wss = null;
    }

    buildUpstreamUrl(requestUrl) {
        const normalizedRequestUrl = String(requestUrl || '').trim();
        if (!normalizedRequestUrl || !normalizedRequestUrl.startsWith('/stream/')) return null;
        if (!this.gatewayWsBaseUrl) return null;
        return `${this.gatewayWsBaseUrl}${normalizedRequestUrl}`;
    }

    normalizeCloseCode(code, fallback = 1011) {
        const parsed = Number(code);
        if (Number.isInteger(parsed) && parsed >= 1000 && parsed <= 4999) return parsed;
        return fallback;
    }

    normalizeCloseReason(reason, fallback = 'stream-proxy-error') {
        const text = String(reason || fallback);
        if (!text) return fallback;
        return text.slice(0, 120);
    }

    closeSocketSafe(socket, code = 1011, reason = 'stream-proxy-error') {
        if (!socket || typeof socket.close !== 'function') return;
        try {
            socket.close(
                this.normalizeCloseCode(code, 1011),
                this.normalizeCloseReason(reason, 'stream-proxy-error')
            );
        } catch (error) {}
    }

    isOpen(socket) {
        return socket && socket.readyState === this.webSocketLib.OPEN;
    }

    isConnecting(socket) {
        return socket && socket.readyState === this.webSocketLib.CONNECTING;
    }

    relayConnection(clientSocket, req) {
        const upstreamUrl = this.buildUpstreamUrl(req?.url);
        if (!upstreamUrl) {
            this.closeSocketSafe(clientSocket, 1008, 'invalid-stream-route');
            return;
        }

        let upstreamSocket;
        try {
            upstreamSocket = new this.webSocketLib(upstreamUrl);
        } catch (error) {
            this.logger.error('[STREAM-PROXY] Cannot open upstream WS:', error?.message || error);
            this.closeSocketSafe(clientSocket, 1011, 'stream-upstream-open-failed');
            return;
        }

        upstreamSocket.on('message', (data, isBinary) => {
            if (!this.isOpen(clientSocket)) return;
            try {
                clientSocket.send(data, { binary: !!isBinary });
            } catch (error) {
                this.closeSocketSafe(clientSocket, 1011, 'stream-downstream-send-failed');
            }
        });

        clientSocket.on('message', (data, isBinary) => {
            if (!this.isOpen(upstreamSocket)) return;
            try {
                upstreamSocket.send(data, { binary: !!isBinary });
            } catch (error) {
                this.closeSocketSafe(upstreamSocket, 1011, 'stream-upstream-send-failed');
            }
        });

        upstreamSocket.on('close', (code, reason) => {
            if (this.isOpen(clientSocket) || this.isConnecting(clientSocket)) {
                this.closeSocketSafe(clientSocket, code || 1000, reason || 'stream-upstream-closed');
            }
        });

        clientSocket.on('close', (code, reason) => {
            if (this.isOpen(upstreamSocket) || this.isConnecting(upstreamSocket)) {
                this.closeSocketSafe(upstreamSocket, code || 1000, reason || 'stream-client-closed');
            }
        });

        upstreamSocket.on('error', (error) => {
            this.logger.error('[STREAM-PROXY] Upstream WS error:', error?.message || error);
            this.closeSocketSafe(clientSocket, 1011, 'stream-upstream-error');
        });

        clientSocket.on('error', (error) => {
            this.logger.error('[STREAM-PROXY] Downstream WS error:', error?.message || error);
            this.closeSocketSafe(upstreamSocket, 1011, 'stream-client-error');
        });
    }

    attach(server) {
        this.wss = new this.webSocketLib.Server({ server });
        this.wss.on('connection', (clientSocket, req) => {
            this.relayConnection(clientSocket, req);
        });
        return this.wss;
    }

    stop() {
        if (!this.wss || typeof this.wss.close !== 'function') {
            this.wss = null;
            return;
        }
        this.wss.close();
        this.wss = null;
    }
}

module.exports = {
    StreamWebSocketProxyGateway,
    resolveGatewayWsBaseUrl
};

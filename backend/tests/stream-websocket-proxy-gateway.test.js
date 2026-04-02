const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
    StreamWebSocketProxyGateway,
    resolveGatewayWsBaseUrl
} = require('../src/domains/streams/stream-websocket-proxy-gateway');

function createFakeWebSocketLib() {
    const upstreamSockets = [];

    class FakeWebSocket extends EventEmitter {
        constructor(url) {
            super();
            this.url = url;
            this.readyState = FakeWebSocket.OPEN;
            this.sent = [];
            this.closed = [];
            upstreamSockets.push(this);
        }

        send(data, options = {}) {
            this.sent.push({ data, options });
        }

        close(code, reason) {
            this.readyState = FakeWebSocket.CLOSED;
            this.closed.push({ code, reason });
            this.emit('close', code, reason);
        }
    }

    FakeWebSocket.CONNECTING = 0;
    FakeWebSocket.OPEN = 1;
    FakeWebSocket.CLOSED = 3;

    class FakeWebSocketServer extends EventEmitter {
        close() {
            this.closed = true;
        }
    }

    FakeWebSocket.Server = FakeWebSocketServer;

    return { webSocketLib: FakeWebSocket, upstreamSockets };
}

function createFakeClientSocket(webSocketLib) {
    const socket = new EventEmitter();
    socket.readyState = webSocketLib.OPEN;
    socket.sent = [];
    socket.closed = [];
    socket.send = (data, options = {}) => {
        socket.sent.push({ data, options });
    };
    socket.close = (code, reason) => {
        socket.readyState = webSocketLib.CLOSED;
        socket.closed.push({ code, reason });
        socket.emit('close', code, reason);
    };
    return socket;
}

test('resolveGatewayWsBaseUrl derives ws endpoint from internal stream gateway api url', () => {
    const derived = resolveGatewayWsBaseUrl({
        gatewayApiBaseUrl: 'http://stream-gateway:4100/api/internal/streams'
    });
    assert.equal(derived, 'ws://stream-gateway:4100');
});

test('relayConnection closes client socket when request path is invalid', () => {
    const { webSocketLib } = createFakeWebSocketLib();
    const gateway = new StreamWebSocketProxyGateway({
        gatewayApiBaseUrl: 'http://stream-gateway:4100/api/internal/streams',
        webSocketLib,
        logger: { error: () => {} }
    });
    const client = createFakeClientSocket(webSocketLib);
    gateway.relayConnection(client, { url: '/invalid-path' });
    assert.equal(client.closed.length, 1);
    assert.equal(client.closed[0].code, 1008);
});

test('relayConnection proxies websocket messages both directions', () => {
    const { webSocketLib, upstreamSockets } = createFakeWebSocketLib();
    const gateway = new StreamWebSocketProxyGateway({
        gatewayApiBaseUrl: 'http://stream-gateway:4100/api/internal/streams',
        webSocketLib,
        logger: { error: () => {} }
    });
    const client = createFakeClientSocket(webSocketLib);

    gateway.relayConnection(client, { url: '/stream/cam-1' });
    assert.equal(upstreamSockets.length, 1);
    const upstream = upstreamSockets[0];
    assert.equal(upstream.url, 'ws://stream-gateway:4100/stream/cam-1');

    upstream.emit('message', Buffer.from('upstream-frame'), true);
    assert.equal(client.sent.length, 1);
    assert.equal(String(client.sent[0].data), 'upstream-frame');
    assert.equal(client.sent[0].options.binary, true);

    client.emit('message', Buffer.from('downstream-frame'), true);
    assert.equal(upstream.sent.length, 1);
    assert.equal(String(upstream.sent[0].data), 'downstream-frame');
    assert.equal(upstream.sent[0].options.binary, true);
});

test('attach and stop manage websocket server lifecycle', () => {
    const { webSocketLib } = createFakeWebSocketLib();
    const gateway = new StreamWebSocketProxyGateway({
        gatewayApiBaseUrl: 'http://stream-gateway:4100/api/internal/streams',
        webSocketLib,
        logger: { error: () => {} }
    });

    const wss = gateway.attach({ name: 'http-server' });
    assert.equal(typeof wss.on, 'function');
    gateway.stop();
    gateway.stop();
    assert.equal(gateway.wss, null);
});

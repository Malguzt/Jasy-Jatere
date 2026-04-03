const test = require('node:test');
const assert = require('node:assert/strict');

const { StreamWebSocketGateway } = require('../src/domains/streams/stream-websocket-gateway');

function makeGateway(overrides = {}) {
    return new StreamWebSocketGateway({
        cameraInventoryService: overrides.cameraInventoryService,
        streamManager: overrides.streamManager || { handleConnection: () => {} },
        resolveCameraStreamUrls: overrides.resolveCameraStreamUrls || ((camera) => ({
            rtspUrl: camera.rtspUrl,
            allRtspUrls: camera.allRtspUrls || []
        })),
        webSocketLib: overrides.webSocketLib,
        logger: overrides.logger || { error: () => {} }
    });
}

test('extractCameraId resolves id from /stream/:id URL', () => {
    const gateway = makeGateway();
    assert.equal(gateway.extractCameraId('/stream/cam-123'), 'cam-123');
    assert.equal(gateway.extractCameraId('/foo/bar'), null);
});

test('handleConnection closes websocket when URL does not match stream pattern', () => {
    let closed = 0;
    const gateway = makeGateway();
    const ws = { close: () => { closed += 1; } };
    gateway.handleConnection(ws, { url: '/not-stream/cam-1' });
    assert.equal(closed, 1);
});

test('handleConnection closes websocket when inventory is unavailable', () => {
    let closed = 0;
    let errors = 0;
    const gateway = makeGateway({
        cameraInventoryService: {
            findCamera: () => {
                throw new Error('inventory unavailable');
            }
        },
        logger: {
            error: () => {
                errors += 1;
            }
        }
    });
    const ws = { close: () => { closed += 1; } };
    gateway.handleConnection(ws, { url: '/stream/cam-1' });
    assert.equal(closed, 1);
    assert.equal(errors, 1);
});

test('handleConnection closes websocket when inventory is unavailable from list path', () => {
    let closed = 0;
    let errors = 0;
    const gateway = makeGateway({
        cameraInventoryService: {
            listCameras: () => {
                throw new Error('inventory unavailable');
            }
        },
        logger: {
            error: () => {
                errors += 1;
            }
        }
    });
    const ws = { close: () => { closed += 1; } };
    gateway.handleConnection(ws, { url: '/stream/cam-1' });
    assert.equal(closed, 1);
    assert.equal(errors, 1);
});

test('handleConnection closes websocket when camera does not exist', () => {
    let closed = 0;
    let errors = 0;
    const gateway = makeGateway({
        cameraInventoryService: {
            listCameras: () => ([{ id: 'cam-2', rtspUrl: 'rtsp://cam-2' }])
        },
        logger: {
            error: () => {
                errors += 1;
            }
        }
    });
    const ws = { close: () => { closed += 1; } };
    gateway.handleConnection(ws, { url: '/stream/cam-1' });
    assert.equal(closed, 1);
    assert.equal(errors, 1);
});

test('handleConnection delegates to streamManager for valid camera', () => {
    const calls = [];
    const gateway = makeGateway({
        cameraInventoryService: {
            listCameras: () => ([
                {
                    id: 'cam-1',
                    type: 'combined',
                    rtspUrl: 'combined',
                    allRtspUrls: ['rtsp://cam-1/low', 'rtsp://cam-1/high']
                }
            ])
        },
        streamManager: {
            handleConnection: (...args) => {
                calls.push(args);
            }
        }
    });

    const ws = { close: () => {} };
    gateway.handleConnection(ws, { url: '/stream/cam-1' });

    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], 'cam-1');
    assert.equal(calls[0][2], 'combined');
    assert.equal(calls[0][3], 'combined');
    assert.deepEqual(calls[0][4], ['rtsp://cam-1/low', 'rtsp://cam-1/high']);
});

test('attach creates websocket server and binds connection handler', () => {
    const events = {};
    class FakeWebSocketServer {
        constructor() {}
        on(eventName, handler) {
            events[eventName] = handler;
        }
    }

    const gateway = makeGateway({
        webSocketLib: { Server: FakeWebSocketServer }
    });

    const wss = gateway.attach({ name: 'http-server' });
    assert.ok(wss instanceof FakeWebSocketServer);
    assert.equal(typeof events.connection, 'function');
});

test('stop closes websocket server when attached', () => {
    let closeCalls = 0;
    class FakeWebSocketServer {
        constructor() {}
        on() {}
        close() {
            closeCalls += 1;
        }
    }

    const gateway = makeGateway({
        webSocketLib: { Server: FakeWebSocketServer }
    });

    gateway.attach({ name: 'http-server' });
    gateway.stop();
    gateway.stop();

    assert.equal(closeCalls, 1);
});

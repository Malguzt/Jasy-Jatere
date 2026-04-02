const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { startHttpRuntime } = require('../src/app/http-runtime-bootstrap');

class FakeProcess extends EventEmitter {
    constructor() {
        super();
        this.exitCodes = [];
    }

    exit(code) {
        this.exitCodes.push(code);
    }
}

test('startHttpRuntime listens and starts runtime coordinator', () => {
    const fakeServer = {
        close() {}
    };
    let listenPort = null;
    let listenHost = null;
    const app = {
        listen(port, host, callback) {
            listenPort = port;
            listenHost = host;
            callback();
            return fakeServer;
        }
    };
    let startedWithServer = null;
    const platformRuntimeCoordinator = {
        start(server) {
            startedWithServer = server;
        },
        stop() {}
    };
    const processRef = new FakeProcess();

    startHttpRuntime({
        app,
        platformRuntimeCoordinator,
        port: 4010,
        processRef,
        logger: { log() {}, error() {} }
    });

    assert.equal(listenPort, 4010);
    assert.equal(listenHost, '0.0.0.0');
    assert.equal(startedWithServer, fakeServer);
    assert.equal(processRef.listenerCount('SIGINT') > 0, true);
    assert.equal(processRef.listenerCount('SIGTERM') > 0, true);
});

test('startHttpRuntime graceful shutdown stops runtime and exits with 0 on close success', () => {
    let closeCount = 0;
    const fakeServer = {
        close(callback) {
            closeCount += 1;
            callback();
        }
    };
    const app = {
        listen(_port, _host, callback) {
            callback();
            return fakeServer;
        }
    };
    let stopCount = 0;
    const platformRuntimeCoordinator = {
        start() {},
        stop() {
            stopCount += 1;
        }
    };
    const processRef = new FakeProcess();

    const runtime = startHttpRuntime({
        app,
        platformRuntimeCoordinator,
        port: 4011,
        processRef,
        logger: { log() {}, error() {} }
    });

    processRef.emit('SIGTERM');
    processRef.emit('SIGINT');

    assert.equal(closeCount, 1);
    assert.equal(stopCount, 1);
    assert.deepEqual(processRef.exitCodes, [0]);
    runtime.disposeSignalHandlers();
    assert.equal(processRef.listenerCount('SIGINT'), 0);
    assert.equal(processRef.listenerCount('SIGTERM'), 0);
});

test('startHttpRuntime exits with 1 when server close fails', () => {
    const fakeServer = {
        close(callback) {
            callback(new Error('close failed'));
        }
    };
    const app = {
        listen(_port, _host, callback) {
            callback();
            return fakeServer;
        }
    };
    const platformRuntimeCoordinator = {
        start() {},
        stop() {}
    };
    const processRef = new FakeProcess();

    startHttpRuntime({
        app,
        platformRuntimeCoordinator,
        port: 4012,
        processRef,
        logger: { log() {}, error() {} }
    });

    processRef.emit('SIGINT');
    assert.deepEqual(processRef.exitCodes, [1]);
});

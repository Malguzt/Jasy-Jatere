const test = require('node:test');
const assert = require('node:assert/strict');

const { PlatformRuntimeCoordinator } = require('../src/app/platform-runtime-coordinator');

test('start invokes start/attach on configured runtime components', () => {
    const calls = [];
    const coordinator = new PlatformRuntimeCoordinator({
        cameraEventMonitor: {
            start: () => calls.push('cameraEventMonitor.start')
        },
        connectivityMonitor: {
            start: () => calls.push('connectivityMonitor.start')
        },
        streamSyncOrchestrator: {
            start: () => calls.push('streamSyncOrchestrator.start')
        },
        streamWebSocketGateway: {
            attach: (server) => calls.push(`streamWebSocketGateway.attach:${server.id}`)
        }
    });

    coordinator.start({ id: 'http-server-1' });

    assert.deepEqual(calls, [
        'cameraEventMonitor.start',
        'connectivityMonitor.start',
        'streamSyncOrchestrator.start',
        'streamWebSocketGateway.attach:http-server-1'
    ]);
});

test('start tolerates missing runtime components', () => {
    const coordinator = new PlatformRuntimeCoordinator({});
    coordinator.start({ id: 'noop' });
    assert.ok(true);
});

test('stop invokes shutdown methods in reverse runtime order when available', () => {
    const calls = [];
    const coordinator = new PlatformRuntimeCoordinator({
        cameraEventMonitor: {
            stop: () => calls.push('cameraEventMonitor.stop')
        },
        connectivityMonitor: {
            stop: () => calls.push('connectivityMonitor.stop')
        },
        streamSyncOrchestrator: {
            stop: () => calls.push('streamSyncOrchestrator.stop')
        },
        streamWebSocketGateway: {
            stop: () => calls.push('streamWebSocketGateway.stop')
        }
    });

    coordinator.stop();

    assert.deepEqual(calls, [
        'streamWebSocketGateway.stop',
        'streamSyncOrchestrator.stop',
        'connectivityMonitor.stop',
        'cameraEventMonitor.stop'
    ]);
});

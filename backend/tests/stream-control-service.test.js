const test = require('node:test');
const assert = require('node:assert/strict');

const { StreamControlService } = require('../src/domains/streams/stream-control-service');

test('getRuntimeSnapshot returns summary, stats, and sync runtime state', () => {
    const service = new StreamControlService({
        streamManager: {
            getStatsSnapshot: () => ({
                cam1: {
                    active: true,
                    keepalive: { desired: true, active: true }
                },
                cam2: {
                    active: false,
                    keepalive: { desired: true, active: false }
                }
            })
        },
        streamSyncOrchestrator: {
            getRuntimeState: () => ({ hasPeriodicTimer: true, syncIntervalMs: 10000 })
        }
    });

    const runtime = service.getRuntimeSnapshot();
    assert.equal(runtime.summary.streams, 2);
    assert.equal(runtime.summary.activeViewerStreams, 1);
    assert.equal(runtime.summary.keepaliveDesired, 2);
    assert.equal(runtime.summary.keepaliveActive, 1);
    assert.equal(runtime.syncRuntime.hasPeriodicTimer, true);
    assert.equal(runtime.lastManualSync, null);
});

test('triggerManualSync stores metadata and returns successful result', async () => {
    const service = new StreamControlService({
        streamManager: {
            getStatsSnapshot: () => ({})
        },
        streamSyncOrchestrator: {
            syncNow: async () => ({ success: true, keepaliveCount: 2 })
        },
        now: () => 1700000000123
    });

    const sync = await service.triggerManualSync({
        reason: 'operator-request',
        requestedBy: 'ops-console'
    });

    assert.equal(sync.requestedAt, 1700000000123);
    assert.equal(sync.reason, 'operator-request');
    assert.equal(sync.requestedBy, 'ops-console');
    assert.equal(sync.result.success, true);

    const runtime = service.getRuntimeSnapshot();
    assert.equal(runtime.lastManualSync.reason, 'operator-request');
});

test('triggerManualSync throws when orchestrator reports failed sync', async () => {
    const service = new StreamControlService({
        streamManager: {
            getStatsSnapshot: () => ({})
        },
        streamSyncOrchestrator: {
            syncNow: async () => ({ success: false, error: 'unreachable' })
        }
    });

    await assert.rejects(
        () => service.triggerManualSync({ reason: 'manual' }),
        (error) => Number(error?.status) === 500 && error.code === 'STREAM_SYNC_FAILED'
    );
});

test('getCapabilities prefers WebRTC when enabled and secure context is detected', () => {
    const service = new StreamControlService({
        streamManager: { getStatsSnapshot: () => ({}) },
        streamSyncOrchestrator: { getRuntimeState: () => ({}) },
        streamWebSocketGatewayEnabled: true,
        streamWebRtcEnabled: true,
        streamWebRtcRequireHttps: true
    });

    const caps = service.getCapabilities({
        requestHeaders: {
            'x-forwarded-proto': 'https'
        }
    });
    assert.equal(caps.defaultTransport, 'webrtc');
    assert.equal(caps.transports.webrtc.enabled, true);
    assert.equal(caps.transports.jsmpeg.enabled, true);
});

test('getCapabilities falls back to jsmpeg when WebRTC requires https and context is insecure', () => {
    const service = new StreamControlService({
        streamManager: { getStatsSnapshot: () => ({}) },
        streamSyncOrchestrator: { getRuntimeState: () => ({}) },
        streamWebSocketGatewayEnabled: true,
        streamWebRtcEnabled: true,
        streamWebRtcRequireHttps: true
    });

    const caps = service.getCapabilities({
        requestHeaders: {}
    });
    assert.equal(caps.defaultTransport, 'jsmpeg');
    assert.equal(caps.transports.webrtc.enabled, false);
    assert.equal(caps.transports.webrtc.reason, 'webrtc-requires-https');
});

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
        streamWebRtcRequireHttps: true,
        streamWebRtcSignalingUrl: 'http://127.0.0.1:5005/webrtc/sessions'
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
        streamWebRtcRequireHttps: true,
        streamWebRtcSignalingUrl: 'http://127.0.0.1:5005/webrtc/sessions'
    });

    const caps = service.getCapabilities({
        requestHeaders: {}
    });
    assert.equal(caps.defaultTransport, 'jsmpeg');
    assert.equal(caps.transports.webrtc.enabled, false);
    assert.equal(caps.transports.webrtc.reason, 'webrtc-requires-https');
});

test('getCapabilities disables WebRTC when signaling endpoint is missing', () => {
    const service = new StreamControlService({
        streamManager: { getStatsSnapshot: () => ({}) },
        streamSyncOrchestrator: { getRuntimeState: () => ({}) },
        streamWebSocketGatewayEnabled: true,
        streamWebRtcEnabled: true,
        streamWebRtcRequireHttps: false,
        streamWebRtcSignalingUrl: ''
    });

    const caps = service.getCapabilities({ requestHeaders: { 'x-forwarded-proto': 'https' } });
    assert.equal(caps.defaultTransport, 'jsmpeg');
    assert.equal(caps.transports.webrtc.enabled, false);
    assert.equal(caps.transports.webrtc.reason, 'webrtc-signaling-missing');
});

test('getSessionDescriptor returns transport descriptors and preserves preferred transport', () => {
    const service = new StreamControlService({
        cameraInventoryService: {
            findCamera: () => ({ id: 'cam-123', name: 'Patio' })
        },
        streamManager: { getStatsSnapshot: () => ({}) },
        streamSyncOrchestrator: { getRuntimeState: () => ({}) },
        streamWebSocketGatewayEnabled: true,
        streamWebRtcEnabled: true,
        streamWebRtcRequireHttps: true,
        streamWebRtcSignalingUrl: 'http://127.0.0.1:5005/webrtc/sessions',
        streamPublicBaseUrl: 'https://streams.example.com'
    });

    const session = service.getSessionDescriptor({
        cameraId: 'cam-123',
        requestHeaders: {
            'x-forwarded-proto': 'https'
        }
    });

    assert.equal(session.cameraId, 'cam-123');
    assert.equal(session.selectedTransport, 'webrtc');
    assert.equal(session.preferredTransport, 'webrtc');
    assert.equal(session.transports.jsmpeg.enabled, true);
    assert.equal(session.transports.jsmpeg.path, '/stream/cam-123');
    assert.equal(session.transports.jsmpeg.url, 'wss://streams.example.com/stream/cam-123');
    assert.equal(session.transports.webrtc.enabled, true);
    assert.equal(session.transports.webrtc.signalingPath, '/api/streams/webrtc/sessions');
});

test('getSessionDescriptor throws when camera does not exist', () => {
    const service = new StreamControlService({
        cameraInventoryService: {
            findCamera: () => null
        },
        streamManager: { getStatsSnapshot: () => ({}) },
        streamSyncOrchestrator: { getRuntimeState: () => ({}) }
    });

    assert.throws(
        () => service.getSessionDescriptor({ cameraId: 'missing' }),
        (error) => Number(error?.status) === 404 && error.code === 'STREAM_CAMERA_NOT_FOUND'
    );
});

test('createWebRtcSession exchanges offer/answer with signaling endpoint', async () => {
    const service = new StreamControlService({
        cameraInventoryService: { findCamera: () => ({ id: 'cam-9' }) },
        streamManager: { getStatsSnapshot: () => ({}) },
        streamSyncOrchestrator: { getRuntimeState: () => ({}) },
        streamWebSocketGatewayEnabled: true,
        streamWebRtcEnabled: true,
        streamWebRtcRequireHttps: false,
        streamWebRtcSignalingUrl: 'http://signaling.internal/webrtc/sessions',
        streamWebRtcIceServersJson: '[{"urls":"stun:stun.example.com:3478"}]',
        fetchImpl: async (url, init = {}) => {
            assert.equal(url, 'http://signaling.internal/webrtc/sessions');
            const parsedBody = JSON.parse(init.body);
            assert.equal(parsedBody.cameraId, 'cam-9');
            assert.equal(parsedBody.offer.type, 'offer');
            assert.equal(typeof parsedBody.offer.sdp, 'string');
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    sessionId: 'sess-1',
                    answer: {
                        type: 'answer',
                        sdp: 'v=0\\no=- 0 0 IN IP4 127.0.0.1'
                    },
                    iceServers: []
                })
            };
        }
    });

    const session = await service.createWebRtcSession({
        cameraId: 'cam-9',
        offerSdp: 'v=0\\no=- 0 0 IN IP4 127.0.0.1',
        offerType: 'offer',
        requestHeaders: {}
    });
    assert.equal(session.cameraId, 'cam-9');
    assert.equal(session.sessionId, 'sess-1');
    assert.equal(session.answer.type, 'answer');
    assert.equal(Array.isArray(session.iceServers), true);
});

test('createWebRtcSession retries signaling on transient failure', async () => {
    let calls = 0;
    const service = new StreamControlService({
        cameraInventoryService: { findCamera: () => ({ id: 'cam-2' }) },
        streamManager: { getStatsSnapshot: () => ({}) },
        streamSyncOrchestrator: { getRuntimeState: () => ({}) },
        streamWebSocketGatewayEnabled: true,
        streamWebRtcEnabled: true,
        streamWebRtcRequireHttps: false,
        streamWebRtcSignalingUrl: 'http://signaling.internal/webrtc/sessions',
        streamWebRtcSignalingRetries: 2,
        fetchImpl: async () => {
            calls += 1;
            if (calls === 1) {
                return {
                    ok: false,
                    status: 502,
                    json: async () => ({ error: 'upstream unavailable' })
                };
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    sessionId: 'sess-2',
                    answer: { type: 'answer', sdp: 'v=0\\n...' }
                })
            };
        }
    });

    const session = await service.createWebRtcSession({
        cameraId: 'cam-2',
        offerSdp: 'v=0\\n...',
        offerType: 'offer',
        requestHeaders: {}
    });
    assert.equal(session.sessionId, 'sess-2');
    assert.equal(calls, 2);
});

test('submitWebRtcCandidate forwards candidate to signaling endpoint', async () => {
    const service = new StreamControlService({
        cameraInventoryService: { findCamera: () => ({ id: 'cam-3' }) },
        streamManager: { getStatsSnapshot: () => ({}) },
        streamSyncOrchestrator: { getRuntimeState: () => ({}) },
        streamWebSocketGatewayEnabled: true,
        streamWebRtcEnabled: true,
        streamWebRtcRequireHttps: false,
        streamWebRtcSignalingUrl: 'http://signaling.internal/webrtc/sessions',
        fetchImpl: async (url) => {
            assert.equal(url, 'http://signaling.internal/webrtc/sessions/sess-3/candidates');
            return {
                ok: true,
                status: 200,
                json: async () => ({ accepted: true })
            };
        }
    });

    const result = await service.submitWebRtcCandidate({
        sessionId: 'sess-3',
        cameraId: 'cam-3',
        candidate: 'candidate:1 1 UDP 2122252543 192.168.1.2 54400 typ host'
    });
    assert.equal(result.sessionId, 'sess-3');
    assert.equal(result.accepted, true);
});

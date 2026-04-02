const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { createStreamsRouter } = require('../routes/streams');

async function startAppWithRouter(router) {
    const app = express();
    app.use(express.json());
    app.use('/api/streams', router);

    const server = await new Promise((resolve, reject) => {
        const instance = app.listen(0, '127.0.0.1');
        instance.once('listening', () => resolve(instance));
        instance.once('error', reject);
    });
    const address = server.address();
    return {
        server,
        baseUrl: `http://127.0.0.1:${address.port}`
    };
}

test('streams router returns local runtime snapshot when proxy is not configured', async () => {
    const router = createStreamsRouter({
        streamControlService: {
            getCapabilities: () => ({
                defaultTransport: 'jsmpeg',
                transports: { webrtc: { enabled: false }, jsmpeg: { enabled: true } }
            }),
            getSessionDescriptor: () => ({
                cameraId: 'cam-1',
                selectedTransport: 'jsmpeg',
                transports: {
                    jsmpeg: { enabled: true, path: '/stream/cam-1', url: null },
                    webrtc: { enabled: false, reason: 'webrtc-disabled' }
                }
            }),
            getRuntimeSnapshot: () => ({
                summary: { streams: 1 },
                streamStats: {},
                syncRuntime: null,
                lastManualSync: null
            }),
            createWebRtcSession: async () => ({
                cameraId: 'cam-1',
                answer: {
                    type: 'answer',
                    sdp: 'v=0\\n...'
                }
            }),
            submitWebRtcCandidate: async () => ({
                sessionId: 'sess-local',
                accepted: true
            }),
            triggerManualSync: async () => ({ result: { success: true } })
        }
    });

    const { server, baseUrl } = await startAppWithRouter(router);
    try {
        const capabilitiesRes = await fetch(`${baseUrl}/api/streams/capabilities`);
        const capabilitiesPayload = await capabilitiesRes.json();
        assert.equal(capabilitiesRes.status, 200);
        assert.equal(capabilitiesPayload.success, true);
        assert.equal(capabilitiesPayload.capabilities.defaultTransport, 'jsmpeg');

        const sessionRes = await fetch(`${baseUrl}/api/streams/sessions/cam-1`);
        const sessionPayload = await sessionRes.json();
        assert.equal(sessionRes.status, 200);
        assert.equal(sessionPayload.success, true);
        assert.equal(sessionPayload.session.cameraId, 'cam-1');
        assert.equal(sessionPayload.session.selectedTransport, 'jsmpeg');

        const webrtcRes = await fetch(`${baseUrl}/api/streams/webrtc/sessions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                cameraId: 'cam-1',
                offerSdp: 'v=0\\n...'
            })
        });
        const webrtcPayload = await webrtcRes.json();
        assert.equal(webrtcRes.status, 200);
        assert.equal(webrtcPayload.success, true);
        assert.equal(webrtcPayload.session.cameraId, 'cam-1');

        const candidateRes = await fetch(`${baseUrl}/api/streams/webrtc/sessions/sess-local/candidates`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                cameraId: 'cam-1',
                candidate: {
                    candidate: 'candidate:1 1 UDP 2122252543 192.168.1.2 54400 typ host'
                }
            })
        });
        const candidatePayload = await candidateRes.json();
        assert.equal(candidateRes.status, 200);
        assert.equal(candidatePayload.success, true);
        assert.equal(candidatePayload.result.sessionId, 'sess-local');

        const response = await fetch(`${baseUrl}/api/streams/runtime`);
        const payload = await response.json();
        assert.equal(response.status, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.summary.streams, 1);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('streams router prefers proxy service when configured', async () => {
    let localCalled = false;
    let proxyCalled = false;

    const router = createStreamsRouter({
        streamControlService: {
            getCapabilities: () => {
                localCalled = true;
                return { defaultTransport: 'jsmpeg' };
            },
            getSessionDescriptor: () => {
                localCalled = true;
                return { cameraId: 'cam-local', selectedTransport: 'jsmpeg' };
            },
            getRuntimeSnapshot: () => {
                localCalled = true;
                return { summary: { streams: 99 } };
            },
            createWebRtcSession: async () => {
                localCalled = true;
                return { cameraId: 'cam-local' };
            },
            submitWebRtcCandidate: async () => {
                localCalled = true;
                return { sessionId: 'sess-local', accepted: true };
            },
            triggerManualSync: async () => ({ result: { success: true } })
        },
        streamControlProxyService: {
            getCapabilities: async () => ({
                defaultTransport: 'webrtc',
                transports: {
                    webrtc: { enabled: true },
                    jsmpeg: { enabled: true }
                }
            }),
            getSessionDescriptor: async () => ({
                cameraId: 'cam-proxy',
                selectedTransport: 'jsmpeg',
                preferredTransport: 'webrtc',
                transports: {
                    jsmpeg: { enabled: true, path: '/stream/cam-proxy', url: null },
                    webrtc: { enabled: true, reason: null }
                }
            }),
            getRuntimeSnapshot: async () => {
                proxyCalled = true;
                return {
                    summary: { streams: 2 },
                    streamStats: { cam1: { active: true } },
                    syncRuntime: { hasPeriodicTimer: true },
                    lastManualSync: null
                };
            },
            createWebRtcSession: async () => ({
                cameraId: 'cam-proxy',
                answer: { type: 'answer', sdp: 'v=0\\n...' }
            }),
            submitWebRtcCandidate: async () => ({
                sessionId: 'sess-proxy',
                accepted: true
            }),
            triggerManualSync: async () => ({
                requestedBy: 'proxy',
                result: { success: true }
            })
        }
    });

    const { server, baseUrl } = await startAppWithRouter(router);
    try {
        const capabilitiesRes = await fetch(`${baseUrl}/api/streams/capabilities`);
        const capabilitiesPayload = await capabilitiesRes.json();
        assert.equal(capabilitiesRes.status, 200);
        assert.equal(capabilitiesPayload.capabilities.defaultTransport, 'webrtc');

        const sessionRes = await fetch(`${baseUrl}/api/streams/sessions/cam-proxy`);
        const sessionPayload = await sessionRes.json();
        assert.equal(sessionRes.status, 200);
        assert.equal(sessionPayload.success, true);
        assert.equal(sessionPayload.session.cameraId, 'cam-proxy');
        assert.equal(sessionPayload.session.preferredTransport, 'webrtc');

        const webrtcRes = await fetch(`${baseUrl}/api/streams/webrtc/sessions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                cameraId: 'cam-proxy',
                offerSdp: 'v=0\\n...'
            })
        });
        const webrtcPayload = await webrtcRes.json();
        assert.equal(webrtcRes.status, 200);
        assert.equal(webrtcPayload.success, true);
        assert.equal(webrtcPayload.session.cameraId, 'cam-proxy');

        const candidateRes = await fetch(`${baseUrl}/api/streams/webrtc/sessions/sess-proxy/candidates`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                cameraId: 'cam-proxy',
                candidate: {
                    candidate: 'candidate:1 1 UDP 2122252543 192.168.1.2 54400 typ host'
                }
            })
        });
        const candidatePayload = await candidateRes.json();
        assert.equal(candidateRes.status, 200);
        assert.equal(candidatePayload.success, true);
        assert.equal(candidatePayload.result.sessionId, 'sess-proxy');

        const runtimeRes = await fetch(`${baseUrl}/api/streams/runtime`);
        const runtimePayload = await runtimeRes.json();
        assert.equal(runtimeRes.status, 200);
        assert.equal(runtimePayload.summary.streams, 2);

        const syncRes = await fetch(`${baseUrl}/api/streams/sync`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        });
        const syncPayload = await syncRes.json();
        assert.equal(syncRes.status, 200);
        assert.equal(syncPayload.success, true);
        assert.equal(syncPayload.sync.requestedBy, 'proxy');

        assert.equal(proxyCalled, true);
        assert.equal(localCalled, false);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

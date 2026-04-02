const test = require('node:test');
const assert = require('node:assert/strict');

const { createStreamGatewayApp } = require('../src/app/create-stream-gateway-app');

test('createStreamGatewayApp exposes internal health and runtime endpoints', async () => {
    const built = createStreamGatewayApp({
        cameraFile: '/tmp/non-existent-cameras-for-gateway.json'
    });

    const server = await new Promise((resolve, reject) => {
        const instance = built.app.listen(0, '127.0.0.1');
        instance.once('listening', () => resolve(instance));
        instance.once('error', reject);
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
        const healthRes = await fetch(`${baseUrl}/api/internal/streams/health`);
        const healthPayload = await healthRes.json();
        assert.equal(healthRes.status, 200);
        assert.equal(healthPayload.success, true);

        const runtimeRes = await fetch(`${baseUrl}/api/internal/streams/runtime`);
        const runtimePayload = await runtimeRes.json();
        assert.equal(runtimeRes.status, 200);
        assert.equal(runtimePayload.success, true);
        assert.ok(runtimePayload.summary);

        const metricsRes = await fetch(`${baseUrl}/api/internal/streams/metrics`);
        const metricsText = await metricsRes.text();
        assert.equal(metricsRes.status, 200);
        assert.equal(String(metricsRes.headers.get('content-type') || '').includes('text/plain'), true);
        assert.equal(metricsText.includes('ipcam_stream_runtime_streams_total'), true);

        const capabilitiesRes = await fetch(`${baseUrl}/api/internal/streams/capabilities`);
        const capabilitiesPayload = await capabilitiesRes.json();
        assert.equal(capabilitiesRes.status, 200);
        assert.equal(capabilitiesPayload.success, true);
        assert.ok(capabilitiesPayload.capabilities);

        const sessionRes = await fetch(`${baseUrl}/api/internal/streams/sessions/missing-camera`);
        const sessionPayload = await sessionRes.json();
        assert.equal(sessionRes.status, 404);
        assert.equal(sessionPayload.success, false);

        const webrtcRes = await fetch(`${baseUrl}/api/internal/streams/webrtc/sessions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        });
        const webrtcPayload = await webrtcRes.json();
        assert.equal(webrtcRes.status, 400);
        assert.equal(webrtcPayload.success, false);

        const candidateRes = await fetch(`${baseUrl}/api/internal/streams/webrtc/sessions/sess-missing/candidates`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        });
        const candidatePayload = await candidateRes.json();
        assert.equal(candidateRes.status, 400);
        assert.equal(candidatePayload.success, false);

        const closeRes = await fetch(`${baseUrl}/api/internal/streams/webrtc/sessions/sess-missing`, {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ cameraId: 'cam-1' })
        });
        const closePayload = await closeRes.json();
        assert.equal(closeRes.status, 503);
        assert.equal(closePayload.success, false);

        const invalidCloseRes = await fetch(`${baseUrl}/api/internal/streams/webrtc/sessions/sess-missing`, {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        });
        const invalidClosePayload = await invalidCloseRes.json();
        assert.equal(invalidCloseRes.status, 400);
        assert.equal(invalidClosePayload.success, false);
        assert.equal(invalidClosePayload.code, 'INVALID_REQUEST_BODY');

        const livezRes = await fetch(`${baseUrl}/livez`);
        const livezPayload = await livezRes.json();
        assert.equal(livezRes.status, 200);
        assert.equal(livezPayload.success, true);

        const readyzRes = await fetch(`${baseUrl}/readyz`);
        const readyzPayload = await readyzRes.json();
        assert.equal(readyzRes.status, 200);
        assert.equal(readyzPayload.success, true);
        assert.equal(readyzPayload.status, 'ready');
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

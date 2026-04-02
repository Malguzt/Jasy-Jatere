const test = require('node:test');
const assert = require('node:assert/strict');

const { createBackendApp } = require('../src/app/create-backend-app');

test('createBackendApp returns express app and runtime coordinator', () => {
    const built = createBackendApp({
        cameraFile: '/tmp/non-existent-cameras.json'
    });

    assert.equal(typeof built, 'object');
    assert.equal(typeof built.app, 'function');
    assert.equal(typeof built.platformRuntimeCoordinator, 'object');
    assert.equal(typeof built.platformRuntimeCoordinator.start, 'function');
});

test('createBackendApp serves canonical and legacy camera API namespaces', async () => {
    const built = createBackendApp({
        cameraFile: '/tmp/non-existent-cameras.json'
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
        const canonical = await fetch(`${baseUrl}/api/cameras/ptz/stop`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        });
        const legacy = await fetch(`${baseUrl}/api/ptz/stop`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        });

        assert.equal(canonical.status, 400);
        assert.equal(legacy.status, 400);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('createBackendApp exposes internal worker config and perception ingest APIs', async () => {
    const built = createBackendApp({
        cameraFile: '/tmp/non-existent-cameras.json'
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
        const camerasCfg = await fetch(`${baseUrl}/api/internal/config/cameras`);
        const camerasPayload = await camerasCfg.json();
        assert.equal(camerasCfg.status, 200);
        assert.equal(camerasPayload.success, true);
        assert.ok(Array.isArray(camerasPayload.cameras));

        const invalidObservation = await fetch(`${baseUrl}/api/perception/observations`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ camera_id: 'cam-1' })
        });
        assert.equal(invalidObservation.status, 400);

        const capabilitiesRes = await fetch(`${baseUrl}/api/streams/capabilities`);
        const capabilitiesPayload = await capabilitiesRes.json();
        assert.equal(capabilitiesRes.status, 200);
        assert.equal(capabilitiesPayload.success, true);
        assert.ok(capabilitiesPayload.capabilities);

        const liveRes = await fetch(`${baseUrl}/api/health/live`);
        const livePayload = await liveRes.json();
        assert.equal(liveRes.status, 200);
        assert.equal(livePayload.success, true);
        assert.equal(livePayload.liveness.alive, true);

        const readyRes = await fetch(`${baseUrl}/api/health/ready`);
        const readyPayload = await readyRes.json();
        assert.equal(readyRes.status, 200);
        assert.equal(readyPayload.success, true);
        assert.equal(readyPayload.readiness.ready, true);

        const livezRes = await fetch(`${baseUrl}/livez`);
        assert.equal(livezRes.status, 200);

        const readyzRes = await fetch(`${baseUrl}/readyz`);
        assert.equal(readyzRes.status, 200);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

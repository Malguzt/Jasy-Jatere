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
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

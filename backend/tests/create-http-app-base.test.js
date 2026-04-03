const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { createHttpAppBase } = require('../src/app/create-http-app-base');

function startServer(app) {
    return new Promise((resolve, reject) => {
        const server = http.createServer(app);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address !== 'object') {
                reject(new Error('Failed to resolve test server address'));
                return;
            }
            resolve({
                server,
                baseUrl: `http://127.0.0.1:${address.port}`
            });
        });
    });
}

test('createHttpAppBase applies correlation-id middleware to JSON responses', async () => {
    const app = createHttpAppBase();
    app.get('/healthz', (_req, res) => {
        res.json({ ok: true });
    });

    const { server, baseUrl } = await startServer(app);
    try {
        const response = await fetch(`${baseUrl}/healthz`);
        const payload = await response.json();
        const correlationId = response.headers.get('x-correlation-id');

        assert.equal(response.status, 200);
        assert.equal(payload.ok, true);
        assert.equal(typeof payload.correlationId, 'string');
        assert.equal(payload.correlationId.length > 0, true);
        assert.equal(correlationId, payload.correlationId);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

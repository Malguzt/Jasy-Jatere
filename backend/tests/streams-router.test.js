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
            getRuntimeSnapshot: () => ({
                summary: { streams: 1 },
                streamStats: {},
                syncRuntime: null,
                lastManualSync: null
            }),
            triggerManualSync: async () => ({ result: { success: true } })
        }
    });

    const { server, baseUrl } = await startAppWithRouter(router);
    try {
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
            getRuntimeSnapshot: () => {
                localCalled = true;
                return { summary: { streams: 99 } };
            },
            triggerManualSync: async () => ({ result: { success: true } })
        },
        streamControlProxyService: {
            getRuntimeSnapshot: async () => {
                proxyCalled = true;
                return {
                    summary: { streams: 2 },
                    streamStats: { cam1: { active: true } },
                    syncRuntime: { hasPeriodicTimer: true },
                    lastManualSync: null
                };
            },
            triggerManualSync: async () => ({
                requestedBy: 'proxy',
                result: { success: true }
            })
        }
    });

    const { server, baseUrl } = await startAppWithRouter(router);
    try {
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

const test = require('node:test');
const assert = require('node:assert/strict');

const { StreamGatewayProxyService } = require('../src/domains/streams/stream-gateway-proxy-service');

test('getRuntimeSnapshot proxies runtime payload from stream gateway API', async () => {
    const service = new StreamGatewayProxyService({
        gatewayApiBaseUrl: 'http://stream-gateway:4100/api/internal/streams',
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                success: true,
                summary: { streams: 2 },
                streamStats: { cam1: { active: true } },
                syncRuntime: { hasPeriodicTimer: true },
                lastManualSync: null
            })
        })
    });

    const runtime = await service.getRuntimeSnapshot();
    assert.equal(runtime.summary.streams, 2);
    assert.equal(runtime.streamStats.cam1.active, true);
    assert.equal(runtime.syncRuntime.hasPeriodicTimer, true);
});

test('triggerManualSync proxies sync payload from stream gateway API', async () => {
    const calls = [];
    const service = new StreamGatewayProxyService({
        gatewayApiBaseUrl: 'http://stream-gateway:4100/api/internal/streams',
        fetchImpl: async (url, init = {}) => {
            calls.push({ url, init });
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    success: true,
                    sync: {
                        requestedAt: 1700000000000,
                        reason: 'manual',
                        requestedBy: 'ops',
                        result: { success: true }
                    }
                })
            };
        }
    });

    const sync = await service.triggerManualSync({ reason: 'manual', requestedBy: 'ops' });
    assert.equal(sync.reason, 'manual');
    assert.equal(sync.requestedBy, 'ops');
    assert.equal(sync.result.success, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://stream-gateway:4100/api/internal/streams/sync');
});

test('getRuntimeSnapshot raises timeout error when gateway request aborts', async () => {
    const service = new StreamGatewayProxyService({
        gatewayApiBaseUrl: 'http://stream-gateway:4100/api/internal/streams',
        requestTimeoutMs: 50,
        fetchImpl: async (url, init = {}) => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            throw error;
        }
    });

    await assert.rejects(
        () => service.getRuntimeSnapshot(),
        (error) => Number(error?.status) === 504 && error.code === 'STREAM_GATEWAY_TIMEOUT'
    );
});

test('getCapabilities proxies capabilities payload from stream gateway API', async () => {
    const service = new StreamGatewayProxyService({
        gatewayApiBaseUrl: 'http://stream-gateway:4100/api/internal/streams',
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                success: true,
                capabilities: {
                    defaultTransport: 'jsmpeg',
                    preferredOrder: ['webrtc', 'jsmpeg'],
                    transports: {
                        webrtc: { enabled: false, reason: 'webrtc-disabled' },
                        jsmpeg: { enabled: true }
                    }
                }
            })
        })
    });

    const caps = await service.getCapabilities();
    assert.equal(caps.defaultTransport, 'jsmpeg');
    assert.equal(caps.transports.jsmpeg.enabled, true);
});

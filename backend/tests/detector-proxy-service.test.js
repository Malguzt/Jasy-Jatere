const test = require('node:test');
const assert = require('node:assert/strict');

const { DetectorProxyService } = require('../src/domains/perception/detector-proxy-service');

test('readStatus returns upstream payload when detector responds', async () => {
    const service = new DetectorProxyService({
        detectorUrl: 'http://detector.local:5000',
        fetchImpl: async () => ({
            json: async () => ({ success: true, cameras: { cam1: { online: true } } })
        })
    });

    const payload = await service.readStatus();
    assert.equal(payload.success, true);
    assert.equal(payload.cameras.cam1.online, true);
});

test('readEvents returns fallback payload when detector is unavailable', async () => {
    const service = new DetectorProxyService({
        detectorUrl: 'http://detector.local:5000',
        fetchImpl: async () => {
            throw new Error('network down');
        }
    });

    const payload = await service.readEvents();
    assert.deepEqual(payload, { success: false, events: [] });
});

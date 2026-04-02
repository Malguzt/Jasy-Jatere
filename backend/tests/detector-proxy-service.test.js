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

test('listRecordings appends query params to detector request', async () => {
    let calledUrl = null;
    const service = new DetectorProxyService({
        detectorUrl: 'http://detector.local:5000',
        fetchImpl: async (url) => {
            calledUrl = url;
            return { json: async () => ({ success: true, recordings: [] }) };
        }
    });

    await service.listRecordings({ cameraId: '101', limit: '20' });
    assert.equal(calledUrl, 'http://detector.local:5000/recordings?cameraId=101&limit=20');
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

test('deleteRecording encodes filename before forwarding delete request', async () => {
    let calledUrl = null;
    let calledMethod = null;
    const service = new DetectorProxyService({
        detectorUrl: 'http://detector.local:5000',
        fetchImpl: async (url, options = {}) => {
            calledUrl = url;
            calledMethod = options.method;
            return { json: async () => ({ success: true }) };
        }
    });

    await service.deleteRecording('cam 1 clip.mp4');
    assert.equal(calledMethod, 'DELETE');
    assert.equal(calledUrl, 'http://detector.local:5000/recordings/cam%201%20clip.mp4');
});

const test = require('node:test');
const assert = require('node:assert/strict');

const { WorkerConfigService } = require('../src/domains/platform/worker-config-service');

test('getCameraSnapshot returns current inventory with timestamp', () => {
    const service = new WorkerConfigService({
        cameraInventoryService: {
            listCameras() {
                return [{ id: 'cam-1' }, { id: 'cam-2' }];
            }
        },
        now: () => 1234
    });

    const snapshot = service.getCameraSnapshot();
    assert.equal(snapshot.snapshotAt, 1234);
    assert.equal(snapshot.cameraCount, 2);
});

test('getStreamSnapshot resolves reconstructor pair for combined camera sources', async () => {
    const service = new WorkerConfigService({
        cameraInventoryService: {
            listCameras() {
                return [{
                    id: 'cam-1',
                    type: 'combined',
                    rtspUrl: 'combined',
                    allRtspUrls: [
                        'rtsp://camera/onvif1',
                        'rtsp://camera/onvif2'
                    ],
                    sourceLabels: ['Main 1920x1080', 'Sub 640x360']
                }];
            }
        },
        streamSyncOrchestrator: {
            getRuntimeState() {
                return { ok: true };
            }
        },
        now: () => 5678
    });

    const snapshot = await service.getStreamSnapshot();
    assert.equal(snapshot.snapshotAt, 5678);
    assert.equal(snapshot.streamCount, 1);
    assert.ok(snapshot.streams[0].reconstructor.main.endsWith('/onvif1'));
    assert.ok(snapshot.streams[0].reconstructor.sub.endsWith('/onvif2'));
    assert.equal(snapshot.runtime.ok, true);
});

test('getStreamSnapshot keeps runtime as null when local stream orchestrator is not configured', async () => {
    const service = new WorkerConfigService({
        cameraInventoryService: {
            listCameras() {
                return [{ id: 'cam-1', type: 'single', rtspUrl: 'rtsp://cam-1/main' }];
            }
        },
        streamSyncOrchestrator: null,
        now: () => 7777
    });

    const snapshot = await service.getStreamSnapshot();
    assert.equal(snapshot.snapshotAt, 7777);
    assert.equal(snapshot.streamCount, 1);
    assert.equal(snapshot.runtime, null);
});

test('getStreamSnapshot can source runtime from proxy service when local orchestrator is unavailable', async () => {
    const service = new WorkerConfigService({
        cameraInventoryService: {
            listCameras() {
                return [{ id: 'cam-1', type: 'single', rtspUrl: 'rtsp://cam-1/main' }];
            }
        },
        streamSyncOrchestrator: null,
        streamControlProxyService: {
            async getRuntimeSnapshot() {
                return { summary: { cameraCount: 1, activeStreams: 0 } };
            }
        },
        now: () => 8888
    });

    const snapshot = await service.getStreamSnapshot();
    assert.equal(snapshot.snapshotAt, 8888);
    assert.equal(snapshot.streamCount, 1);
    assert.deepEqual(snapshot.runtime, { summary: { cameraCount: 1, activeStreams: 0 } });
});

test('getRetentionSnapshot returns control-plane and detector retention policies', () => {
    const service = new WorkerConfigService({
        runtimeFlags: {
            recordingRetentionEnabled: true,
            recordingRetentionIntervalMs: 120000,
            recordingRetentionMaxAgeDays: 21,
            recordingRetentionMaxEntries: 400,
            recordingsMaxSizeGb: 64.5,
            recordingsDeleteOldestBatch: 80,
            observationMaxEntries: 6000
        },
        now: () => 9001
    });

    const snapshot = service.getRetentionSnapshot();
    assert.equal(snapshot.snapshotAt, 9001);
    assert.deepEqual(snapshot.retention.recordingCatalog, {
        enabled: true,
        intervalMs: 120000,
        maxAgeDays: 21,
        maxEntries: 400
    });
    assert.deepEqual(snapshot.retention.detectorRecycle, {
        recordingsMaxSizeGb: 64.5,
        deleteOldestBatch: 80
    });
    assert.deepEqual(snapshot.retention.observation, {
        maxEntries: 6000
    });
    assert.equal(snapshot.retention.recordingsMaxSizeGb, 64.5);
    assert.equal(snapshot.retention.deleteOldestBatch, 80);
    assert.equal(snapshot.retention.observationMaxEntries, 6000);
});

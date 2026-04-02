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

test('getStreamSnapshot resolves reconstructor pair for combined camera sources', () => {
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

    const snapshot = service.getStreamSnapshot();
    assert.equal(snapshot.snapshotAt, 5678);
    assert.equal(snapshot.streamCount, 1);
    assert.ok(snapshot.streams[0].reconstructor.main.endsWith('/onvif1'));
    assert.ok(snapshot.streams[0].reconstructor.sub.endsWith('/onvif2'));
    assert.equal(snapshot.runtime.ok, true);
});

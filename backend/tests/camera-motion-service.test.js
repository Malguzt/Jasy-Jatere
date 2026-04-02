const test = require('node:test');
const assert = require('node:assert/strict');

const { CameraMotionService } = require('../src/domains/monitoring/camera-motion-service');

test('listMotionState returns monitor camera motion map', () => {
    const service = new CameraMotionService({
        cameraEventMonitor: {
            getAll: () => ({
                cam1: { motion: true },
                cam2: { motion: false }
            }),
            getMotion: () => ({})
        }
    });

    const all = service.listMotionState();
    assert.equal(all.cam1.motion, true);
    assert.equal(all.cam2.motion, false);
});

test('getMotionState proxies monitor value for a camera id', () => {
    const service = new CameraMotionService({
        cameraEventMonitor: {
            getAll: () => ({}),
            getMotion: (id) => ({ id, motion: id === 'cam1' })
        }
    });

    const motion = service.getMotionState('cam1');
    assert.equal(motion.motion, true);
});

test('service throws when monitor is missing', () => {
    const service = new CameraMotionService({});
    assert.throws(
        () => service.listMotionState(),
        (error) => Number(error?.status) === 500 && error.code === 'CAMERA_EVENT_MONITOR_NOT_CONFIGURED'
    );
});

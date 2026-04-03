const test = require('node:test');
const assert = require('node:assert/strict');

const { CameraInventoryService } = require('../src/domains/cameras/camera-inventory-service');

test('constructor requires repository injection', () => {
    assert.throws(
        () => new CameraInventoryService(),
        (error) =>
            Number(error?.status) === 500 &&
            error?.code === 'CAMERA_INVENTORY_REPOSITORY_REQUIRED' &&
            error?.message === 'Camera inventory repository is required'
    );
});

test('listCameras and findCamera proxy repository methods', () => {
    const repo = {
        list() {
            return [{ id: 'cam-1' }];
        },
        findById(id) {
            return id === 'cam-1' ? { id } : null;
        }
    };

    const service = new CameraInventoryService({ repository: repo });
    const listed = service.listCameras();
    const found = service.findCamera('cam-1');
    const missing = service.findCamera('cam-2');

    assert.deepEqual(listed, [{ id: 'cam-1' }]);
    assert.deepEqual(found, { id: 'cam-1' });
    assert.equal(missing, null);
});

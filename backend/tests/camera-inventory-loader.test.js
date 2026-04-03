const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadCameraInventory, loadCameraById } = require('../src/domains/cameras/camera-inventory-loader');

test('loadCameraInventory returns cameras from inventory service when available', () => {
    const cameras = loadCameraInventory({
        cameraInventoryService: {
            listCameras() {
                return [{ id: 'cam-1' }];
            }
        },
        legacyFilePath: '/tmp/non-existent-cameras.json',
        legacyFileFallbackEnabled: true
    });

    assert.deepEqual(cameras, [{ id: 'cam-1' }]);
});

test('loadCameraInventory uses legacy file fallback when service payload is invalid and fallback is enabled', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'camera-loader-'));
    const legacyFilePath = path.join(tmpDir, 'cameras.json');
    fs.writeFileSync(legacyFilePath, JSON.stringify([{ id: 'cam-2' }], null, 2));

    const cameras = loadCameraInventory({
        cameraInventoryService: {
            listCameras() {
                return { not: 'an-array' };
            }
        },
        legacyFilePath,
        legacyFileFallbackEnabled: true
    });

    assert.deepEqual(cameras, [{ id: 'cam-2' }]);
});

test('loadCameraInventory returns empty list when service fails and fallback is disabled', () => {
    const errors = [];
    const cameras = loadCameraInventory({
        cameraInventoryService: {
            listCameras() {
                throw new Error('inventory down');
            }
        },
        legacyFilePath: '/tmp/non-existent-cameras.json',
        legacyFileFallbackEnabled: false,
        logger: {
            error(...args) {
                errors.push(args.join(' '));
            }
        }
    });

    assert.deepEqual(cameras, []);
    assert.equal(errors.length > 0, true);
});

test('loadCameraInventory returns empty list on malformed legacy file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'camera-loader-malformed-'));
    const legacyFilePath = path.join(tmpDir, 'cameras.json');
    fs.writeFileSync(legacyFilePath, '{invalid-json}');

    const cameras = loadCameraInventory({
        legacyFilePath,
        legacyFileFallbackEnabled: true,
        logger: { error() {} }
    });

    assert.deepEqual(cameras, []);
});

test('loadCameraById prefers inventory service findCamera when available', () => {
    const loaded = loadCameraById({
        cameraId: 'cam-1',
        cameraInventoryService: {
            findCamera(id) {
                return { id, name: 'Cam 1' };
            }
        },
        legacyFilePath: '/tmp/non-existent-cameras.json',
        legacyFileFallbackEnabled: true
    });
    assert.equal(loaded.reason, null);
    assert.equal(loaded.camera?.id, 'cam-1');
});

test('loadCameraById returns inventory-unavailable when service fails and fallback is disabled', () => {
    const loaded = loadCameraById({
        cameraId: 'cam-1',
        cameraInventoryService: {
            findCamera() {
                throw new Error('inventory down');
            }
        },
        legacyFileFallbackEnabled: false,
        logger: { error() {} }
    });
    assert.equal(loaded.camera, null);
    assert.equal(loaded.reason, 'inventory-unavailable');
});

test('loadCameraById returns missing-camera-file when fallback file does not exist', () => {
    const loaded = loadCameraById({
        cameraId: 'cam-1',
        legacyFilePath: '/tmp/missing-cameras-file.json',
        legacyFileFallbackEnabled: true
    });
    assert.equal(loaded.camera, null);
    assert.equal(loaded.reason, 'missing-camera-file');
});

test('loadCameraById returns camera-file-read-error when fallback file is malformed', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'camera-loader-by-id-malformed-'));
    const legacyFilePath = path.join(tmpDir, 'cameras.json');
    fs.writeFileSync(legacyFilePath, '{invalid-json}');

    const loaded = loadCameraById({
        cameraId: 'cam-1',
        legacyFilePath,
        legacyFileFallbackEnabled: true,
        logger: { error() {} }
    });
    assert.equal(loaded.camera, null);
    assert.equal(loaded.reason, 'camera-file-read-error');
});

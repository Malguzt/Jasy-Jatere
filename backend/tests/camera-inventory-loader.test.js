const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadCameraInventory } = require('../src/domains/cameras/camera-inventory-loader');

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

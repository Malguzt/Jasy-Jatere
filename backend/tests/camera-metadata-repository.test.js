const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { CameraMetadataRepository } = require('../src/infrastructure/repositories/camera-metadata-repository');

test('CameraMetadataRepository falls back to legacy export when primary metadata is missing', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cam-repo-'));
    const primary = path.join(tmpDir, 'metadata', 'cameras.json');
    const legacy = path.join(tmpDir, 'cameras.json');
    fs.writeFileSync(legacy, JSON.stringify([{ id: 'cam-1', name: 'Legacy Cam' }], null, 2));

    const repository = new CameraMetadataRepository({
        primaryFile: primary,
        legacyFile: legacy
    });

    const listed = repository.list();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, 'cam-1');
});

test('CameraMetadataRepository replace writes both primary and legacy stores', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cam-repo-write-'));
    const primary = path.join(tmpDir, 'metadata', 'cameras.json');
    const legacy = path.join(tmpDir, 'cameras.json');
    const repository = new CameraMetadataRepository({
        primaryFile: primary,
        legacyFile: legacy
    });

    repository.replace([{ id: 'cam-2', name: 'Primary Cam' }]);

    const primaryRaw = JSON.parse(fs.readFileSync(primary, 'utf8'));
    const legacyRaw = JSON.parse(fs.readFileSync(legacy, 'utf8'));
    assert.equal(primaryRaw[0].id, 'cam-2');
    assert.equal(legacyRaw[0].id, 'cam-2');
    assert.equal(repository.findById('cam-2')?.name, 'Primary Cam');
});

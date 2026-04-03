const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { CameraMetadataRepository } = require('../src/infrastructure/repositories/camera-metadata-repository');
const { createCameraCredentialCipher } = require('../src/security/camera-credential-cipher');

test('CameraMetadataRepository falls back to legacy export when primary metadata is missing', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cam-repo-'));
    const primary = path.join(tmpDir, 'metadata', 'cameras.json');
    const legacy = path.join(tmpDir, 'cameras.json');
    fs.writeFileSync(legacy, JSON.stringify([{ id: 'cam-1', name: 'Legacy Cam' }], null, 2));

    const repository = new CameraMetadataRepository({
        primaryFile: primary,
        legacyFile: legacy,
        driver: 'json'
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
        legacyFile: legacy,
        driver: 'json'
    });

    repository.replace([{ id: 'cam-2', name: 'Primary Cam' }]);

    const primaryRaw = JSON.parse(fs.readFileSync(primary, 'utf8'));
    const legacyRaw = JSON.parse(fs.readFileSync(legacy, 'utf8'));
    assert.equal(primaryRaw[0].id, 'cam-2');
    assert.equal(legacyRaw[0].id, 'cam-2');
    assert.equal(repository.findById('cam-2')?.name, 'Primary Cam');
});

test('CameraMetadataRepository encrypts credentials at rest when cipher is enabled', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cam-repo-enc-'));
    const primary = path.join(tmpDir, 'metadata', 'cameras.json');
    const legacy = path.join(tmpDir, 'cameras.json');
    const repository = new CameraMetadataRepository({
        primaryFile: primary,
        legacyFile: legacy,
        driver: 'json',
        credentialCipher: createCameraCredentialCipher({
            masterKey: 'unit-test-master-key'
        })
    });

    repository.replace([{
        id: 'cam-secure-1',
        name: 'Secure Cam',
        user: 'admin',
        pass: 'super-secret'
    }]);

    const persisted = JSON.parse(fs.readFileSync(primary, 'utf8'));
    assert.equal(typeof persisted[0].passEnc, 'string');
    assert.equal(persisted[0].pass, undefined);

    const listed = repository.list();
    assert.equal(listed[0].id, 'cam-secure-1');
    assert.equal(listed[0].pass, 'super-secret');
});

test('CameraMetadataRepository can disable legacy compatibility export writes', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cam-repo-no-legacy-'));
    const primary = path.join(tmpDir, 'metadata', 'cameras.json');
    const legacy = path.join(tmpDir, 'cameras.json');
    const repository = new CameraMetadataRepository({
        primaryFile: primary,
        legacyFile: legacy,
        driver: 'json',
        dualWriteLegacy: false
    });

    repository.replace([{ id: 'cam-3', name: 'Primary Only' }]);

    assert.equal(fs.existsSync(primary), true);
    assert.equal(fs.existsSync(legacy), false);
    assert.equal(repository.findById('cam-3')?.name, 'Primary Only');
});

test('CameraMetadataRepository can disable all JSON compatibility writes in sqlite mode', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cam-repo-sqlite-only-'));
    const primary = path.join(tmpDir, 'metadata', 'cameras.json');
    const legacy = path.join(tmpDir, 'cameras.json');
    const repository = new CameraMetadataRepository({
        primaryFile: primary,
        legacyFile: legacy,
        driver: 'sqlite',
        dualWriteLegacy: false
    });

    repository.replace([{ id: 'cam-4', name: 'SQLite Only' }]);

    assert.equal(repository.findById('cam-4')?.name, 'SQLite Only');
    assert.equal(fs.existsSync(primary), false);
    assert.equal(fs.existsSync(legacy), false);
});

test('CameraMetadataRepository does not bootstrap from JSON files in sqlite mode', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cam-repo-sqlite-no-bootstrap-'));
    const primary = path.join(tmpDir, 'metadata', 'cameras.json');
    const legacy = path.join(tmpDir, 'cameras.json');
    fs.mkdirSync(path.dirname(primary), { recursive: true });
    fs.writeFileSync(primary, JSON.stringify([{ id: 'cam-primary-only', name: 'Primary Only' }], null, 2));
    fs.writeFileSync(legacy, JSON.stringify([{ id: 'cam-legacy-only', name: 'Legacy Only' }], null, 2));

    const repository = new CameraMetadataRepository({
        primaryFile: primary,
        legacyFile: legacy,
        driver: 'sqlite',
        dualWriteLegacy: false
    });

    assert.deepEqual(repository.list(), []);
    assert.equal(repository.findById('cam-primary-only'), null);
    assert.equal(repository.findById('cam-legacy-only'), null);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { SavedCamerasService } = require('../src/domains/cameras/saved-cameras-service');

function makeTmpDir(prefix = 'saved-cameras-test') {
    return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function makeService({ validator, now } = {}) {
    const tmpDir = makeTmpDir();
    const dataFile = path.join(tmpDir, 'cameras.json');
    const service = new SavedCamerasService({
        dataFile,
        validateRtsp: validator || (async () => ({ ok: true, errors: [], checks: [], warnings: [] })),
        now: now || (() => 1700000000000)
    });
    return { service, dataFile };
}

test('listCameras returns empty list when file does not exist', () => {
    const { service } = makeService();
    assert.deepEqual(service.listCameras(), []);
});

test('createCamera persists camera and keeps successful validation payload', async () => {
    const validation = { ok: true, errors: [], checks: [{ sourceIndex: 0, ok: true }], warnings: [] };
    const { service, dataFile } = makeService({
        validator: async () => validation,
        now: () => 1700000000100
    });

    const result = await service.createCamera({
        name: 'Cam 1',
        rtspUrl: 'rtsp://example.local/onvif1',
        user: 'admin',
        pass: 'secret'
    });

    assert.equal(result.acceptedWithIssues, false);
    assert.equal(result.camera.name, 'Cam 1');
    assert.equal(result.validation.ok, true);
    assert.ok(fs.existsSync(dataFile));

    const stored = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    assert.equal(stored.length, 1);
    assert.equal(stored[0].rtspUrl, 'rtsp://example.local/onvif1');
});

test('createCamera accepts camera with warning payload when validator throws', async () => {
    const { service } = makeService({
        validator: async () => {
            throw new Error('network failure');
        },
        now: () => 1700000000200
    });

    const result = await service.createCamera({
        rtspUrl: 'rtsp://example.local/onvif1',
        user: 'admin',
        pass: 'secret'
    });

    assert.equal(result.acceptedWithIssues, true);
    assert.equal(result.camera.validation.ok, false);
    assert.ok(result.camera.validation.errors[0].includes('No se pudo validar RTSP'));
});

test('updateCamera revalidates when RTSP shape changes', async () => {
    const validations = [
        { ok: true, errors: [], checks: [], warnings: [] },
        { ok: false, errors: ['Canal 1: timeout'], checks: [], warnings: [] }
    ];
    let calls = 0;
    const { service } = makeService({
        validator: async () => validations[calls++],
        now: () => 1700000000300
    });

    const created = await service.createCamera({
        rtspUrl: 'rtsp://example.local/onvif1'
    });

    const updated = await service.updateCamera(created.camera.id, {
        rtspUrl: 'rtsp://example.local/onvif2'
    });

    assert.equal(updated.acceptedWithIssues, true);
    assert.equal(updated.camera.validation.ok, false);
    assert.deepEqual(updated.camera.validation.errors, ['Canal 1: timeout']);
});

test('updateCamera returns 404 error for missing camera', async () => {
    const { service } = makeService();

    await assert.rejects(
        () => service.updateCamera('missing-id', { name: 'updated' }),
        (error) => Number(error?.status) === 404 && error.message === 'Database not found'
    );
});

test('deleteCamera removes the camera when it exists', async () => {
    const { service } = makeService({
        now: () => 1700000000400
    });

    const created = await service.createCamera({
        rtspUrl: 'rtsp://example.local/onvif1'
    });
    const deleted = service.deleteCamera(created.camera.id);
    const listed = service.listCameras();

    assert.equal(deleted.deleted, 1);
    assert.equal(listed.length, 0);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { RecordingCatalogRepository } = require('../src/infrastructure/repositories/recording-catalog-repository');

test('RecordingCatalogRepository can disable all JSON compatibility writes in sqlite mode', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recording-repo-sqlite-only-'));
    const primary = path.join(tmpDir, 'metadata', 'recordings-catalog.json');
    const legacy = path.join(tmpDir, 'recordings-index.json');
    const repository = new RecordingCatalogRepository({
        primaryFile: primary,
        legacyFile: legacy,
        driver: 'sqlite',
        dualWriteLegacy: false
    });

    const upserted = repository.upsert({
        filename: 'cam_1.mp4',
        event_time: '2026-04-02T10:00:00.000Z',
        camera_id: 'cam-1'
    });
    assert.equal(upserted.filename, 'cam_1.mp4');
    assert.equal(repository.list().length, 1);
    assert.equal(fs.existsSync(primary), false);
    assert.equal(fs.existsSync(legacy), false);
});

test('RecordingCatalogRepository does not read legacy file in sqlite mode', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recording-repo-no-fallback-'));
    const primary = path.join(tmpDir, 'metadata', 'recordings-catalog.json');
    const legacy = path.join(tmpDir, 'recordings-index.json');
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, JSON.stringify([{
        filename: 'legacy_only.mp4',
        event_time: '2026-04-02T09:00:00.000Z'
    }], null, 2));

    const repository = new RecordingCatalogRepository({
        primaryFile: primary,
        legacyFile: legacy,
        driver: 'sqlite',
        dualWriteLegacy: false
    });

    assert.equal(repository.list().length, 0);
});

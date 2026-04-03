const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ObservationEventRepository } = require('../src/infrastructure/repositories/observation-event-repository');
const { MetadataSqliteStore } = require('../src/infrastructure/sqlite/metadata-sqlite-store');

function createEvent(cameraId = 'cam-1', eventTs = '2026-04-02T10:00:00.000Z') {
    return {
        camera_id: cameraId,
        event_time: eventTs,
        category: 'motion',
        objects: ['person']
    };
}

test('ObservationEventRepository can disable legacy JSON dual-write while using sqlite', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-repo-sqlite-only-'));
    const legacyFile = path.join(tmpDir, 'observations.json');
    const sqliteStore = new MetadataSqliteStore({
        dbPath: path.join(tmpDir, 'metadata.db')
    });
    sqliteStore.migrate();

    const repository = new ObservationEventRepository({
        filePath: legacyFile,
        driver: 'sqlite',
        sqliteStore
    });

    repository.append(createEvent('cam-1'));
    repository.append(createEvent('cam-2', '2026-04-02T10:00:01.000Z'));

    const listed = repository.list();
    assert.equal(listed.length, 2);
    assert.equal(fs.existsSync(legacyFile), false);
});

test('ObservationEventRepository writes legacy JSON when running in json mode', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-repo-legacy-'));
    const legacyFile = path.join(tmpDir, 'observations.json');
    const sqliteStore = new MetadataSqliteStore({
        dbPath: path.join(tmpDir, 'metadata.db')
    });
    sqliteStore.migrate();

    const repository = new ObservationEventRepository({
        filePath: legacyFile,
        driver: 'json',
        sqliteStore
    });

    repository.append(createEvent('cam-3'));
    const persisted = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
    assert.equal(Array.isArray(persisted), true);
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].camera_id, 'cam-3');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { RecordingCatalogRepository } = require('../src/infrastructure/repositories/recording-catalog-repository');
const { RecordingCatalogService } = require('../src/domains/recordings/recording-catalog-service');

function makeFixture() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recording-catalog-'));
    const recordingsDir = path.join(tmpDir, 'recordings');
    fs.mkdirSync(recordingsDir, { recursive: true });
    const repository = new RecordingCatalogRepository({
        primaryFile: path.join(tmpDir, 'metadata', 'recordings-catalog.json'),
        legacyFile: path.join(tmpDir, 'recordings-index.json')
    });
    const service = new RecordingCatalogService({
        repository,
        recordingsDir
    });
    return { tmpDir, recordingsDir, service };
}

test('RecordingCatalogService upserts and filters recording metadata', () => {
    const { service } = makeFixture();
    service.upsertRecording({
        filename: 'cam_1.mp4',
        camera_id: 'cam-1',
        camera_name: 'Cam 1',
        event_type: 'motion',
        event_time: '2026-04-02T12:00:00.000Z',
        status: 'ready',
        categories: ['persona']
    });

    const all = service.listRecordings();
    assert.equal(all.length, 1);
    assert.equal(all[0].filename, 'cam_1.mp4');

    const filtered = service.listRecordings({ camera_id: 'cam-1', category: 'persona' });
    assert.equal(filtered.length, 1);
});

test('RecordingCatalogService removeRecording clears files and catalog entry', () => {
    const { recordingsDir, service } = makeFixture();
    const filename = 'cam_2.mp4';
    fs.writeFileSync(path.join(recordingsDir, filename), 'video');
    fs.writeFileSync(path.join(recordingsDir, 'cam_2.jpg'), 'thumb');

    service.upsertRecording({
        filename,
        camera_id: 'cam-2',
        event_time: '2026-04-02T12:01:00.000Z',
        status: 'ready'
    });

    const result = service.removeRecording(filename);
    assert.equal(result.filename, filename);
    assert.equal(result.removedFromCatalog, true);
    assert.equal(service.listRecordings().length, 0);
    assert.equal(fs.existsSync(path.join(recordingsDir, filename)), false);
});

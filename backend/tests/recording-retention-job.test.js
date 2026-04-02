const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { RecordingCatalogRepository } = require('../src/infrastructure/repositories/recording-catalog-repository');
const { RecordingCatalogService } = require('../src/domains/recordings/recording-catalog-service');
const { RecordingRetentionJob } = require('../src/domains/recordings/recording-retention-job');

function makeFixture() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recording-retention-'));
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

test('RecordingRetentionJob removes age-expired and overflow recordings', async () => {
    const now = Date.parse('2026-04-02T12:00:00.000Z');
    const { recordingsDir, service } = makeFixture();

    const entries = [
        { filename: 'cam_old.mp4', event_time: '2026-03-20T12:00:00.000Z' },
        { filename: 'cam_mid.mp4', event_time: '2026-04-01T12:00:00.000Z' },
        { filename: 'cam_new.mp4', event_time: '2026-04-02T11:00:00.000Z' }
    ];
    entries.forEach((entry) => {
        service.upsertRecording(entry);
        fs.writeFileSync(path.join(recordingsDir, entry.filename), 'video');
    });

    const job = new RecordingRetentionJob({
        recordingCatalogService: service,
        maxAgeDays: 7,
        maxEntries: 1,
        now: () => now
    });

    const summary = await job.runOnce({ reason: 'test' });
    assert.equal(summary.status, 'ok');
    assert.deepEqual(summary.ageExpired, ['cam_old.mp4']);
    assert.deepEqual(summary.countOverflow, ['cam_mid.mp4']);
    assert.deepEqual(summary.deleted, ['cam_old.mp4', 'cam_mid.mp4']);
    assert.equal(service.listRecordings().length, 1);
    assert.equal(service.listRecordings()[0].filename, 'cam_new.mp4');
});

test('RecordingRetentionJob dryRun reports candidates without deleting files', async () => {
    const now = Date.parse('2026-04-02T12:00:00.000Z');
    const { recordingsDir, service } = makeFixture();

    const entries = [
        { filename: 'cam_1.mp4', event_time: '2026-04-01T12:00:00.000Z' },
        { filename: 'cam_2.mp4', event_time: '2026-03-20T12:00:00.000Z' }
    ];
    entries.forEach((entry) => {
        service.upsertRecording(entry);
        fs.writeFileSync(path.join(recordingsDir, entry.filename), 'video');
    });

    const job = new RecordingRetentionJob({
        recordingCatalogService: service,
        maxAgeDays: 7,
        maxEntries: 1,
        now: () => now
    });

    const summary = await job.runOnce({ dryRun: true, reason: 'dry-run-test' });
    assert.equal(summary.dryRun, true);
    assert.deepEqual(summary.deleted, []);
    assert.equal(service.listRecordings().length, 2);
    assert.equal(fs.existsSync(path.join(recordingsDir, 'cam_1.mp4')), true);
    assert.equal(fs.existsSync(path.join(recordingsDir, 'cam_2.mp4')), true);
});


const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { run } = require('../scripts/import-legacy-to-sqlite');
const { CameraMetadataRepository } = require('../src/infrastructure/repositories/camera-metadata-repository');
const { RecordingCatalogRepository } = require('../src/infrastructure/repositories/recording-catalog-repository');
const { ObservationEventRepository } = require('../src/infrastructure/repositories/observation-event-repository');
const { HealthSnapshotRepository } = require('../src/infrastructure/repositories/health-snapshot-repository');
const { MetadataSqliteStore } = require('../src/infrastructure/sqlite/metadata-sqlite-store');

function makeRepositories(tmpDir) {
    const store = new MetadataSqliteStore({
        dbPath: path.join(tmpDir, 'metadata', 'metadata.db')
    });
    store.migrate();

    return {
        cameraRepo: new CameraMetadataRepository({
            primaryFile: path.join(tmpDir, 'metadata', 'cameras.json'),
            legacyFile: path.join(tmpDir, 'legacy', 'cameras.json'),
            driver: 'sqlite',
            sqliteStore: store
        }),
        recordingRepo: new RecordingCatalogRepository({
            primaryFile: path.join(tmpDir, 'metadata', 'recordings-catalog.json'),
            legacyFile: path.join(tmpDir, 'legacy', 'recordings-index.json'),
            driver: 'sqlite',
            sqliteStore: store
        }),
        observationRepo: new ObservationEventRepository({
            filePath: path.join(tmpDir, 'metadata', 'observations.json'),
            driver: 'sqlite',
            sqliteStore: store
        }),
        healthRepo: new HealthSnapshotRepository({
            filePath: path.join(tmpDir, 'metadata', 'health-snapshot.json'),
            driver: 'sqlite',
            sqliteStore: store
        })
    };
}

test('import-legacy-to-sqlite migrates legacy payloads into repository-backed sqlite state', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-import-'));
    const legacyDir = path.join(tmpDir, 'legacy');
    fs.mkdirSync(legacyDir, { recursive: true });

    const paths = {
        camerasPath: path.join(legacyDir, 'cameras.json'),
        recordingsPath: path.join(legacyDir, 'recordings-index.json'),
        observationsPath: path.join(legacyDir, 'observations.json'),
        healthSnapshotPath: path.join(legacyDir, 'health-snapshot.json')
    };

    fs.writeFileSync(paths.camerasPath, JSON.stringify([{ id: 'cam-1', name: 'Legacy Cam' }], null, 2));
    fs.writeFileSync(paths.recordingsPath, JSON.stringify([{ filename: 'cam_1.mp4', event_time: '2026-04-01T12:00:00.000Z' }], null, 2));
    fs.writeFileSync(paths.observationsPath, JSON.stringify([{ camera_id: 'cam-1', event_type: 'motion', timestamp: '2026-04-01T12:00:00.000Z' }], null, 2));
    fs.writeFileSync(paths.healthSnapshotPath, JSON.stringify({ camera_id: 'cam-1', status: 'online' }, null, 2));

    const repositories = makeRepositories(tmpDir);
    const logs = [];
    const summary = run({
        paths,
        repositories,
        mapAdapters: {
            mapStorage: {
                getIndex: () => ({ maps: [{ map_id: 'map-1' }] }),
                loadJobs: () => [{ job_id: 'job-1' }]
            },
            mapCorrections: {
                readCorrections: () => ({ history: [{ id: 'corr-1' }] })
            }
        },
        logger: {
            log: (line) => logs.push(line),
            error: () => {}
        }
    });

    assert.deepEqual(summary, {
        cameras: 1,
        recordings: 1,
        observations: 1,
        maps: 1,
        mapJobs: 1,
        correctionsHistory: 1,
        health: 1
    });
    assert.equal(repositories.cameraRepo.list().length, 1);
    assert.equal(repositories.recordingRepo.list().length, 1);
    assert.equal(repositories.observationRepo.list().length, 1);
    assert.ok(repositories.healthRepo.getLatest());
    assert.equal(logs.length, 1);
    assert.ok(String(logs[0]).includes('metadata-db import complete'));
});

test('import-legacy-to-sqlite keeps sqlite state empty when legacy files are absent', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-import-empty-'));
    const repositories = makeRepositories(tmpDir);
    const missingPaths = {
        camerasPath: path.join(tmpDir, 'legacy', 'missing-cameras.json'),
        recordingsPath: path.join(tmpDir, 'legacy', 'missing-recordings.json'),
        observationsPath: path.join(tmpDir, 'legacy', 'missing-observations.json'),
        healthSnapshotPath: path.join(tmpDir, 'legacy', 'missing-health.json')
    };

    const summary = run({
        paths: missingPaths,
        repositories,
        mapAdapters: {
            mapStorage: {
                getIndex: () => ({ maps: [] }),
                loadJobs: () => []
            },
            mapCorrections: {
                readCorrections: () => ({ history: [] })
            }
        },
        logger: {
            log: () => {},
            error: () => {}
        }
    });

    assert.deepEqual(summary, {
        cameras: 0,
        recordings: 0,
        observations: 0,
        maps: 0,
        mapJobs: 0,
        correctionsHistory: 0,
        health: 0
    });
    assert.equal(repositories.cameraRepo.list().length, 0);
    assert.equal(repositories.recordingRepo.list().length, 0);
    assert.equal(repositories.observationRepo.list().length, 0);
    assert.equal(repositories.healthRepo.getLatest(), null);
});

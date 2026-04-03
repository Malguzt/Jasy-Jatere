const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshRequire(modulePath) {
    const resolved = require.resolve(modulePath);
    delete require.cache[resolved];
    return require(modulePath);
}

function makeTmpDir(prefix = 'maps-test') {
    return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function withEnv(overrides, fn) {
    const previous = {};
    Object.keys(overrides || {}).forEach((key) => {
        previous[key] = Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined;
        const value = overrides[key];
        if (value === undefined || value === null) {
            delete process.env[key];
            return;
        }
        process.env[key] = String(value);
    });
    try {
        return fn();
    } finally {
        Object.keys(overrides || {}).forEach((key) => {
            if (previous[key] === undefined) {
                delete process.env[key];
                return;
            }
            process.env[key] = previous[key];
        });
    }
}

test('validate-map accepts valid document and rejects invalid document', () => {
    const { validateMapDocument } = freshRequire('../maps/validate-map');
    const good = {
        schemaVersion: '1.0',
        mapId: 'map_test_1',
        createdAt: Date.now(),
        quality: { mode: 'croquis', score: 0.7, planUsed: 'A' },
        cameras: [{ id: 'cam1', label: 'Cam 1', x: 1, y: 2, yawDeg: 90 }],
        objects: [{ id: 'obj1', label: 'auto', category: 'vehiculo', x: 3, y: 4, confidence: 0.8, sources: ['cam1'] }]
    };
    const valid = validateMapDocument(good);
    assert.equal(valid.ok, true);
    assert.deepEqual(valid.errors, []);

    const bad = {
        schemaVersion: '',
        mapId: '',
        createdAt: null,
        quality: {},
        cameras: [{}],
        objects: [{}]
    };
    const invalid = validateMapDocument(bad);
    assert.equal(invalid.ok, false);
    assert.ok(invalid.errors.length >= 5);
});

test('storage saves and retrieves maps in isolated directory', () => {
    const tempDir = makeTmpDir('maps-storage');
    withEnv({
        MAPS_DATA_DIR: tempDir,
        METADATA_DRIVER: 'sqlite',
        METADATA_SQLITE_PATH: path.join(tempDir, 'metadata.db')
    }, () => {
        const storage = freshRequire('../maps/storage');

        const doc = {
            schemaVersion: '1.0',
            mapId: 'map_storage_1',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            quality: { mode: 'croquis', score: 0.61, planUsed: 'B' },
            cameras: [{ id: 'cam1', label: 'Cam 1', x: 0, y: 0 }],
            objects: [{ id: 'obj1', label: 'arbol', category: 'vegetacion', x: 1, y: 1 }],
            metadata: { timing: { totalRunMs: 123 } }
        };
        const summary = storage.saveMap(doc);
        assert.equal(summary.mapId, 'map_storage_1');
        assert.equal(summary.stats.cameras, 1);
        assert.equal(summary.stats.objects, 1);
        assert.equal(summary.timing.totalRunMs, 123);

        const latest = storage.getLatestMap();
        assert.equal(latest.mapId, 'map_storage_1');
        const loaded = storage.getMap('map_storage_1');
        assert.equal(loaded.quality.planUsed, 'B');
    });
});

test('manual corrections are persisted and exposed as hints', () => {
    const tempDir = makeTmpDir('maps-corrections');
    withEnv({
        MAPS_DATA_DIR: tempDir,
        METADATA_DRIVER: 'sqlite',
        METADATA_SQLITE_PATH: path.join(tempDir, 'metadata.db')
    }, () => {
        freshRequire('../maps/storage');
        const corrections = freshRequire('../maps/corrections');

        const manualMap = {
            mapId: 'manual_1',
            cameras: [{ id: 'cam1', label: 'Manual Cam', x: 3, y: -2, yawDeg: 120 }],
            objects: [{ id: 'obj1', label: 'auto', category: 'vehiculo', x: 2, y: 1, confidence: 0.8, sources: ['cam1'] }]
        };
        const saved = corrections.upsertFromManualMap(manualMap);
        assert.equal(saved.lastManualMapId, 'manual_1');
        assert.equal(saved.manualCameraLayout.length, 1);
        assert.equal(saved.objectHints.length, 1);

        const hints = corrections.getHintsForGeneration();
        assert.equal(hints.lastManualMapId, 'manual_1');
        assert.equal(hints.manualCameraLayout[0].id, 'cam1');
        assert.equal(hints.objectHints[0].label, 'auto');
    });
});

test('maps modules skip legacy JSON compatibility files in repository-first runtime mode', () => {
    const tempDir = makeTmpDir('maps-no-legacy-exports');
    withEnv({
        MAPS_DATA_DIR: tempDir,
        METADATA_DRIVER: 'sqlite',
        METADATA_SQLITE_PATH: path.join(tempDir, 'metadata.db')
    }, () => {
        const storage = freshRequire('../maps/storage');
        const corrections = freshRequire('../maps/corrections');

        storage.saveMap({
            schemaVersion: '1.0',
            mapId: 'map_sqlite_only_1',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            quality: { mode: 'croquis', score: 0.5, planUsed: 'B' },
            cameras: [{ id: 'cam1', label: 'Cam 1', x: 0, y: 0 }],
            objects: []
        });
        storage.saveJobs([{ id: 'job_1', status: 'completed', requestedAt: Date.now() }]);
        corrections.upsertFromManualMap({
            mapId: 'manual_sqlite_only_1',
            cameras: [{ id: 'cam1', label: 'Manual Cam', x: 1, y: 1, yawDeg: 0 }],
            objects: []
        });

        assert.equal(fs.existsSync(path.join(tempDir, 'index.json')), false);
        assert.equal(fs.existsSync(path.join(tempDir, 'jobs.json')), false);
        assert.equal(fs.existsSync(path.join(tempDir, 'map_sqlite_only_1.json')), false);
        assert.equal(fs.existsSync(path.join(tempDir, 'manual-corrections.json')), false);
    });
});

test('maps legacy bootstrap can be forced for migration flows', () => {
    const tempDir = makeTmpDir('maps-force-bootstrap');
    fs.mkdirSync(tempDir, { recursive: true });
    const legacyMapId = 'map_legacy_1';
    const legacyMapDoc = {
        schemaVersion: '1.0',
        mapId: legacyMapId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        quality: { mode: 'croquis', score: 0.7, planUsed: 'A' },
        cameras: [{ id: 'cam1', label: 'Legacy Cam', x: 4, y: 2, yawDeg: 90 }],
        objects: []
    };
    const legacyIndex = {
        schemaVersion: '1.0',
        activeMapId: legacyMapId,
        maps: [{ mapId: legacyMapId, createdAt: legacyMapDoc.createdAt }]
    };
    const legacyJobs = [{ id: 'legacy_job_1', requestedAt: Date.now(), status: 'completed' }];
    const legacyCorrections = {
        schemaVersion: '1.0',
        updatedAt: Date.now(),
        lastManualMapId: legacyMapId,
        manualCameraLayout: [{ id: 'cam1', label: 'Legacy Cam', x: 4, y: 2, yawDeg: 90 }],
        objectHints: [],
        history: [{ mapId: legacyMapId, ts: Date.now(), cameras: 1, objects: 0 }]
    };
    fs.writeFileSync(path.join(tempDir, 'index.json'), JSON.stringify(legacyIndex, null, 2));
    fs.writeFileSync(path.join(tempDir, `${legacyMapId}.json`), JSON.stringify(legacyMapDoc, null, 2));
    fs.writeFileSync(path.join(tempDir, 'jobs.json'), JSON.stringify(legacyJobs, null, 2));
    fs.writeFileSync(path.join(tempDir, 'manual-corrections.json'), JSON.stringify(legacyCorrections, null, 2));

    withEnv({
        MAPS_DATA_DIR: tempDir,
        METADATA_DRIVER: 'sqlite',
        METADATA_SQLITE_PATH: path.join(tempDir, 'metadata.db')
    }, () => {
        const storage = freshRequire('../maps/storage');
        const corrections = freshRequire('../maps/corrections');

        assert.equal(storage.getMap(legacyMapId), null);
        assert.equal(storage.loadJobs().length, 0);

        const bootstrapSummary = storage.bootstrapFromLegacy();
        const bootCorrections = corrections.bootstrapFromLegacy();
        assert.equal(bootstrapSummary.maps, 1);
        assert.equal(bootstrapSummary.jobs, 1);
        assert.equal(bootCorrections.lastManualMapId, legacyMapId);

        assert.equal(storage.getMap(legacyMapId)?.mapId, legacyMapId);
        assert.equal(storage.loadJobs().length, 1);
        assert.equal(corrections.getHintsForGeneration().lastManualMapId, legacyMapId);
    });
});

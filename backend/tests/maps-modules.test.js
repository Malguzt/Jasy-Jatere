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
    process.env.MAPS_DATA_DIR = tempDir;
    const storage = freshRequire('../maps/storage');
    storage.ensureStorage();

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

test('manual corrections are persisted and exposed as hints', () => {
    const tempDir = makeTmpDir('maps-corrections');
    process.env.MAPS_DATA_DIR = tempDir;
    freshRequire('../maps/storage'); // ensure MAPS_DIR follows new env
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

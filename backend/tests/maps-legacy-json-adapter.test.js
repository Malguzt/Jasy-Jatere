const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createLegacyJsonAdapter } = require('../maps/legacy-json-adapter');

function makeTmpDir(prefix = 'maps-legacy-adapter') {
    return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function makeAdapter(mapsDir) {
    return createLegacyJsonAdapter({
        mapsDir,
        defaultIndex: {
            schemaVersion: '1.0',
            activeMapId: null,
            maps: []
        },
        defaultCorrections: {
            schemaVersion: '1.0',
            updatedAt: null,
            lastManualMapId: null,
            manualCameraLayout: [],
            objectHints: [],
            history: []
        }
    });
}

test('legacy json adapter ensures storage files and reads default index/jobs', () => {
    const mapsDir = makeTmpDir('legacy-adapter-storage');
    const adapter = makeAdapter(mapsDir);

    adapter.ensureStorageFiles();
    assert.equal(fs.existsSync(path.join(mapsDir, 'index.json')), true);
    assert.equal(fs.existsSync(path.join(mapsDir, 'jobs.json')), true);

    const index = adapter.readIndex();
    const jobs = adapter.readJobs();
    assert.equal(index.schemaVersion, '1.0');
    assert.deepEqual(jobs, []);
});

test('legacy json adapter writes and reads map docs via map id', () => {
    const mapsDir = makeTmpDir('legacy-adapter-maps');
    const adapter = makeAdapter(mapsDir);

    adapter.writeMap({
        mapId: 'map_1',
        schemaVersion: '1.0',
        createdAt: Date.now(),
        cameras: [],
        objects: []
    });

    const loaded = adapter.readMap('map_1');
    assert.equal(loaded.mapId, 'map_1');
    assert.equal(adapter.readMap('missing'), null);
});

test('legacy json adapter writes and reads corrections payload', () => {
    const mapsDir = makeTmpDir('legacy-adapter-corrections');
    const adapter = makeAdapter(mapsDir);

    const payload = {
        schemaVersion: '1.0',
        updatedAt: Date.now(),
        lastManualMapId: 'map_manual_1',
        manualCameraLayout: [{ id: 'cam-1', label: 'A', x: 0, y: 0, yawDeg: 0 }],
        objectHints: [],
        history: []
    };
    adapter.writeCorrections(payload);

    const loaded = adapter.readCorrections();
    assert.equal(loaded.lastManualMapId, 'map_manual_1');
    assert.equal(Array.isArray(loaded.manualCameraLayout), true);
});

const test = require('node:test');
const assert = require('node:assert/strict');

const { MapsService } = require('../src/domains/maps/maps-service');

function makeDeps() {
    return {
        storage: {
            MAPS_DIR: '/tmp/maps-test',
            saveMap() { return { mapId: 'map-1' }; },
            promoteMap() { return { mapId: 'map-1' }; },
            getMap() { return null; },
            getLatestMap() { return null; },
            getIndex() { return { activeMapId: null }; },
            listMapSummaries() { return []; }
        },
        jobs: {
            queue: [],
            running: false,
            getRuntimeConfig() { return { plans: { D: true } }; },
            createJob() { return { id: 'job-1' }; },
            listJobs() { return []; },
            getJob() { return null; },
            cancelJob() { return null; },
            retryJob() { return null; }
        },
        corrections: {
            getHintsForGeneration() {
                return {
                    updatedAt: null,
                    lastManualMapId: null,
                    manualCameraLayout: [],
                    objectHints: []
                };
            },
            upsertFromManualMap() {},
            saveReusableCorrections(payload = {}) {
                return {
                    schemaVersion: '1.0',
                    updatedAt: Date.now(),
                    lastManualMapId: null,
                    manualCameraLayout: Array.isArray(payload.manualCameraLayout) ? payload.manualCameraLayout : [],
                    objectHints: Array.isArray(payload.objectHints) ? payload.objectHints : [],
                    history: []
                };
            },
            readCorrections() { return {}; }
        }
    };
}

test('constructor requires explicit maps dependencies', () => {
    const deps = makeDeps();
    assert.throws(
        () => new MapsService({ jobs: deps.jobs, corrections: deps.corrections }),
        /Maps storage is required/
    );
    assert.throws(
        () => new MapsService({ storage: deps.storage, corrections: deps.corrections }),
        /Maps jobs module is required/
    );
    assert.throws(
        () => new MapsService({ storage: deps.storage, jobs: deps.jobs }),
        /Maps corrections module is required/
    );
});

test('getHealth returns normalized map runtime snapshot', () => {
    const deps = makeDeps();
    const service = new MapsService(deps);
    const snapshot = service.getHealth();

    assert.equal(snapshot.mapsDir, '/tmp/maps-test');
    assert.equal(snapshot.queued, 0);
    assert.equal(snapshot.running, false);
    assert.equal(snapshot.runtime?.plans?.D, true);
    assert.equal(snapshot.corrections.manualCameraLayout, 0);
    assert.equal(snapshot.corrections.objectHints, 0);
});

test('saveCorrections persists reusable hints without creating a map', () => {
    const deps = makeDeps();
    const service = new MapsService(deps);

    const saved = service.saveCorrections({
        cameras: [{ id: 'cam-1', label: 'Cam 1', x: 2, y: 3, yawDeg: 90 }],
        objects: [{ label: 'arbol', x: 4, y: 5, cameraId: 'cam-1' }]
    });

    assert.equal(saved.manualCameraLayout.length, 1);
    assert.equal(saved.manualCameraLayout[0].id, 'cam-1');
    assert.equal(saved.objectHints.length, 1);
    assert.equal(saved.objectHints[0].label, 'arbol');
});

test('saveCorrections rejects empty reusable corrections payloads after normalization', () => {
    const deps = makeDeps();
    deps.corrections.readCorrections = () => ({
        schemaVersion: '1.0',
        updatedAt: null,
        lastManualMapId: null,
        manualCameraLayout: [],
        objectHints: [],
        history: []
    });
    const service = new MapsService(deps);

    assert.throws(
        () => service.saveCorrections({
            cameras: [{ id: 'cam-1', label: 'Cam 1' }],
            objects: [{ label: 'obj-invalido' }]
        }),
        /al menos una correccion reutilizable valida/
    );
});

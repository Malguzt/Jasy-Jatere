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

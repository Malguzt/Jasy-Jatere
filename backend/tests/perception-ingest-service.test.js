const test = require('node:test');
const assert = require('node:assert/strict');

const { PerceptionIngestService } = require('../src/domains/perception/perception-ingest-service');

test('ingestObservation appends normalized event', () => {
    const observed = [];
    const service = new PerceptionIngestService({
        observationRepository: {
            append(entry) {
                observed.push(entry);
            },
            list() {
                return observed;
            }
        },
        recordingCatalogService: {
            upsertRecording(value) {
                return value;
            }
        }
    });

    const saved = service.ingestObservation({
        timestamp: '2026-04-02T12:00:00.000Z',
        camera_id: 'cam-1',
        type: 'motion'
    });

    assert.equal(saved.camera_id, 'cam-1');
    assert.equal(observed.length, 1);
});

test('ingestObservation validates required payload fields', () => {
    const service = new PerceptionIngestService({
        observationRepository: {
            append() {},
            list() { return []; }
        },
        recordingCatalogService: {
            upsertRecording(value) {
                return value;
            }
        }
    });

    assert.throws(
        () => service.ingestObservation({ camera_id: 'cam-1', type: 'motion' }),
        /timestamp is required/
    );
});

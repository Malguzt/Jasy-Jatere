const test = require('node:test');
const assert = require('node:assert/strict');

const { validateBySchemaId } = require('../src/contracts/validator');

test('map generate request schema accepts empty object and valid optional fields', () => {
    const empty = validateBySchemaId('jasy-jatere/contracts/map-generate-request/v1', {});
    assert.equal(empty.ok, true);

    const payload = validateBySchemaId('jasy-jatere/contracts/map-generate-request/v1', {
        promote: true,
        reason: 'manual-refresh',
        planHint: 'C',
        forceFallback: false,
        objectHints: [{ label: 'car', confidence: 0.7 }],
        manualCameraLayout: [{ id: 'cam1', x: 1, y: 2 }]
    });
    assert.equal(payload.ok, true);
});

test('map manual request schema requires cameras array', () => {
    const missing = validateBySchemaId('jasy-jatere/contracts/map-manual-request/v1', {});
    assert.equal(missing.ok, false);
    assert.ok(missing.errors.some((error) => error.includes('$.cameras')));

    const good = validateBySchemaId('jasy-jatere/contracts/map-manual-request/v1', {
        cameras: [{ id: 'cam1', label: 'Cam 1', x: 0, y: 0 }],
        objects: [{ label: 'tree', x: 1, y: 2 }]
    });
    assert.equal(good.ok, true);
});

test('map corrections request schema requires cameras or objects payload', () => {
    const missing = validateBySchemaId('jasy-jatere/contracts/map-corrections-request/v1', {});
    assert.equal(missing.ok, false);

    const camerasOnly = validateBySchemaId('jasy-jatere/contracts/map-corrections-request/v1', {
        cameras: [{ id: 'cam1', label: 'Cam 1', x: 0, y: 0 }]
    });
    assert.equal(camerasOnly.ok, true);

    const objectsOnly = validateBySchemaId('jasy-jatere/contracts/map-corrections-request/v1', {
        objects: [{ label: 'tree', x: 1, y: 2 }]
    });
    assert.equal(objectsOnly.ok, true);
});

test('saved camera create schema blocks unknown properties', () => {
    const invalid = validateBySchemaId('jasy-jatere/contracts/saved-camera-create-request/v1', {
        rtspUrl: 'rtsp://example.local/stream',
        unknownField: true
    });
    assert.equal(invalid.ok, false);
    assert.ok(invalid.errors.some((error) => error.includes('unknownField')));

    const valid = validateBySchemaId('jasy-jatere/contracts/saved-camera-create-request/v1', {
        rtspUrl: 'rtsp://example.local/stream',
        type: 'single'
    });
    assert.equal(valid.ok, true);
});

test('saved camera patch schema requires at least one property', () => {
    const invalid = validateBySchemaId('jasy-jatere/contracts/saved-camera-patch-request/v1', {});
    assert.equal(invalid.ok, false);
    assert.ok(invalid.errors.some((error) => error.includes('at least 1 properties')));

    const valid = validateBySchemaId('jasy-jatere/contracts/saved-camera-patch-request/v1', { name: 'Updated' });
    assert.equal(valid.ok, true);
});

test('camera connect schema requires url', () => {
    const invalid = validateBySchemaId('jasy-jatere/contracts/camera-connect-request/v1', { user: 'admin' });
    assert.equal(invalid.ok, false);
    assert.ok(invalid.errors.some((error) => error.includes('$.url')));

    const valid = validateBySchemaId('jasy-jatere/contracts/camera-connect-request/v1', { url: 'http://192.168.1.10/onvif/device_service' });
    assert.equal(valid.ok, true);
});

test('ptz and snapshot schemas enforce required fields', () => {
    const moveInvalid = validateBySchemaId('jasy-jatere/contracts/ptz-move-request/v1', {
        url: 'http://camera/onvif',
        direction: 'diagonal'
    });
    assert.equal(moveInvalid.ok, false);

    const moveValid = validateBySchemaId('jasy-jatere/contracts/ptz-move-request/v1', {
        url: 'http://camera/onvif',
        direction: 'left'
    });
    assert.equal(moveValid.ok, true);

    const stopInvalid = validateBySchemaId('jasy-jatere/contracts/ptz-stop-request/v1', {});
    assert.equal(stopInvalid.ok, false);

    const snapshotValid = validateBySchemaId('jasy-jatere/contracts/snapshot-request/v1', {
        url: 'http://camera/onvif'
    });
    assert.equal(snapshotValid.ok, true);
});

test('light toggle schema requires boolean enabled', () => {
    const invalid = validateBySchemaId('jasy-jatere/contracts/light-toggle-request/v1', {
        url: 'http://camera/onvif',
        enabled: 'true'
    });
    assert.equal(invalid.ok, false);

    const valid = validateBySchemaId('jasy-jatere/contracts/light-toggle-request/v1', {
        url: 'http://camera/onvif',
        enabled: true
    });
    assert.equal(valid.ok, true);
});

test('stream sync request schema validates optional manual metadata', () => {
    const empty = validateBySchemaId('jasy-jatere/contracts/stream-sync-request/v1', {});
    assert.equal(empty.ok, true);

    const valid = validateBySchemaId('jasy-jatere/contracts/stream-sync-request/v1', {
        reason: 'operator-manual-sync',
        requestedBy: 'control-room'
    });
    assert.equal(valid.ok, true);

    const invalid = validateBySchemaId('jasy-jatere/contracts/stream-sync-request/v1', {
        reason: '',
        unknownField: true
    });
    assert.equal(invalid.ok, false);
    assert.ok(invalid.errors.some((error) => error.includes('$.reason')));
    assert.ok(invalid.errors.some((error) => error.includes('unknownField')));

    const tooLongReason = validateBySchemaId('jasy-jatere/contracts/stream-sync-request/v1', {
        reason: 'x'.repeat(121)
    });
    assert.equal(tooLongReason.ok, false);
    assert.ok(tooLongReason.errors.some((error) => error.includes('length must be <= 120')));
});

test('stream webrtc schemas validate required fields and shape', () => {
    const createInvalid = validateBySchemaId('jasy-jatere/contracts/stream-webrtc-session-create-request/v1', {});
    assert.equal(createInvalid.ok, false);

    const createValid = validateBySchemaId('jasy-jatere/contracts/stream-webrtc-session-create-request/v1', {
        cameraId: 'cam-1',
        offer: {
            type: 'offer',
            sdp: 'v=0\\n...'
        }
    });
    assert.equal(createValid.ok, true);

    const candidateInvalid = validateBySchemaId('jasy-jatere/contracts/stream-webrtc-candidate-request/v1', {
        cameraId: 'cam-1'
    });
    assert.equal(candidateInvalid.ok, false);
    assert.ok(candidateInvalid.errors.some((error) => error.includes('$.candidate')));

    const candidateShapeInvalid = validateBySchemaId('jasy-jatere/contracts/stream-webrtc-candidate-request/v1', {
        cameraId: 'cam-1',
        candidate: {}
    });
    assert.equal(candidateShapeInvalid.ok, false);
    assert.ok(candidateShapeInvalid.errors.some((error) => error.includes('match exactly one schema variant')));

    const candidateValid = validateBySchemaId('jasy-jatere/contracts/stream-webrtc-candidate-request/v1', {
        cameraId: 'cam-1',
        candidate: {
            candidate: 'candidate:1 1 UDP 2122252543 192.168.1.2 54400 typ host',
            sdpMLineIndex: 0
        }
    });
    assert.equal(candidateValid.ok, true);

    const closeInvalid = validateBySchemaId('jasy-jatere/contracts/stream-webrtc-session-close-request/v1', {});
    assert.equal(closeInvalid.ok, false);
    assert.ok(closeInvalid.errors.some((error) => error.includes('$.cameraId')));

    const closeValid = validateBySchemaId('jasy-jatere/contracts/stream-webrtc-session-close-request/v1', {
        cameraId: 'cam-1'
    });
    assert.equal(closeValid.ok, true);
});

test('perception ingest schemas validate required fields', () => {
    const observationValid = validateBySchemaId('jasy-jatere/contracts/observation-event-ingest-request/v1', {
        timestamp: '2026-04-02T12:00:00.000Z',
        camera_id: 'cam-1',
        type: 'motion'
    });
    assert.equal(observationValid.ok, true);

    const observationInvalid = validateBySchemaId('jasy-jatere/contracts/observation-event-ingest-request/v1', {
        camera_id: 'cam-1'
    });
    assert.equal(observationInvalid.ok, false);

    const recordingValid = validateBySchemaId('jasy-jatere/contracts/recording-catalog-upsert-request/v1', {
        filename: 'cam_1.mp4',
        camera_id: 'cam-1',
        event_time: '2026-04-02T12:00:00.000Z',
        status: 'ready'
    });
    assert.equal(recordingValid.ok, true);

    const recordingInvalid = validateBySchemaId('jasy-jatere/contracts/recording-catalog-upsert-request/v1', {
        filename: 'cam_1.mp4',
        status: 'ready'
    });
    assert.equal(recordingInvalid.ok, false);
});

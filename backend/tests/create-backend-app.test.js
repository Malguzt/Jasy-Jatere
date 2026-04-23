const test = require('node:test');
const assert = require('node:assert/strict');

const { createBackendApp } = require('../src/app/create-backend-app');
const { validateBySchemaId } = require('../src/contracts/validator');

test('createBackendApp returns express app and runtime coordinator', () => {
    const built = createBackendApp();

    assert.equal(typeof built, 'object');
    assert.equal(typeof built.app, 'function');
    assert.equal(typeof built.platformRuntimeCoordinator, 'object');
    assert.equal(typeof built.platformRuntimeCoordinator.start, 'function');
});

test('createBackendApp serves canonical camera API namespace and retires legacy aliases', async () => {
    const built = createBackendApp();

    const server = await new Promise((resolve, reject) => {
        const instance = built.app.listen(0, '127.0.0.1');
        instance.once('listening', () => resolve(instance));
        instance.once('error', reject);
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
        const canonical = await fetch(`${baseUrl}/api/cameras/ptz/stop`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        });
        const legacy = await fetch(`${baseUrl}/api/ptz/stop`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        });

        assert.equal(canonical.status, 400);
        assert.equal(legacy.status, 404);

        const detectorRecordingsLegacy = await fetch(`${baseUrl}/api/detector/recordings`);
        const detectorRecordingsLegacyPayload = await detectorRecordingsLegacy.json();
        assert.equal(detectorRecordingsLegacy.status, 410);
        assert.equal(detectorRecordingsLegacyPayload.success, false);
        assert.equal(detectorRecordingsLegacyPayload.code, 'DETECTOR_RECORDINGS_ENDPOINT_RETIRED');
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('createBackendApp exposes internal worker config and perception ingest APIs', async () => {
    const built = createBackendApp({
        runtimeFlags: {
            streamGatewayApiUrl: '',
            streamProxyModeEnabled: false,
            streamProxyRequired: false,
            streamRuntimeEnabled: true,
            streamWebSocketGatewayEnabled: true,
            streamWebRtcEnabled: false,
            streamWebRtcRequireHttps: true,
            streamWebRtcSignalingUrl: '',
            streamWebRtcIceServersJson: '',
            streamWebRtcSignalingRetries: 1,
            streamPublicBaseUrl: '',
            recordingRetentionEnabled: false,
            recordingRetentionIntervalMs: 60000,
            recordingRetentionMaxAgeDays: null,
            recordingRetentionMaxEntries: null,
            recordingsMaxSizeGb: 50,
            recordingsDeleteOldestBatch: 100,
            observationMaxEntries: 2500
        }
    });

    const server = await new Promise((resolve, reject) => {
        const instance = built.app.listen(0, '127.0.0.1');
        instance.once('listening', () => resolve(instance));
        instance.once('error', reject);
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
        const camerasCfg = await fetch(`${baseUrl}/api/internal/config/cameras`);
        const camerasPayload = await camerasCfg.json();
        assert.equal(camerasCfg.status, 200);
        assert.equal(camerasPayload.success, true);
        assert.ok(Array.isArray(camerasPayload.cameras));
        const cameraConfigShape = validateBySchemaId(
            'jasy-jatere/internal-camera-config-snapshot',
            camerasPayload
        );
        assert.equal(cameraConfigShape.ok, true, cameraConfigShape.errors?.join('; '));

        const streamsCfg = await fetch(`${baseUrl}/api/internal/config/streams`);
        const streamsPayload = await streamsCfg.json();
        assert.equal(streamsCfg.status, 200);
        assert.equal(streamsPayload.success, true);
        const streamConfigShape = validateBySchemaId(
            'jasy-jatere/internal-stream-config-snapshot',
            streamsPayload
        );
        assert.equal(streamConfigShape.ok, true, streamConfigShape.errors?.join('; '));

        const retentionCfg = await fetch(`${baseUrl}/api/internal/config/retention`);
        const retentionPayload = await retentionCfg.json();
        assert.equal(retentionCfg.status, 200);
        assert.equal(retentionPayload.success, true);
        assert.equal(typeof retentionPayload.retention?.recordingsMaxSizeGb, 'number');
        assert.equal(typeof retentionPayload.retention?.deleteOldestBatch, 'number');
        assert.equal(typeof retentionPayload.retention?.recordingCatalog?.enabled, 'boolean');
        const retentionConfigShape = validateBySchemaId(
            'jasy-jatere/internal-retention-config-snapshot',
            retentionPayload
        );
        assert.equal(retentionConfigShape.ok, true, retentionConfigShape.errors?.join('; '));

        const invalidObservation = await fetch(`${baseUrl}/api/perception/observations`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ camera_id: 'cam-1' })
        });
        assert.equal(invalidObservation.status, 400);

        const capabilitiesRes = await fetch(`${baseUrl}/api/streams/capabilities`);
        const capabilitiesPayload = await capabilitiesRes.json();
        assert.equal(capabilitiesRes.status, 500);
        assert.equal(capabilitiesPayload.success, false);

        const streamSessionRes = await fetch(`${baseUrl}/api/streams/sessions/missing-camera`);
        const streamSessionPayload = await streamSessionRes.json();
        assert.equal(streamSessionRes.status, 500);
        assert.equal(streamSessionPayload.success, false);

        const webrtcSessionRes = await fetch(`${baseUrl}/api/streams/webrtc/sessions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        });
        const webrtcSessionPayload = await webrtcSessionRes.json();
        assert.equal(webrtcSessionRes.status, 400);
        assert.equal(webrtcSessionPayload.success, false);

        const candidateRes = await fetch(`${baseUrl}/api/streams/webrtc/sessions/sess-missing/candidates`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        });
        const candidatePayload = await candidateRes.json();
        assert.equal(candidateRes.status, 400);
        assert.equal(candidatePayload.success, false);

        const closeRes = await fetch(`${baseUrl}/api/streams/webrtc/sessions/sess-missing`, {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ cameraId: 'cam-1' })
        });
        const closePayload = await closeRes.json();
        assert.equal(closeRes.status, 500);
        assert.equal(closePayload.success, false);

        const liveRes = await fetch(`${baseUrl}/api/health/live`);
        const livePayload = await liveRes.json();
        assert.equal(liveRes.status, 200);
        assert.equal(livePayload.success, true);
        assert.equal(livePayload.liveness.alive, true);

        const readyRes = await fetch(`${baseUrl}/api/health/ready`);
        const readyPayload = await readyRes.json();
        assert.equal(readyRes.status, 503);
        assert.equal(readyPayload.success, false);
        assert.ok(Array.isArray(readyPayload.readiness?.failures));
        assert.ok(readyPayload.readiness.failures.includes('streamGatewayProxy'));

        const livezRes = await fetch(`${baseUrl}/livez`);
        assert.equal(livezRes.status, 200);

        const readyzRes = await fetch(`${baseUrl}/readyz`);
        assert.equal(readyzRes.status, 503);

        const metricsRes = await fetch(`${baseUrl}/metrics`);
        assert.equal(metricsRes.status, 200);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('createBackendApp degrades readiness when stream proxy mode is required and gateway is unreachable', async () => {
    const built = createBackendApp({
        runtimeFlags: {
            streamGatewayApiUrl: 'http://127.0.0.1:9/api/internal/streams',
            streamProxyModeEnabled: true,
            streamProxyRequired: true,
            streamRuntimeEnabled: false,
            streamWebSocketGatewayEnabled: false,
            streamWebRtcEnabled: false,
            streamWebRtcRequireHttps: true,
            recordingRetentionEnabled: false,
            recordingRetentionIntervalMs: 60000,
            recordingRetentionMaxAgeDays: null,
            recordingRetentionMaxEntries: null,
            recordingsMaxSizeGb: 50,
            recordingsDeleteOldestBatch: 100,
            observationMaxEntries: 2500
        }
    });

    const server = await new Promise((resolve, reject) => {
        const instance = built.app.listen(0, '127.0.0.1');
        instance.once('listening', () => resolve(instance));
        instance.once('error', reject);
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
        const streamsCfg = await fetch(`${baseUrl}/api/internal/config/streams`);
        const streamsPayload = await streamsCfg.json();
        assert.equal(streamsCfg.status, 200);
        assert.equal(streamsPayload.success, true);
        assert.equal(streamsPayload.runtime, null);
        const streamConfigShape = validateBySchemaId(
            'jasy-jatere/internal-stream-config-snapshot',
            streamsPayload
        );
        assert.equal(streamConfigShape.ok, true, streamConfigShape.errors?.join('; '));

        const runtimeRes = await fetch(`${baseUrl}/api/streams/runtime`);
        assert.equal(runtimeRes.status, 502);

        const readyRes = await fetch(`${baseUrl}/api/health/ready`);
        const readyPayload = await readyRes.json();
        assert.equal(readyRes.status, 503);
        assert.equal(readyPayload.success, false);
        assert.ok(Array.isArray(readyPayload.readiness?.failures));
        assert.ok(readyPayload.readiness.failures.includes('streamGatewayProxy'));

        const readyzRes = await fetch(`${baseUrl}/readyz`);
        const readyzPayload = await readyzRes.json();
        assert.equal(readyzRes.status, 503);
        assert.equal(readyzPayload.success, false);
        assert.ok(readyzPayload.readiness.failures.includes('streamGatewayProxy'));

        const metricsRes = await fetch(`${baseUrl}/metrics`);
        assert.equal(metricsRes.status, 500);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

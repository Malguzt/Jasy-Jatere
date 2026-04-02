const test = require('node:test');
const assert = require('node:assert/strict');

const { StreamSyncOrchestrator } = require('../src/domains/streams/stream-sync-orchestrator');

function makeOrchestrator(overrides = {}) {
    return new StreamSyncOrchestrator({
        cameraFile: '/tmp/cameras.json',
        streamManager: overrides.streamManager || { syncKeepaliveConfigs: () => {} },
        resolveCameraStreamUrls: overrides.resolveCameraStreamUrls || ((camera) => ({
            rtspUrl: camera.rtspUrl,
            allRtspUrls: camera.allRtspUrls || []
        })),
        deriveCompanionRtsp: overrides.deriveCompanionRtsp || ((url) => `${url}?companion=1`),
        parseResolutionHint: overrides.parseResolutionHint || ((hint) => {
            const match = String(hint || '').match(/(\d+)\s*x\s*(\d+)/i);
            if (!match) return null;
            return { pixels: Number(match[1]) * Number(match[2]) };
        }),
        fetchImpl: overrides.fetchImpl || (async () => ({ ok: true })),
        fsModule: overrides.fsModule || {
            existsSync: () => true,
            readFileSync: () => '[]'
        },
        logger: overrides.logger || { error: () => {} },
        reconstructorUrl: overrides.reconstructorUrl || 'http://localhost:5001',
        syncIntervalMs: overrides.syncIntervalMs || 10000,
        initialDelayMs: overrides.initialDelayMs || 1500,
        setTimeoutFn: overrides.setTimeoutFn || setTimeout,
        setIntervalFn: overrides.setIntervalFn || setInterval,
        clearTimeoutFn: overrides.clearTimeoutFn || clearTimeout,
        clearIntervalFn: overrides.clearIntervalFn || clearInterval
    });
}

test('selectReconstructorPair prefers highest resolution as main and lowest as sub', () => {
    const orchestrator = makeOrchestrator();
    const pair = orchestrator.selectReconstructorPair({
        id: 'cam-1',
        type: 'combined',
        rtspUrl: 'combined',
        allRtspUrls: ['rtsp://cam/low', 'rtsp://cam/high'],
        sourceLabels: ['640x360', '1920x1080']
    });

    assert.deepEqual(pair, {
        id: 'cam-1',
        main: 'rtsp://cam/high',
        sub: 'rtsp://cam/low'
    });
});

test('syncNow updates keepalive configs and posts reconstructor stream payload', async () => {
    const syncedConfigs = [];
    const fetchCalls = [];

    const orchestrator = makeOrchestrator({
        streamManager: {
            syncKeepaliveConfigs: (configs) => syncedConfigs.push(configs)
        },
        fsModule: {
            existsSync: () => true,
            readFileSync: () => JSON.stringify([
                {
                    id: 'cam-1',
                    type: 'combined',
                    rtspUrl: 'combined',
                    allRtspUrls: ['rtsp://cam/low', 'rtsp://cam/high'],
                    sourceLabels: ['640x360', '1920x1080']
                }
            ])
        },
        fetchImpl: async (url, options) => {
            fetchCalls.push({ url, options });
            return { ok: true };
        }
    });

    const result = await orchestrator.syncNow();

    assert.equal(result.success, true);
    assert.equal(result.cameraCount, 1);
    assert.equal(result.keepaliveCount, 1);
    assert.equal(result.reconstructorStreamCount, 1);
    assert.equal(syncedConfigs.length, 1);
    assert.equal(syncedConfigs[0][0].id, 'cam-1');
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, 'http://localhost:5001/configure');

    const body = JSON.parse(fetchCalls[0].options.body);
    assert.deepEqual(body, {
        streams: [{ id: 'cam-1', main: 'rtsp://cam/high', sub: 'rtsp://cam/low' }],
        prune: true
    });
});

test('syncNow tolerates invalid camera file and still syncs empty config', async () => {
    const syncedConfigs = [];
    let loggerCalls = 0;
    const orchestrator = makeOrchestrator({
        streamManager: {
            syncKeepaliveConfigs: (configs) => syncedConfigs.push(configs)
        },
        fsModule: {
            existsSync: () => true,
            readFileSync: () => '{not-json'
        },
        logger: {
            error: () => {
                loggerCalls += 1;
            }
        }
    });

    const result = await orchestrator.syncNow();
    assert.equal(result.success, true);
    assert.equal(result.cameraCount, 0);
    assert.equal(syncedConfigs.length, 1);
    assert.deepEqual(syncedConfigs[0], []);
    assert.ok(loggerCalls >= 1);
});

test('start and stop manage initial and periodic timers using configured cadence', () => {
    const timeoutCalls = [];
    const intervalCalls = [];
    const cleared = [];

    const orchestrator = makeOrchestrator({
        syncIntervalMs: 1200,
        initialDelayMs: 800,
        setTimeoutFn: (fn, delay) => {
            timeoutCalls.push({ fn, delay });
            return { t: 'initial' };
        },
        setIntervalFn: (fn, delay) => {
            intervalCalls.push({ fn, delay });
            return { t: 'periodic' };
        },
        clearTimeoutFn: (timer) => {
            cleared.push({ kind: 'timeout', timer });
        },
        clearIntervalFn: (timer) => {
            cleared.push({ kind: 'interval', timer });
        }
    });

    orchestrator.start();
    assert.equal(timeoutCalls.length, 1);
    assert.equal(timeoutCalls[0].delay, 800);
    assert.equal(intervalCalls.length, 1);
    assert.equal(intervalCalls[0].delay, 3000);

    orchestrator.stop();
    assert.deepEqual(cleared, [
        { kind: 'timeout', timer: { t: 'initial' } },
        { kind: 'interval', timer: { t: 'periodic' } }
    ]);
});

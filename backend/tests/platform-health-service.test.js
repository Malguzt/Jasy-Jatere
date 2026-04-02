const test = require('node:test');
const assert = require('node:assert/strict');

const { PlatformHealthService } = require('../src/domains/platform/platform-health-service');

test('getHealthSnapshot aggregates contracts, monitoring, and streams', () => {
    const service = new PlatformHealthService({
        contractsService: {
            getCatalog: () => ({ schemaCount: 18, invalidSchemas: 0, schemas: [] })
        },
        monitoringService: {
            getConnectivitySnapshot: () => ({
                running: true,
                updatedAt: 1700000000200,
                summary: { cameras: 4, online: 3, offline: 1 }
            })
        },
        streamControlService: {
            getRuntimeSnapshot: () => ({
                summary: { streams: 4, activeViewerStreams: 2 },
                syncRuntime: { hasPeriodicTimer: true },
                lastManualSync: { requestedBy: 'ops' }
            })
        },
        recordingRetentionJob: {
            getStatus: () => ({ enabled: true, running: true, maxAgeDays: 14, maxEntries: 100 })
        },
        now: () => 1700000000000,
        uptimeSeconds: () => 12.34567
    });

    const snapshot = service.getHealthSnapshot();
    assert.equal(snapshot.status, 'ok');
    assert.equal(snapshot.now, 1700000000000);
    assert.equal(snapshot.uptimeSeconds, 12.346);
    assert.equal(snapshot.contracts.schemaCount, 18);
    assert.equal(snapshot.monitoring.summary.online, 3);
    assert.equal(snapshot.streams.summary.streams, 4);
    assert.equal(snapshot.recordingsRetention.enabled, true);
});

test('getHealthSnapshot tolerates subsystem read errors', () => {
    const service = new PlatformHealthService({
        contractsService: {
            getCatalog: () => {
                throw new Error('contracts unavailable');
            }
        },
        monitoringService: {
            getConnectivitySnapshot: () => {
                throw new Error('monitoring unavailable');
            }
        },
        streamControlService: {
            getRuntimeSnapshot: () => {
                throw new Error('streams unavailable');
            }
        },
        now: () => 1700000000000,
        uptimeSeconds: () => 1.2
    });

    const snapshot = service.getHealthSnapshot();
    assert.equal(snapshot.status, 'ok');
    assert.equal(snapshot.contracts, null);
    assert.equal(snapshot.monitoring, null);
    assert.equal(snapshot.streams, null);
    assert.equal(snapshot.recordingsRetention, null);
});

test('getReadinessSnapshot returns ready when core checks are healthy', () => {
    const service = new PlatformHealthService({
        contractsService: {
            getCatalog: () => ({ schemaCount: 20, invalidSchemas: 0 })
        },
        monitoringService: {
            getConnectivitySnapshot: () => ({ running: true, updatedAt: 1700000000100, summary: {} })
        },
        streamControlService: {
            getRuntimeSnapshot: () => ({ summary: { streams: 2 } })
        },
        now: () => 1700000000000,
        uptimeSeconds: () => 3.4
    });

    const readiness = service.getReadinessSnapshot();
    assert.equal(readiness.ready, true);
    assert.equal(readiness.status, 'ready');
    assert.deepEqual(readiness.failures, []);
});

test('getReadinessSnapshot marks degraded when configured checks fail', () => {
    const service = new PlatformHealthService({
        contractsService: {
            getCatalog: () => ({ schemaCount: 20, invalidSchemas: 2 })
        },
        monitoringService: {
            getConnectivitySnapshot: () => {
                throw new Error('monitoring down');
            }
        },
        streamControlService: {
            getRuntimeSnapshot: () => ({ summary: { streams: 1 } })
        },
        now: () => 1700000000000,
        uptimeSeconds: () => 3.4
    });

    const readiness = service.getReadinessSnapshot();
    assert.equal(readiness.ready, false);
    assert.equal(readiness.status, 'degraded');
    assert.deepEqual(readiness.failures.sort(), ['contracts', 'monitoring']);
});

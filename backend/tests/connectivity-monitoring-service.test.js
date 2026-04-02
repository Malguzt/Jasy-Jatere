const test = require('node:test');
const assert = require('node:assert/strict');

const {
    ConnectivityMonitoringService
} = require('../src/domains/monitoring/connectivity-monitoring-service');

test('getConnectivitySnapshot proxies monitor snapshot', () => {
    const snapshot = { success: true, summary: { cameras: 3, online: 2, offline: 1 } };
    const saved = [];
    const service = new ConnectivityMonitoringService({
        connectivityMonitor: {
            getSnapshot: () => snapshot
        },
        healthSnapshotRepository: {
            save: (next) => saved.push(next)
        }
    });

    assert.deepEqual(service.getConnectivitySnapshot(), snapshot);
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0], snapshot);
});

test('forceConnectivityProbe returns monitor forced snapshot', async () => {
    const forcedSnapshot = { success: true, running: false, summary: { cameras: 1 } };
    const saved = [];
    const service = new ConnectivityMonitoringService({
        connectivityMonitor: {
            getSnapshot: () => forcedSnapshot,
            forceProbe: async () => forcedSnapshot
        },
        healthSnapshotRepository: {
            save: (next) => saved.push(next)
        }
    });

    const result = await service.forceConnectivityProbe();
    assert.deepEqual(result, forcedSnapshot);
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0], forcedSnapshot);
});

test('snapshot persistence failures do not break monitoring responses', () => {
    const snapshot = { success: true, summary: { cameras: 1, online: 1, offline: 0 } };
    const service = new ConnectivityMonitoringService({
        connectivityMonitor: {
            getSnapshot: () => snapshot
        },
        healthSnapshotRepository: {
            save: () => {
                throw new Error('disk full');
            }
        }
    });

    assert.deepEqual(service.getConnectivitySnapshot(), snapshot);
});

test('renderPrometheusMetrics includes expected metrics and escaped labels', () => {
    const service = new ConnectivityMonitoringService({
        connectivityMonitor: {
            getSnapshot: () => ({
                summary: { cameras: 1, online: 1, offline: 0 },
                running: false,
                lastProbeDurationMs: 123.45,
                updatedAt: 1700000000000,
                cameras: [
                    {
                        id: 'cam-1',
                        name: 'Cam "A"\nLab',
                        type: 'single',
                        last: {
                            up: true,
                            transport: 'udp',
                            latencyMs: 52,
                            inputKbps: 1024,
                            decodeHealth: 98,
                            checkedAt: 1700000000200,
                            ws: {
                                outputKbps: 256,
                                clients: 2,
                                restarts: 1,
                                stalls: 0,
                                keepalive: {
                                    desired: true,
                                    active: true,
                                    restarts: 1,
                                    lastByteAt: 1700000000300
                                }
                            },
                            motion: { active: false },
                            selectedSourceIndex: 0,
                            availabilityScore: 2,
                            availability: 'up'
                        },
                        sources: [
                            {
                                id: 'cam-1-src-0',
                                index: 0,
                                name: 'main\\stream',
                                sourceUrl: 'rtsp://cam-1/main',
                                last: {
                                    up: true,
                                    transport: 'udp',
                                    latencyMs: 52,
                                    inputKbps: 1024,
                                    decodeHealth: 98,
                                    fps: 25,
                                    width: 1920,
                                    height: 1080,
                                    checkedAt: 1700000000200,
                                    codec: 'h264',
                                    availabilityScore: 2,
                                    availability: 'up'
                                }
                            }
                        ]
                    }
                ]
            })
        }
    });

    const metrics = service.renderPrometheusMetrics();
    assert.ok(metrics.includes('ipcam_monitor_cameras_total 1'));
    assert.ok(metrics.includes('ipcam_camera_up{camera_id="cam-1",camera_name="Cam \\"A\\"\\nLab",camera_type="single",transport="udp"} 1'));
    assert.ok(metrics.includes('ipcam_camera_source_info{camera_id="cam-1",camera_name="Cam \\"A\\"\\nLab",camera_type="single",source_id="cam-1-src-0",source_index="0",source_name="main\\\\stream",transport="udp",codec="h264",source_url="rtsp://cam-1/main"} 1'));
});

test('renderPrometheusError serializes message in prometheus-safe format', () => {
    const service = new ConnectivityMonitoringService({
        connectivityMonitor: {
            getSnapshot: () => ({})
        }
    });

    const text = service.renderPrometheusError(new Error('boom "x"\nline'));
    assert.equal(text, '# metrics_error boom \\"x\\"\\nline\n');
});

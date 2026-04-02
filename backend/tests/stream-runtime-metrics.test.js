const test = require('node:test');
const assert = require('node:assert/strict');

const { renderStreamRuntimePrometheusMetrics } = require('../src/domains/streams/stream-runtime-metrics');

test('renderStreamRuntimePrometheusMetrics serializes summary, webrtc, and per-camera lines', () => {
    const text = renderStreamRuntimePrometheusMetrics({
        summary: {
            streams: 2,
            activeViewerStreams: 1,
            keepaliveDesired: 2,
            keepaliveActive: 1
        },
        webrtc: {
            attempts: 5,
            success: 4,
            failed: 1,
            closeAttempts: 2,
            closeSuccess: 2,
            closeFailed: 0,
            lastAttemptAt: 1710000000000,
            lastSuccessAt: 1710000001000,
            lastCloseAt: 1710000002000
        },
        streamStats: {
            cam_1: {
                active: true,
                clients: 3,
                keepalive: { desired: true, active: true },
                restarts: 1,
                stalls: 0
            },
            cam_2: {
                active: false,
                clients: 0,
                keepalive: { desired: true, active: false },
                restarts: 2,
                stalls: 5
            }
        }
    });

    assert.equal(text.includes('ipcam_stream_runtime_streams_total 2'), true);
    assert.equal(text.includes('ipcam_stream_webrtc_attempts_total 5'), true);
    assert.equal(text.includes('ipcam_stream_webrtc_close_success_total 2'), true);
    assert.equal(text.includes('ipcam_stream_active{camera_id="cam_1"} 1'), true);
    assert.equal(text.includes('ipcam_stream_stalls_total{camera_id="cam_2"} 5'), true);
});

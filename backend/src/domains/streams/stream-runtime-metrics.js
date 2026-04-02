function escapePrometheusLabel(value) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/"/g, '\\"');
}

function metricLine(name, labels, value) {
    const entries = Object.entries(labels || {})
        .filter(([, labelValue]) => labelValue !== null && labelValue !== undefined && labelValue !== '');
    const labelStr = entries.length
        ? `{${entries.map(([key, labelValue]) => `${key}="${escapePrometheusLabel(labelValue)}"`).join(',')}}`
        : '';
    return `${name}${labelStr} ${value}`;
}

function toNumOrNaN(value) {
    if (value === null || value === undefined || value === '') return NaN;
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : NaN;
}

function renderStreamRuntimePrometheusMetrics(snapshot = {}) {
    const lines = [];
    const summary = snapshot?.summary || {};
    const webrtc = snapshot?.webrtc || {};
    const streamStats = snapshot?.streamStats || {};

    lines.push('# HELP ipcam_stream_runtime_streams_total Total stream runtime entries');
    lines.push('# TYPE ipcam_stream_runtime_streams_total gauge');
    lines.push(`ipcam_stream_runtime_streams_total ${Number.isFinite(toNumOrNaN(summary.streams)) ? toNumOrNaN(summary.streams) : 0}`);

    lines.push('# HELP ipcam_stream_runtime_active_viewer_streams_total Stream entries with active viewers');
    lines.push('# TYPE ipcam_stream_runtime_active_viewer_streams_total gauge');
    lines.push(`ipcam_stream_runtime_active_viewer_streams_total ${Number.isFinite(toNumOrNaN(summary.activeViewerStreams)) ? toNumOrNaN(summary.activeViewerStreams) : 0}`);

    lines.push('# HELP ipcam_stream_runtime_keepalive_desired_total Streams that should keep keepalive active');
    lines.push('# TYPE ipcam_stream_runtime_keepalive_desired_total gauge');
    lines.push(`ipcam_stream_runtime_keepalive_desired_total ${Number.isFinite(toNumOrNaN(summary.keepaliveDesired)) ? toNumOrNaN(summary.keepaliveDesired) : 0}`);

    lines.push('# HELP ipcam_stream_runtime_keepalive_active_total Streams with active keepalive');
    lines.push('# TYPE ipcam_stream_runtime_keepalive_active_total gauge');
    lines.push(`ipcam_stream_runtime_keepalive_active_total ${Number.isFinite(toNumOrNaN(summary.keepaliveActive)) ? toNumOrNaN(summary.keepaliveActive) : 0}`);

    lines.push('# HELP ipcam_stream_webrtc_attempts_total Total WebRTC session-create attempts');
    lines.push('# TYPE ipcam_stream_webrtc_attempts_total counter');
    lines.push(`ipcam_stream_webrtc_attempts_total ${Number.isFinite(toNumOrNaN(webrtc.attempts)) ? toNumOrNaN(webrtc.attempts) : 0}`);

    lines.push('# HELP ipcam_stream_webrtc_success_total Total successful WebRTC session-create attempts');
    lines.push('# TYPE ipcam_stream_webrtc_success_total counter');
    lines.push(`ipcam_stream_webrtc_success_total ${Number.isFinite(toNumOrNaN(webrtc.success)) ? toNumOrNaN(webrtc.success) : 0}`);

    lines.push('# HELP ipcam_stream_webrtc_failed_total Total failed WebRTC session-create attempts');
    lines.push('# TYPE ipcam_stream_webrtc_failed_total counter');
    lines.push(`ipcam_stream_webrtc_failed_total ${Number.isFinite(toNumOrNaN(webrtc.failed)) ? toNumOrNaN(webrtc.failed) : 0}`);

    lines.push('# HELP ipcam_stream_webrtc_close_attempts_total Total WebRTC session-close attempts');
    lines.push('# TYPE ipcam_stream_webrtc_close_attempts_total counter');
    lines.push(`ipcam_stream_webrtc_close_attempts_total ${Number.isFinite(toNumOrNaN(webrtc.closeAttempts)) ? toNumOrNaN(webrtc.closeAttempts) : 0}`);

    lines.push('# HELP ipcam_stream_webrtc_close_success_total Total successful WebRTC session-close attempts');
    lines.push('# TYPE ipcam_stream_webrtc_close_success_total counter');
    lines.push(`ipcam_stream_webrtc_close_success_total ${Number.isFinite(toNumOrNaN(webrtc.closeSuccess)) ? toNumOrNaN(webrtc.closeSuccess) : 0}`);

    lines.push('# HELP ipcam_stream_webrtc_close_failed_total Total failed WebRTC session-close attempts');
    lines.push('# TYPE ipcam_stream_webrtc_close_failed_total counter');
    lines.push(`ipcam_stream_webrtc_close_failed_total ${Number.isFinite(toNumOrNaN(webrtc.closeFailed)) ? toNumOrNaN(webrtc.closeFailed) : 0}`);

    lines.push('# HELP ipcam_stream_webrtc_last_attempt_seconds Last WebRTC create-attempt timestamp (epoch seconds)');
    lines.push('# TYPE ipcam_stream_webrtc_last_attempt_seconds gauge');
    lines.push(`ipcam_stream_webrtc_last_attempt_seconds ${webrtc.lastAttemptAt ? (Number(webrtc.lastAttemptAt) / 1000).toFixed(3) : 'NaN'}`);

    lines.push('# HELP ipcam_stream_webrtc_last_success_seconds Last successful WebRTC create timestamp (epoch seconds)');
    lines.push('# TYPE ipcam_stream_webrtc_last_success_seconds gauge');
    lines.push(`ipcam_stream_webrtc_last_success_seconds ${webrtc.lastSuccessAt ? (Number(webrtc.lastSuccessAt) / 1000).toFixed(3) : 'NaN'}`);

    lines.push('# HELP ipcam_stream_webrtc_last_close_seconds Last WebRTC close-attempt timestamp (epoch seconds)');
    lines.push('# TYPE ipcam_stream_webrtc_last_close_seconds gauge');
    lines.push(`ipcam_stream_webrtc_last_close_seconds ${webrtc.lastCloseAt ? (Number(webrtc.lastCloseAt) / 1000).toFixed(3) : 'NaN'}`);

    lines.push('# HELP ipcam_stream_active Per-camera stream active state (1/0)');
    lines.push('# TYPE ipcam_stream_active gauge');
    lines.push('# HELP ipcam_stream_clients Per-camera websocket clients');
    lines.push('# TYPE ipcam_stream_clients gauge');
    lines.push('# HELP ipcam_stream_keepalive_desired Per-camera keepalive desired state (1/0)');
    lines.push('# TYPE ipcam_stream_keepalive_desired gauge');
    lines.push('# HELP ipcam_stream_keepalive_active Per-camera keepalive active state (1/0)');
    lines.push('# TYPE ipcam_stream_keepalive_active gauge');
    lines.push('# HELP ipcam_stream_restarts_total Per-camera stream restart count');
    lines.push('# TYPE ipcam_stream_restarts_total gauge');
    lines.push('# HELP ipcam_stream_stalls_total Per-camera stream stall count');
    lines.push('# TYPE ipcam_stream_stalls_total gauge');

    Object.entries(streamStats).forEach(([cameraId, stream]) => {
        const labels = { camera_id: cameraId };
        lines.push(metricLine('ipcam_stream_active', labels, stream?.active ? 1 : 0));
        lines.push(metricLine('ipcam_stream_clients', labels, Number.isFinite(toNumOrNaN(stream?.clients)) ? toNumOrNaN(stream.clients) : 0));
        lines.push(metricLine('ipcam_stream_keepalive_desired', labels, stream?.keepalive?.desired ? 1 : 0));
        lines.push(metricLine('ipcam_stream_keepalive_active', labels, stream?.keepalive?.active ? 1 : 0));
        lines.push(metricLine('ipcam_stream_restarts_total', labels, Number.isFinite(toNumOrNaN(stream?.restarts)) ? toNumOrNaN(stream.restarts) : 0));
        lines.push(metricLine('ipcam_stream_stalls_total', labels, Number.isFinite(toNumOrNaN(stream?.stalls)) ? toNumOrNaN(stream.stalls) : 0));
    });

    return `${lines.join('\n')}\n`;
}

module.exports = {
    renderStreamRuntimePrometheusMetrics
};

function monitoringServiceError(status, message, code = null, details = null) {
    const error = new Error(message || 'Monitoring service error');
    error.status = status;
    if (code) error.code = code;
    if (details !== null && details !== undefined) error.details = details;
    return error;
}

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

class ConnectivityMonitoringService {
    constructor({ connectivityMonitor } = {}) {
        this.connectivityMonitor = connectivityMonitor;
    }

    ensureMonitor() {
        if (!this.connectivityMonitor || typeof this.connectivityMonitor.getSnapshot !== 'function') {
            throw monitoringServiceError(500, 'Connectivity monitor not configured', 'MONITOR_NOT_CONFIGURED');
        }
    }

    getConnectivitySnapshot() {
        this.ensureMonitor();
        try {
            return this.connectivityMonitor.getSnapshot();
        } catch (error) {
            throw monitoringServiceError(
                500,
                error?.message || String(error),
                'MONITORING_SNAPSHOT_FAILED'
            );
        }
    }

    async forceConnectivityProbe() {
        this.ensureMonitor();
        if (typeof this.connectivityMonitor.forceProbe !== 'function') {
            throw monitoringServiceError(500, 'forceProbe not available on connectivity monitor', 'FORCE_PROBE_UNAVAILABLE');
        }
        try {
            return await this.connectivityMonitor.forceProbe();
        } catch (error) {
            throw monitoringServiceError(
                500,
                error?.message || String(error),
                'MONITORING_PROBE_FAILED'
            );
        }
    }

    buildPrometheusLines(snapshot = {}) {
        const lines = [];

        lines.push('# HELP ipcam_monitor_cameras_total Total cameras under connectivity monitor');
        lines.push('# TYPE ipcam_monitor_cameras_total gauge');
        lines.push(`ipcam_monitor_cameras_total ${snapshot?.summary?.cameras ?? 0}`);
        lines.push('# HELP ipcam_monitor_online_total Cameras currently online');
        lines.push('# TYPE ipcam_monitor_online_total gauge');
        lines.push(`ipcam_monitor_online_total ${snapshot?.summary?.online ?? 0}`);
        lines.push('# HELP ipcam_monitor_offline_total Cameras currently offline');
        lines.push('# TYPE ipcam_monitor_offline_total gauge');
        lines.push(`ipcam_monitor_offline_total ${snapshot?.summary?.offline ?? 0}`);

        lines.push('# HELP ipcam_monitor_running Whether monitor probe cycle is currently running');
        lines.push('# TYPE ipcam_monitor_running gauge');
        lines.push(`ipcam_monitor_running ${snapshot?.running ? 1 : 0}`);
        lines.push('# HELP ipcam_monitor_last_probe_duration_ms Last full probe cycle duration in milliseconds');
        lines.push('# TYPE ipcam_monitor_last_probe_duration_ms gauge');
        lines.push(`ipcam_monitor_last_probe_duration_ms ${Number.isFinite(Number(snapshot?.lastProbeDurationMs)) ? Number(snapshot.lastProbeDurationMs) : 'NaN'}`);
        lines.push('# HELP ipcam_monitor_updated_at_seconds Last monitor update epoch timestamp');
        lines.push('# TYPE ipcam_monitor_updated_at_seconds gauge');
        lines.push(`ipcam_monitor_updated_at_seconds ${snapshot?.updatedAt ? (snapshot.updatedAt / 1000).toFixed(3) : 'NaN'}`);

        lines.push('# HELP ipcam_camera_up Camera connectivity status (1 up, 0 down)');
        lines.push('# TYPE ipcam_camera_up gauge');
        lines.push('# HELP ipcam_camera_latency_ms First valid frame latency in milliseconds');
        lines.push('# TYPE ipcam_camera_latency_ms gauge');
        lines.push('# HELP ipcam_camera_input_kbps Estimated input bitrate in kbps');
        lines.push('# TYPE ipcam_camera_input_kbps gauge');
        lines.push('# HELP ipcam_camera_decode_health_percent Decode health score percent');
        lines.push('# TYPE ipcam_camera_decode_health_percent gauge');
        lines.push('# HELP ipcam_camera_ws_output_kbps Output websocket bitrate in kbps');
        lines.push('# TYPE ipcam_camera_ws_output_kbps gauge');
        lines.push('# HELP ipcam_camera_ws_clients Current websocket clients');
        lines.push('# TYPE ipcam_camera_ws_clients gauge');
        lines.push('# HELP ipcam_camera_ws_restarts_total Stream restarts total');
        lines.push('# TYPE ipcam_camera_ws_restarts_total gauge');
        lines.push('# HELP ipcam_camera_ws_stalls_total Stream stalls total');
        lines.push('# TYPE ipcam_camera_ws_stalls_total gauge');
        lines.push('# HELP ipcam_camera_keepalive_desired Camera keepalive desired state (1/0)');
        lines.push('# TYPE ipcam_camera_keepalive_desired gauge');
        lines.push('# HELP ipcam_camera_keepalive_active Camera keepalive active state (1/0)');
        lines.push('# TYPE ipcam_camera_keepalive_active gauge');
        lines.push('# HELP ipcam_camera_keepalive_restarts_total Camera keepalive restarts total');
        lines.push('# TYPE ipcam_camera_keepalive_restarts_total gauge');
        lines.push('# HELP ipcam_camera_keepalive_last_byte_seconds Camera keepalive last byte epoch timestamp');
        lines.push('# TYPE ipcam_camera_keepalive_last_byte_seconds gauge');
        lines.push('# HELP ipcam_camera_motion_active Camera motion active (1/0)');
        lines.push('# TYPE ipcam_camera_motion_active gauge');
        lines.push('# HELP ipcam_camera_last_check_seconds Camera probe check epoch timestamp');
        lines.push('# TYPE ipcam_camera_last_check_seconds gauge');
        lines.push('# HELP ipcam_camera_selected_source_index Selected source index currently used by aggregate camera health');
        lines.push('# TYPE ipcam_camera_selected_source_index gauge');
        lines.push('# HELP ipcam_camera_availability_score Camera availability score (0 down, 1 degraded, 2 up)');
        lines.push('# TYPE ipcam_camera_availability_score gauge');
        lines.push('# HELP ipcam_camera_degraded Camera is degraded (1/0)');
        lines.push('# TYPE ipcam_camera_degraded gauge');

        lines.push('# HELP ipcam_camera_source_up Source-channel connectivity status (1 up, 0 down)');
        lines.push('# TYPE ipcam_camera_source_up gauge');
        lines.push('# HELP ipcam_camera_source_availability_score Source-channel availability score (0 down, 1 degraded, 2 up)');
        lines.push('# TYPE ipcam_camera_source_availability_score gauge');
        lines.push('# HELP ipcam_camera_source_degraded Source-channel degraded state (1/0)');
        lines.push('# TYPE ipcam_camera_source_degraded gauge');
        lines.push('# HELP ipcam_camera_source_latency_ms First valid frame latency in milliseconds per source channel');
        lines.push('# TYPE ipcam_camera_source_latency_ms gauge');
        lines.push('# HELP ipcam_camera_source_input_kbps Estimated input bitrate in kbps per source channel');
        lines.push('# TYPE ipcam_camera_source_input_kbps gauge');
        lines.push('# HELP ipcam_camera_source_decode_health_percent Decode health score percent per source channel');
        lines.push('# TYPE ipcam_camera_source_decode_health_percent gauge');
        lines.push('# HELP ipcam_camera_source_fps Frames per second per source channel');
        lines.push('# TYPE ipcam_camera_source_fps gauge');
        lines.push('# HELP ipcam_camera_source_width_px Source channel frame width in pixels');
        lines.push('# TYPE ipcam_camera_source_width_px gauge');
        lines.push('# HELP ipcam_camera_source_height_px Source channel frame height in pixels');
        lines.push('# TYPE ipcam_camera_source_height_px gauge');
        lines.push('# HELP ipcam_camera_source_last_check_seconds Source channel probe check epoch timestamp');
        lines.push('# TYPE ipcam_camera_source_last_check_seconds gauge');
        lines.push('# HELP ipcam_camera_source_info Source channel static info as labels (value always 1)');
        lines.push('# TYPE ipcam_camera_source_info gauge');

        const cameras = snapshot?.cameras || [];
        cameras.forEach((camera) => {
            const last = camera?.last || {};
            const labels = {
                camera_id: camera?.id,
                camera_name: camera?.name,
                camera_type: camera?.type,
                transport: last?.transport || 'unknown'
            };

            lines.push(metricLine('ipcam_camera_up', labels, last?.up ? 1 : 0));
            lines.push(metricLine('ipcam_camera_latency_ms', labels, Number.isFinite(toNumOrNaN(last?.latencyMs)) ? toNumOrNaN(last?.latencyMs) : 'NaN'));
            lines.push(metricLine('ipcam_camera_input_kbps', labels, Number.isFinite(toNumOrNaN(last?.inputKbps)) ? toNumOrNaN(last?.inputKbps) : 'NaN'));
            lines.push(metricLine('ipcam_camera_decode_health_percent', labels, Number.isFinite(toNumOrNaN(last?.decodeHealth)) ? toNumOrNaN(last?.decodeHealth) : 'NaN'));
            lines.push(metricLine('ipcam_camera_ws_output_kbps', labels, Number.isFinite(toNumOrNaN(last?.ws?.outputKbps)) ? toNumOrNaN(last?.ws?.outputKbps) : 0));
            lines.push(metricLine('ipcam_camera_ws_clients', labels, Number.isFinite(toNumOrNaN(last?.ws?.clients)) ? toNumOrNaN(last?.ws?.clients) : 0));
            lines.push(metricLine('ipcam_camera_ws_restarts_total', labels, Number.isFinite(toNumOrNaN(last?.ws?.restarts)) ? toNumOrNaN(last?.ws?.restarts) : 0));
            lines.push(metricLine('ipcam_camera_ws_stalls_total', labels, Number.isFinite(toNumOrNaN(last?.ws?.stalls)) ? toNumOrNaN(last?.ws?.stalls) : 0));
            lines.push(metricLine('ipcam_camera_keepalive_desired', labels, last?.ws?.keepalive?.desired ? 1 : 0));
            lines.push(metricLine('ipcam_camera_keepalive_active', labels, last?.ws?.keepalive?.active ? 1 : 0));
            lines.push(metricLine('ipcam_camera_keepalive_restarts_total', labels, Number.isFinite(toNumOrNaN(last?.ws?.keepalive?.restarts)) ? toNumOrNaN(last?.ws?.keepalive?.restarts) : 0));
            lines.push(metricLine('ipcam_camera_keepalive_last_byte_seconds', labels, last?.ws?.keepalive?.lastByteAt ? (last.ws.keepalive.lastByteAt / 1000).toFixed(3) : 'NaN'));
            lines.push(metricLine('ipcam_camera_motion_active', labels, last?.motion?.active ? 1 : 0));
            lines.push(metricLine('ipcam_camera_last_check_seconds', labels, last?.checkedAt ? (last.checkedAt / 1000).toFixed(3) : 'NaN'));
            lines.push(metricLine('ipcam_camera_selected_source_index', labels, Number.isFinite(toNumOrNaN(last?.selectedSourceIndex)) ? toNumOrNaN(last?.selectedSourceIndex) : 'NaN'));
            lines.push(metricLine('ipcam_camera_availability_score', labels, Number.isFinite(toNumOrNaN(last?.availabilityScore)) ? toNumOrNaN(last?.availabilityScore) : (last?.up ? 2 : 0)));
            lines.push(metricLine('ipcam_camera_degraded', labels, last?.availability === 'degraded' ? 1 : 0));

            const sources = Array.isArray(camera?.sources) ? camera.sources : [];
            sources.forEach((source) => {
                const sourceLast = source?.last || {};
                const sourceLabels = {
                    camera_id: camera?.id,
                    camera_name: camera?.name,
                    camera_type: camera?.type,
                    source_id: source?.id,
                    source_index: source?.index,
                    source_name: source?.name,
                    transport: sourceLast?.transport || 'unknown'
                };

                lines.push(metricLine('ipcam_camera_source_up', sourceLabels, sourceLast?.up ? 1 : 0));
                lines.push(metricLine('ipcam_camera_source_availability_score', sourceLabels, Number.isFinite(toNumOrNaN(sourceLast?.availabilityScore)) ? toNumOrNaN(sourceLast?.availabilityScore) : (sourceLast?.up ? 2 : 0)));
                lines.push(metricLine('ipcam_camera_source_degraded', sourceLabels, sourceLast?.availability === 'degraded' ? 1 : 0));
                lines.push(metricLine('ipcam_camera_source_latency_ms', sourceLabels, Number.isFinite(toNumOrNaN(sourceLast?.latencyMs)) ? toNumOrNaN(sourceLast?.latencyMs) : 'NaN'));
                lines.push(metricLine('ipcam_camera_source_input_kbps', sourceLabels, Number.isFinite(toNumOrNaN(sourceLast?.inputKbps)) ? toNumOrNaN(sourceLast?.inputKbps) : 'NaN'));
                lines.push(metricLine('ipcam_camera_source_decode_health_percent', sourceLabels, Number.isFinite(toNumOrNaN(sourceLast?.decodeHealth)) ? toNumOrNaN(sourceLast?.decodeHealth) : 'NaN'));
                lines.push(metricLine('ipcam_camera_source_fps', sourceLabels, Number.isFinite(toNumOrNaN(sourceLast?.fps)) ? toNumOrNaN(sourceLast?.fps) : 'NaN'));
                lines.push(metricLine('ipcam_camera_source_width_px', sourceLabels, Number.isFinite(toNumOrNaN(sourceLast?.width)) ? toNumOrNaN(sourceLast?.width) : 'NaN'));
                lines.push(metricLine('ipcam_camera_source_height_px', sourceLabels, Number.isFinite(toNumOrNaN(sourceLast?.height)) ? toNumOrNaN(sourceLast?.height) : 'NaN'));
                lines.push(metricLine('ipcam_camera_source_last_check_seconds', sourceLabels, sourceLast?.checkedAt ? (sourceLast.checkedAt / 1000).toFixed(3) : 'NaN'));
                lines.push(metricLine('ipcam_camera_source_info', {
                    ...sourceLabels,
                    codec: sourceLast?.codec || 'unknown',
                    source_url: source?.sourceUrl || 'unknown'
                }, 1));
            });
        });

        return lines;
    }

    renderPrometheusMetrics() {
        const snapshot = this.getConnectivitySnapshot();
        const lines = this.buildPrometheusLines(snapshot);
        return `${lines.join('\n')}\n`;
    }

    renderPrometheusError(error) {
        return `# metrics_error ${escapePrometheusLabel(error?.message || String(error))}\n`;
    }
}

module.exports = {
    ConnectivityMonitoringService,
    monitoringServiceError
};

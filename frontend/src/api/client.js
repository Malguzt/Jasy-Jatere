/**
 * @typedef {Object} ApiError
 * @property {string} message
 * @property {number} status
 * @property {unknown} [details]
 */

/**
 * @template T
 * @param {string} path
 * @param {RequestInit} [init]
 * @returns {Promise<T>}
 */
async function apiFetch(path, init = {}) {
    const res = await fetch(path, init);
    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const payload = isJson ? await res.json() : null;
    if (!res.ok) {
        /** @type {ApiError} */
        const err = {
            message: payload?.error || payload?.message || `Request failed (${res.status})`,
            status: res.status,
            details: payload?.details
        };
        throw err;
    }
    return /** @type {T} */ (payload);
}

export const apiClient = {
    discoverCameras() {
        return apiFetch('/api/cameras/discover');
    },
    connectCamera(payload) {
        return apiFetch('/api/cameras/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {})
        });
    },
    listSavedCameras() {
        return apiFetch('/api/saved-cameras');
    },
    createSavedCamera(payload) {
        return apiFetch('/api/saved-cameras', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {})
        });
    },
    deleteSavedCamera(cameraId) {
        return apiFetch(`/api/saved-cameras/${encodeURIComponent(String(cameraId || ''))}`, {
            method: 'DELETE'
        });
    },
    patchSavedCamera(cameraId, payload) {
        return apiFetch(`/api/saved-cameras/${encodeURIComponent(String(cameraId || ''))}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {})
        });
    },
    getDetectorStatus() {
        return apiFetch('/api/detector/status');
    },
    getStreamCapabilities() {
        return apiFetch('/api/streams/capabilities');
    },
    listRecordings(query = {}) {
        const params = new URLSearchParams();
        Object.entries(query || {}).forEach(([key, value]) => {
            if (value === undefined || value === null || value === '') return;
            params.set(key, String(value));
        });
        const suffix = params.toString() ? `?${params.toString()}` : '';
        return apiFetch(`/api/recordings${suffix}`);
    },
    deleteRecording(filename) {
        return apiFetch(`/api/recordings/${encodeURIComponent(String(filename || ''))}`, {
            method: 'DELETE'
        });
    },
    getConnectivitySnapshot() {
        return apiFetch('/api/monitoring/connectivity');
    },
    forceConnectivityProbe() {
        return apiFetch('/api/monitoring/probe', { method: 'POST' });
    },
    movePtz(payload) {
        return apiFetch('/api/cameras/ptz/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {})
        });
    },
    stopPtz(payload) {
        return apiFetch('/api/cameras/ptz/stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {})
        });
    },
    toggleCameraLight(payload) {
        return apiFetch('/api/cameras/light/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {})
        });
    },
    async takeCameraSnapshot(payload) {
        const res = await fetch('/api/cameras/snapshot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {})
        });
        if (!res.ok) {
            throw {
                message: `Snapshot failed (${res.status})`,
                status: res.status
            };
        }
        return res.blob();
    },
    getLatestMap() {
        return apiFetch('/api/maps/latest');
    },
    getMapHistory() {
        return apiFetch('/api/maps/history');
    },
    createMapJob(payload) {
        return apiFetch('/api/maps/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {})
        });
    },
    getMapJob(jobId) {
        return apiFetch(`/api/maps/jobs/${encodeURIComponent(String(jobId || ''))}`);
    },
    retryMapJob(jobId, payload) {
        return apiFetch(`/api/maps/jobs/${encodeURIComponent(String(jobId || ''))}/retry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {})
        });
    },
    cancelMapJob(jobId) {
        return apiFetch(`/api/maps/jobs/${encodeURIComponent(String(jobId || ''))}/cancel`, {
            method: 'POST'
        });
    },
    promoteMap(mapId) {
        return apiFetch(`/api/maps/${encodeURIComponent(String(mapId || ''))}/promote`, {
            method: 'POST'
        });
    },
    saveManualMap(payload) {
        return apiFetch('/api/maps/manual', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {})
        });
    }
};

export { apiFetch };

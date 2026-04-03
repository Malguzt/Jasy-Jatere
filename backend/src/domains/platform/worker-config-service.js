const { resolveCameraStreamUrls, deriveCompanionRtsp, parseResolutionHint } = require('../../../rtsp-utils');

function workerConfigError(status, message, code = null, details = null) {
    const error = new Error(message || 'Worker config error');
    error.status = status;
    if (code) error.code = code;
    if (details !== null && details !== undefined) error.details = details;
    return error;
}

function asPositiveNumber(value, fallback) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return fallback;
}

function asPositiveInt(value, fallback) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
    return fallback;
}

function asOptionalPositiveInt(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
    return null;
}

class WorkerConfigService {
    constructor({
        cameraInventoryService,
        streamSyncOrchestrator,
        streamControlProxyService,
        runtimeFlags = {},
        now = () => Date.now()
    } = {}) {
        this.cameraInventoryService = cameraInventoryService;
        this.streamSyncOrchestrator = streamSyncOrchestrator;
        this.streamControlProxyService = streamControlProxyService;
        this.runtimeFlags = runtimeFlags || {};
        this.now = now;
    }

    selectReconstructorPair(camera) {
        const { rtspUrl, allRtspUrls } = resolveCameraStreamUrls(camera);
        const labels = Array.isArray(camera?.sourceLabels) ? camera.sourceLabels : [];
        const raw = [];

        if ((camera?.type || 'single') === 'combined' || rtspUrl === 'combined') {
            raw.push(...allRtspUrls);
            if (rtspUrl && rtspUrl !== 'combined') raw.push(rtspUrl);
        } else {
            if (rtspUrl && rtspUrl !== 'combined') raw.push(rtspUrl);
            raw.push(...allRtspUrls);
        }

        const seen = new Set();
        const candidates = [];
        raw.forEach((url, index) => {
            if (!url) return;
            let nextUrl = url;
            if (seen.has(nextUrl)) {
                const companion = deriveCompanionRtsp(nextUrl);
                if (companion && !seen.has(companion)) nextUrl = companion;
            }
            if (!nextUrl || seen.has(nextUrl)) return;
            seen.add(nextUrl);
            const resolution = parseResolutionHint(labels[index] || '');
            candidates.push({
                url: nextUrl,
                pixels: resolution?.pixels ?? null
            });
        });

        if (candidates.length === 0) return null;
        const withResolution = candidates.filter((candidate) => Number.isFinite(candidate.pixels));
        if (withResolution.length > 0) {
            const main = [...withResolution].sort((a, b) => b.pixels - a.pixels)[0];
            const sub = [...withResolution].sort((a, b) => a.pixels - b.pixels)[0];
            return { main: main.url, sub: sub.url };
        }

        const main = candidates[0].url;
        const sub = (candidates[1] && candidates[1].url) || deriveCompanionRtsp(main) || main;
        return { main, sub };
    }

    getCameraSnapshot() {
        if (!this.cameraInventoryService || typeof this.cameraInventoryService.listCameras !== 'function') {
            throw workerConfigError(500, 'Camera inventory service not configured', 'CAMERA_INVENTORY_NOT_CONFIGURED');
        }
        const cameras = this.cameraInventoryService.listCameras();
        return {
            snapshotAt: this.now(),
            cameraCount: cameras.length,
            cameras
        };
    }

    async getStreamSnapshot() {
        const cameraSnapshot = this.getCameraSnapshot();
        const streams = cameraSnapshot.cameras
            .map((camera) => {
                const urls = resolveCameraStreamUrls(camera);
                const pair = this.selectReconstructorPair(camera);
                return {
                    id: camera.id,
                    type: camera.type || 'single',
                    rtspUrl: urls.rtspUrl,
                    allRtspUrls: urls.allRtspUrls,
                    reconstructor: pair
                };
            })
            .filter((item) => !!item.id);

        let runtime =
            this.streamSyncOrchestrator && typeof this.streamSyncOrchestrator.getRuntimeState === 'function'
                ? this.streamSyncOrchestrator.getRuntimeState()
                : null;
        if (
            !runtime &&
            this.streamControlProxyService &&
            typeof this.streamControlProxyService.getRuntimeSnapshot === 'function'
        ) {
            try {
                runtime = await this.streamControlProxyService.getRuntimeSnapshot();
            } catch (error) {
                runtime = null;
            }
        }

        return {
            snapshotAt: this.now(),
            streamCount: streams.length,
            streams,
            runtime
        };
    }

    getRetentionSnapshot() {
        const recordingCatalog = {
            enabled: Boolean(this.runtimeFlags.recordingRetentionEnabled),
            intervalMs: asPositiveInt(this.runtimeFlags.recordingRetentionIntervalMs, 60 * 60 * 1000),
            maxAgeDays: asOptionalPositiveInt(this.runtimeFlags.recordingRetentionMaxAgeDays),
            maxEntries: asOptionalPositiveInt(this.runtimeFlags.recordingRetentionMaxEntries)
        };
        const detectorRecycle = {
            recordingsMaxSizeGb: asPositiveNumber(this.runtimeFlags.recordingsMaxSizeGb, 50),
            deleteOldestBatch: asPositiveInt(this.runtimeFlags.recordingsDeleteOldestBatch, 100)
        };
        const observation = {
            maxEntries: asPositiveInt(this.runtimeFlags.observationMaxEntries, 2500)
        };

        return {
            snapshotAt: this.now(),
            retention: {
                ...detectorRecycle,
                observationMaxEntries: observation.maxEntries,
                recordingCatalog,
                detectorRecycle,
                observation
            }
        };
    }
}

module.exports = {
    WorkerConfigService,
    workerConfigError
};

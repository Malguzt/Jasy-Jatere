const { resolveCameraStreamUrls, deriveCompanionRtsp, parseResolutionHint } = require('../../../rtsp-utils');

function workerConfigError(status, message, code = null, details = null) {
    const error = new Error(message || 'Worker config error');
    error.status = status;
    if (code) error.code = code;
    if (details !== null && details !== undefined) error.details = details;
    return error;
}

class WorkerConfigService {
    constructor({
        cameraInventoryService,
        streamSyncOrchestrator,
        now = () => Date.now()
    } = {}) {
        this.cameraInventoryService = cameraInventoryService;
        this.streamSyncOrchestrator = streamSyncOrchestrator;
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

    getStreamSnapshot() {
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

        const runtime =
            this.streamSyncOrchestrator && typeof this.streamSyncOrchestrator.getRuntimeState === 'function'
                ? this.streamSyncOrchestrator.getRuntimeState()
                : null;

        return {
            snapshotAt: this.now(),
            streamCount: streams.length,
            streams,
            runtime
        };
    }

    getRetentionSnapshot() {
        return {
            snapshotAt: this.now(),
            retention: {
                recordingsMaxSizeGb: Number(process.env.RECORDINGS_MAX_SIZE_GB || 50),
                deleteOldestBatch: Number(process.env.RECORDINGS_DELETE_OLDEST_BATCH || 100),
                observationMaxEntries: Number(process.env.OBSERVATION_MAX_ENTRIES || 2500)
            }
        };
    }
}

module.exports = {
    WorkerConfigService,
    workerConfigError
};

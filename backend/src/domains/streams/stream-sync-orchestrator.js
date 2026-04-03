const { loadCameraInventory } = require('../cameras/camera-inventory-loader');

function toPositiveInt(value, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return fallback;
    return Math.floor(num);
}

class StreamSyncOrchestrator {
    constructor({
        cameraInventoryService,
        streamManager,
        resolveCameraStreamUrls,
        deriveCompanionRtsp,
        parseResolutionHint,
        fetchImpl = fetch,
        logger = console,
        reconstructorUrl = 'http://localhost:5001',
        syncIntervalMs = 10000,
        initialDelayMs = 1500,
        setTimeoutFn = setTimeout,
        setIntervalFn = setInterval,
        clearTimeoutFn = clearTimeout,
        clearIntervalFn = clearInterval
    } = {}) {
        this.cameraInventoryService = cameraInventoryService;
        this.streamManager = streamManager;
        this.resolveCameraStreamUrls = resolveCameraStreamUrls;
        this.deriveCompanionRtsp = deriveCompanionRtsp;
        this.parseResolutionHint = parseResolutionHint;
        this.fetch = fetchImpl;
        this.logger = logger;
        this.reconstructorUrl = String(reconstructorUrl || 'http://localhost:5001').replace(/\/$/, '');
        this.syncIntervalMs = toPositiveInt(syncIntervalMs, 10000);
        this.initialDelayMs = toPositiveInt(initialDelayMs, 1500);
        this.setTimeoutFn = setTimeoutFn;
        this.setIntervalFn = setIntervalFn;
        this.clearTimeoutFn = clearTimeoutFn;
        this.clearIntervalFn = clearIntervalFn;
        this.initialTimer = null;
        this.periodicTimer = null;
        this.lastSyncAt = null;
        this.lastSyncResult = null;
    }

    selectReconstructorPair(camera) {
        const { rtspUrl, allRtspUrls } = this.resolveCameraStreamUrls(camera);
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
                const companion = this.deriveCompanionRtsp(nextUrl);
                if (companion && !seen.has(companion)) nextUrl = companion;
            }
            if (!nextUrl || seen.has(nextUrl)) return;
            seen.add(nextUrl);
            const res = this.parseResolutionHint(labels[index] || '');
            candidates.push({
                url: nextUrl,
                index,
                pixels: res?.pixels ?? null
            });
        });

        if (candidates.length === 0) return null;

        const withResolution = candidates.filter((candidate) => Number.isFinite(candidate.pixels));
        if (withResolution.length > 0) {
            const main = [...withResolution].sort((a, b) => b.pixels - a.pixels)[0];
            const sub = [...withResolution].sort((a, b) => a.pixels - b.pixels)[0];
            return { id: camera.id, main: main.url, sub: sub.url };
        }

        const main = candidates[0].url;
        const sub = (candidates[1] && candidates[1].url) || this.deriveCompanionRtsp(main) || main;
        return { id: camera.id, main, sub };
    }

    loadSavedCamerasSafe() {
        return loadCameraInventory({
            cameraInventoryService: this.cameraInventoryService,
            logger: this.logger,
            serviceErrorPrefix: '[KEEPALIVE] Error leyendo inventory service:'
        });
    }

    buildKeepaliveConfigs(cameras = []) {
        return cameras.map((camera) => {
            const urls = this.resolveCameraStreamUrls(camera);
            return {
                id: camera.id,
                type: camera.type || 'single',
                rtspUrl: urls.rtspUrl,
                allRtspUrls: urls.allRtspUrls
            };
        });
    }

    buildReconstructorStreams(cameras = []) {
        return cameras
            .map((camera) => this.selectReconstructorPair(camera))
            .filter((value) => !!value && !!value.id && !!value.main && !!value.sub);
    }

    async syncNow() {
        try {
            const cameras = this.loadSavedCamerasSafe();
            const configs = this.buildKeepaliveConfigs(cameras);
            this.streamManager.syncKeepaliveConfigs(configs);

            const reconStreams = this.buildReconstructorStreams(cameras);
            try {
                await this.fetch(`${this.reconstructorUrl}/configure`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ streams: reconStreams, prune: true })
                });
            } catch (reconError) {
                this.logger.error(
                    '[RECON-SYNC] Error sincronizando sesiones de reconstructor:',
                    reconError?.message || reconError
                );
            }

            const result = {
                success: true,
                cameraCount: cameras.length,
                keepaliveCount: configs.length,
                reconstructorStreamCount: reconStreams.length
            };
            this.lastSyncAt = Date.now();
            this.lastSyncResult = result;
            return result;
        } catch (error) {
            this.logger.error('[KEEPALIVE] Sync error:', error?.message || error);
            const result = {
                success: false,
                error: error?.message || String(error)
            };
            this.lastSyncAt = Date.now();
            this.lastSyncResult = result;
            return result;
        }
    }

    start() {
        this.stop();
        this.initialTimer = this.setTimeoutFn(() => {
            this.syncNow().catch((error) => {
                this.logger.error('[SYNC] Initial sync error:', error?.message || error);
            });
        }, this.initialDelayMs);

        const periodicDelay = Math.max(3000, this.syncIntervalMs);
        this.periodicTimer = this.setIntervalFn(() => {
            this.syncNow().catch((error) => {
                this.logger.error('[SYNC] Periodic sync error:', error?.message || error);
            });
        }, periodicDelay);
    }

    stop() {
        if (this.initialTimer) {
            this.clearTimeoutFn(this.initialTimer);
            this.initialTimer = null;
        }
        if (this.periodicTimer) {
            this.clearIntervalFn(this.periodicTimer);
            this.periodicTimer = null;
        }
    }

    getRuntimeState() {
        return {
            hasInitialTimer: !!this.initialTimer,
            hasPeriodicTimer: !!this.periodicTimer,
            syncIntervalMs: Math.max(3000, this.syncIntervalMs),
            initialDelayMs: this.initialDelayMs,
            lastSyncAt: this.lastSyncAt,
            lastSyncResult: this.lastSyncResult
        };
    }
}

module.exports = {
    StreamSyncOrchestrator
};

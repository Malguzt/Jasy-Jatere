const path = require('path');
const { spawn } = require('child_process');
const { withCameraAuth, deriveCompanionRtsp } = require('./rtsp-utils');
const { loadCameraInventory } = require('./src/domains/cameras/camera-inventory-loader');

const DEFAULT_INTERVAL_MS = Number(process.env.CAMERA_MONITOR_INTERVAL_MS || 20000);
const DEFAULT_HISTORY_SIZE = Number(process.env.CAMERA_MONITOR_HISTORY_SIZE || 180);
const FIRST_FRAME_TIMEOUT_MS = Number(process.env.CAMERA_MONITOR_FIRST_FRAME_TIMEOUT_MS || 5000);
const BITRATE_TIMEOUT_MS = Number(process.env.CAMERA_MONITOR_BITRATE_TIMEOUT_MS || 5500);
const FFPROBE_TIMEOUT_MS = Number(process.env.CAMERA_MONITOR_FFPROBE_TIMEOUT_MS || 4500);

function safeNow() {
    return Date.now();
}

function toMs(start) {
    return Math.max(0, safeNow() - start);
}

function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
}

function maskRtspUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    return rawUrl.replace(/rtsp:\/\/([^@]+)@/i, 'rtsp://***:***@');
}

function parseAvgFrameRate(v) {
    if (!v || typeof v !== 'string') return null;
    if (!v.includes('/')) {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }
    const [a, b] = v.split('/');
    const num = Number(a);
    const den = Number(b);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
    return num / den;
}

function parseErrorSummary(stderr = '') {
    const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const relevant = lines.filter((l) => /(error|invalid|corrupt|fail|timed out|unauthorized|refused|nonmatching transport|no frame)/i.test(l));
    return {
        errorCount: relevant.length,
        firstError: relevant[0] || null
    };
}

class CameraConnectivityMonitor {
    constructor({
        cameraFile,
        streamManager,
        cameraEventMonitor,
        cameraInventoryService = null,
        legacyFileFallbackEnabled = (process.env.LEGACY_COMPAT_EXPORTS_ENABLED === '1')
    }) {
        this.cameraFile = cameraFile || path.join(__dirname, 'data', 'cameras.json');
        this.streamManager = streamManager;
        this.cameraEventMonitor = cameraEventMonitor;
        this.cameraInventoryService = cameraInventoryService;
        this.legacyFileFallbackEnabled = legacyFileFallbackEnabled === true;
        this.intervalMs = clamp(DEFAULT_INTERVAL_MS, 8000, 120000);
        this.historySize = clamp(DEFAULT_HISTORY_SIZE, 30, 720);
        this.timer = null;
        this.running = false;
        this.updatedAt = null;
        this.lastProbeDurationMs = null;
        this.cameraState = new Map(); // id -> { camera, last, history[] }
        this.wsLastSample = new Map(); // id -> { bytes, ts }
        this.sourceTransportPreference = new Map(); // cameraId::sourceId -> 'tcp' | 'udp'
    }

    start() {
        if (this.timer) return;
        this.runProbeCycle().catch(() => {});
        this.timer = setInterval(() => {
            this.runProbeCycle().catch((e) => {
                console.error('[MON] probe cycle error:', e?.message || e);
            });
        }, this.intervalMs);
        console.log(`[MON] Camera connectivity monitor started (interval=${this.intervalMs}ms)`);
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    loadCameras() {
        return loadCameraInventory({
            cameraInventoryService: this.cameraInventoryService,
            legacyFilePath: this.cameraFile,
            legacyFileFallbackEnabled: this.legacyFileFallbackEnabled,
            logger: console,
            serviceErrorPrefix: '[MON] failed to load cameras from inventory service:',
            fileErrorPrefix: '[MON] failed to load cameras:'
        });
    }

    getProbeSources(camera) {
        const labelHints = Array.isArray(camera?.sourceLabels) ? camera.sourceLabels : [];
        const sources = [];
        const seen = new Set();

        const pushSource = (rawUrl, index) => {
            let authUrl = withCameraAuth(rawUrl, camera);
            if (!authUrl) return;
            if (seen.has(authUrl)) {
                const companion = deriveCompanionRtsp(authUrl);
                if (companion) authUrl = companion;
            }
            if (!authUrl || seen.has(authUrl)) return;
            seen.add(authUrl);
            const label = (typeof labelHints[index] === 'string' && labelHints[index].trim())
                ? labelHints[index].trim()
                : `Canal ${index + 1}`;
            sources.push({
                id: `src${index}`,
                index,
                name: label,
                url: authUrl
            });
        };

        if (camera.type === 'combined') {
            const all = Array.isArray(camera.allRtspUrls) ? camera.allRtspUrls : [];
            if (all.length > 0) {
                all.forEach((u, idx) => pushSource(u, idx));
            } else if (camera.rtspUrl && camera.rtspUrl !== 'combined') {
                pushSource(camera.rtspUrl, 0);
            }
        } else if (camera.rtspUrl && camera.rtspUrl !== 'combined') {
            pushSource(camera.rtspUrl, 0);
        }

        return sources;
    }

    selectBestSourceProbe(sourceResults = []) {
        if (!sourceResults.length) return null;
        return [...sourceResults].sort((a, b) => {
            const aAvail = Number.isFinite(Number(a?.probe?.availabilityScore)) ? Number(a.probe.availabilityScore) : (a?.probe?.up ? 1 : 0);
            const bAvail = Number.isFinite(Number(b?.probe?.availabilityScore)) ? Number(b.probe.availabilityScore) : (b?.probe?.up ? 1 : 0);
            if (aAvail !== bAvail) return bAvail - aAvail;

            const aLatency = Number.isFinite(Number(a?.probe?.latencyMs)) ? Number(a.probe.latencyMs) : Number.POSITIVE_INFINITY;
            const bLatency = Number.isFinite(Number(b?.probe?.latencyMs)) ? Number(b.probe.latencyMs) : Number.POSITIVE_INFINITY;
            if (aLatency !== bLatency) return aLatency - bLatency;

            const aDecode = Number.isFinite(Number(a?.probe?.decodeHealth)) ? Number(a.probe.decodeHealth) : -1;
            const bDecode = Number.isFinite(Number(b?.probe?.decodeHealth)) ? Number(b.probe.decodeHealth) : -1;
            if (aDecode !== bDecode) return bDecode - aDecode;

            const aInput = Number.isFinite(Number(a?.probe?.inputKbps)) ? Number(a.probe.inputKbps) : -1;
            const bInput = Number.isFinite(Number(b?.probe?.inputKbps)) ? Number(b.probe.inputKbps) : -1;
            if (aInput !== bInput) return bInput - aInput;

            return (a?.source?.index ?? 999) - (b?.source?.index ?? 999);
        })[0] || null;
    }

    async runProbeCycle() {
        if (this.running) return;
        this.running = true;
        const cycleStart = safeNow();
        try {
            const cameras = this.loadCameras();
            const streamStats = this.streamManager?.getStatsSnapshot ? this.streamManager.getStatsSnapshot() : {};

            const activeIds = new Set(cameras.map((c) => c.id));
            [...this.cameraState.keys()].forEach((id) => {
                if (!activeIds.has(id)) this.cameraState.delete(id);
            });

            const tasks = cameras.map(async (camera) => {
                try {
                    const state = this.cameraState.get(camera.id) || { camera, last: null, history: [], sourceMap: new Map() };
                    state.camera = camera;
                    if (!(state.sourceMap instanceof Map)) state.sourceMap = new Map();

                    const sources = this.getProbeSources(camera);
                    const wsStats = streamStats[camera.id] || null;
                    const keepaliveStats = wsStats?.keepalive || {};
                    const wsKbps = this.computeWsKbps(camera.id, wsStats?.bytesOutTotal || 0);
                    const motion = this.cameraEventMonitor?.getMotion ? this.cameraEventMonitor.getMotion(camera.id) : {};
                    const activeSourceIds = new Set(sources.map((s) => s.id));
                    [...state.sourceMap.keys()].forEach((sourceId) => {
                        if (!activeSourceIds.has(sourceId)) state.sourceMap.delete(sourceId);
                    });

                    const sourceResults = [];
                    for (const source of sources) {
                        const sourceState = state.sourceMap.get(source.id) || {
                            id: source.id,
                            index: source.index,
                            name: source.name,
                            sourceUrl: maskRtspUrl(source.url),
                            last: null,
                            history: []
                        };

                        const probe = await this.probeSource(source, camera.id);
                        const sourcePoint = {
                            ts: safeNow(),
                            up: probe.up ? 1 : 0,
                            latencyMs: probe.latencyMs ?? null,
                            inputKbps: probe.inputKbps ?? null,
                            decodeHealth: probe.decodeHealth ?? 0
                        };

                        sourceState.id = source.id;
                        sourceState.index = source.index;
                        sourceState.name = source.name;
                        sourceState.sourceUrl = maskRtspUrl(source.url);
                        sourceState.last = {
                            ...probe,
                            sourceId: source.id,
                            sourceIndex: source.index,
                            sourceName: source.name,
                            sourceUrl: maskRtspUrl(source.url),
                            checkedAt: sourcePoint.ts
                        };
                        sourceState.history.push(sourcePoint);
                        if (sourceState.history.length > this.historySize) sourceState.history.shift();

                        state.sourceMap.set(source.id, sourceState);
                        sourceResults.push({ source, probe, sourceState });
                    }

                    const best = this.selectBestSourceProbe(sourceResults);
                    const probe = best ? {
                        ...best.probe,
                        sourceId: best.source.id,
                        sourceIndex: best.source.index,
                        sourceName: best.source.name,
                        sourceUrl: best.source.url
                    } : {
                        up: false,
                        availability: 'down',
                        availabilityScore: 0,
                        reason: 'No RTSP URL configured',
                        transport: null,
                        latencyMs: null,
                        inputKbps: null,
                        decodeHealth: 0,
                        codec: null,
                        width: null,
                        height: null,
                        fps: null,
                        sourceId: null,
                        sourceIndex: null,
                        sourceName: null,
                        sourceUrl: null
                    };
                    if (!probe.up && keepaliveStats?.active) {
                        probe.up = true;
                        probe.availability = 'degraded';
                        probe.availabilityScore = 1;
                        probe.reason = probe.reason
                            ? `${probe.reason} (keepalive activo)`
                            : 'Keepalive activo; sonda puntual sin frame válido';
                    }

                    const sourcesUp = sourceResults.filter((r) => r?.probe?.up).length;
                    const sourcesDegraded = sourceResults.filter((r) => r?.probe?.availability === 'degraded').length;

                    const point = {
                        ts: safeNow(),
                        up: probe.up ? 1 : 0,
                        availability: probe.availability || (probe.up ? 'up' : 'down'),
                        availabilityScore: Number.isFinite(Number(probe.availabilityScore)) ? Number(probe.availabilityScore) : (probe.up ? 2 : 0),
                        latencyMs: probe.latencyMs ?? null,
                        inputKbps: probe.inputKbps ?? null,
                        decodeHealth: probe.decodeHealth ?? 0,
                        sourceCount: sources.length,
                        sourcesUp,
                        sourcesDegraded,
                        selectedSourceIndex: probe.sourceIndex ?? null,
                        wsKbps: wsKbps ?? 0,
                        wsClients: wsStats?.clients || 0,
                        wsRestarts: wsStats?.restarts || 0,
                        wsStalls: wsStats?.stalls || 0,
                        keepaliveActive: keepaliveStats?.active ? 1 : 0,
                        motion: motion?.motion ? 1 : 0
                    };

                    state.last = {
                        ...probe,
                        checkedAt: point.ts,
                        sourceCount: sources.length,
                        sourcesUp,
                        sourcesDegraded,
                        selectedSourceId: probe.sourceId ?? null,
                        selectedSourceIndex: probe.sourceIndex ?? null,
                        selectedSourceName: probe.sourceName ?? null,
                        ws: {
                            active: !!wsStats?.active,
                            clients: wsStats?.clients || 0,
                            bytesOutTotal: wsStats?.bytesOutTotal || 0,
                            outputKbps: wsKbps ?? 0,
                            restarts: wsStats?.restarts || 0,
                            stalls: wsStats?.stalls || 0,
                            lastByteAt: wsStats?.lastByteAt || null,
                            lastError: wsStats?.lastError || null,
                            keepalive: {
                                desired: !!keepaliveStats?.desired,
                                active: !!keepaliveStats?.active,
                                sourceUrl: maskRtspUrl(keepaliveStats?.sourceUrl || null),
                                startedAt: keepaliveStats?.startedAt || null,
                                lastByteAt: keepaliveStats?.lastByteAt || null,
                                bytesTotal: keepaliveStats?.bytesTotal || 0,
                                restarts: keepaliveStats?.restarts || 0,
                                lastError: keepaliveStats?.lastError || null
                            }
                        },
                        motion: {
                            source: motion?.source || 'unknown',
                            healthy: !!motion?.healthy,
                            active: !!motion?.motion,
                            updatedAt: motion?.updatedAt || null
                        },
                        sourceUrl: maskRtspUrl(probe.sourceUrl || null),
                        sources: sourceResults.map((entry) => ({
                            id: entry.source.id,
                            index: entry.source.index,
                            name: entry.source.name,
                            sourceUrl: maskRtspUrl(entry.source.url),
                            up: entry.probe.up ? 1 : 0,
                            availability: entry.probe.availability || (entry.probe.up ? 'up' : 'down'),
                            availabilityScore: Number.isFinite(Number(entry.probe.availabilityScore)) ? Number(entry.probe.availabilityScore) : (entry.probe.up ? 2 : 0),
                            transport: entry.probe.transport || null,
                            latencyMs: entry.probe.latencyMs ?? null,
                            inputKbps: entry.probe.inputKbps ?? null,
                            decodeHealth: entry.probe.decodeHealth ?? 0,
                            codec: entry.probe.codec || null,
                            width: entry.probe.width || null,
                            height: entry.probe.height || null,
                            fps: entry.probe.fps || null,
                            reason: entry.probe.reason || null,
                            checkedAt: entry.sourceState?.last?.checkedAt || null
                        }))
                    };

                    state.history.push(point);
                    if (state.history.length > this.historySize) state.history.shift();

                    this.cameraState.set(camera.id, state);
                } catch (camError) {
                    console.error(`[MON] camera probe error (${camera?.id}):`, camError?.message || camError);
                }
            });

            await Promise.all(tasks);

            this.updatedAt = safeNow();
            this.lastProbeDurationMs = toMs(cycleStart);
        } finally {
            this.running = false;
        }
    }

    computeWsKbps(cameraId, bytesTotal) {
        const now = safeNow();
        const prev = this.wsLastSample.get(cameraId);
        this.wsLastSample.set(cameraId, { bytes: bytesTotal, ts: now });
        if (!prev) return 0;
        const deltaBytes = Math.max(0, bytesTotal - prev.bytes);
        const deltaSec = Math.max(0.001, (now - prev.ts) / 1000);
        return Number(((deltaBytes * 8) / deltaSec / 1000).toFixed(2));
    }

    async probeSource(source, cameraId) {
        const preferenceKey = `${cameraId}::${source.id}`;
        const preferredTransport = this.sourceTransportPreference.get(preferenceKey) || 'tcp';
        const transportOrder = preferredTransport === 'udp' ? ['udp', 'tcp'] : ['tcp', 'udp'];
        let lastFailure = null;

        for (const transport of transportOrder) {
            const result = await this.probeSingleTransport(source.url, transport);
            if (result.up) {
                this.sourceTransportPreference.set(preferenceKey, transport);
                return {
                    ...result,
                    sourceId: source.id,
                    sourceIndex: source.index,
                    sourceName: source.name,
                    sourceUrl: source.url
                };
            }
            lastFailure = {
                ...result,
                sourceId: source.id,
                sourceIndex: source.index,
                sourceName: source.name,
                sourceUrl: source.url
            };
        }

        return lastFailure || {
            up: false,
            availability: 'down',
            availabilityScore: 0,
            reason: 'Probe failed',
            transport: null,
            latencyMs: null,
            inputKbps: null,
            decodeHealth: 0,
            codec: null,
            width: null,
            height: null,
            fps: null,
            sourceId: source.id,
            sourceIndex: source.index,
            sourceName: source.name,
            sourceUrl: source.url
        };
    }

    async probeSingleTransport(url, transport) {
        const frameProbe = await this.runFirstFrameProbe(url, transport);
        const bitrateProbe = await this.runBitrateProbe(url, transport);
        const streamInfo = await this.runFfprobe(url, transport);
        const hasSignal = !!streamInfo.ok || (Number(bitrateProbe?.bytes || 0) > 0);
        const availability = frameProbe.ok ? 'up' : (hasSignal ? 'degraded' : 'down');
        const availabilityScore = availability === 'up' ? 2 : (availability === 'degraded' ? 1 : 0);
        const up = availability !== 'down';
        const decodePenalty = (frameProbe.errorCount || 0) * 14;
        const bitratePenalty = (bitrateProbe.errorCount || 0) * 8;
        const baseHealth = frameProbe.ok ? 100 : (hasSignal ? 58 : 0);
        const decodeHealth = clamp(baseHealth - decodePenalty - bitratePenalty, 0, 100);

        return {
            up,
            availability,
            availabilityScore,
            transport,
            latencyMs: frameProbe.firstFrameMs ?? null,
            inputKbps: bitrateProbe.kbps ?? streamInfo.bitrateKbps ?? null,
            decodeHealth,
            codec: streamInfo.codec || null,
            width: streamInfo.width || null,
            height: streamInfo.height || null,
            fps: streamInfo.fps || null,
            reason: frameProbe.reason || bitrateProbe.reason || streamInfo.reason || null,
            probeDetails: {
                firstFrame: frameProbe,
                bitrate: bitrateProbe,
                streamInfo
            }
        };
    }

    runWithTimeout(command, args, timeoutMs, handlers = {}) {
        return new Promise((resolve) => {
            const startedAt = safeNow();
            const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
            let stdout = '';
            let stderr = '';
            let done = false;

            const finish = (result) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                resolve({
                    ...result,
                    elapsedMs: toMs(startedAt),
                    stdout,
                    stderr
                });
            };

            const timer = setTimeout(() => {
                try { child.kill('SIGKILL'); } catch (e) {}
                finish({ ok: false, code: null, timedOut: true });
            }, timeoutMs);

            child.stdout.on('data', (chunk) => {
                const text = chunk.toString();
                stdout += text;
                if (handlers.onStdout) handlers.onStdout(chunk, text, startedAt);
            });

            child.stderr.on('data', (chunk) => {
                const text = chunk.toString();
                stderr += text;
                if (handlers.onStderr) handlers.onStderr(chunk, text, startedAt);
            });

            child.on('error', (err) => finish({ ok: false, code: null, error: err?.message || String(err) }));
            child.on('close', (code) => finish({ ok: code === 0, code, timedOut: false }));
        });
    }

    async runFirstFrameProbe(url, transport) {
        const args = [
            '-hide_banner',
            '-loglevel', 'warning',
            '-rtsp_transport', transport,
            '-fflags', '+discardcorrupt',
            '-flags', 'low_delay',
            '-i', url,
            '-an',
            '-sn',
            '-dn',
            '-frames:v', '1',
            '-f', 'null',
            '-'
        ];
        const result = await this.runWithTimeout('ffmpeg', args, FIRST_FRAME_TIMEOUT_MS);
        const parsed = parseErrorSummary(result.stderr);
        return {
            ok: result.ok,
            timedOut: result.timedOut,
            firstFrameMs: result.ok ? result.elapsedMs : null,
            errorCount: parsed.errorCount,
            reason: result.ok ? null : (parsed.firstError || (result.timedOut ? 'first-frame timeout' : 'first-frame failed'))
        };
    }

    async runBitrateProbe(url, transport) {
        let bytes = 0;
        const args = [
            '-hide_banner',
            '-loglevel', 'warning',
            '-rtsp_transport', transport,
            '-i', url,
            '-an',
            '-sn',
            '-dn',
            '-t', '2.2',
            '-c', 'copy',
            '-f', 'mpegts',
            '-'
        ];
        const result = await this.runWithTimeout('ffmpeg', args, BITRATE_TIMEOUT_MS, {
            onStdout: (chunk) => { bytes += chunk.length; }
        });
        const elapsedSec = Math.max(0.001, result.elapsedMs / 1000);
        const kbps = bytes > 0 ? Number(((bytes * 8) / elapsedSec / 1000).toFixed(2)) : null;
        const parsed = parseErrorSummary(result.stderr);
        return {
            ok: result.ok || bytes > 0,
            kbps,
            bytes,
            timedOut: result.timedOut,
            errorCount: parsed.errorCount,
            reason: (result.ok || bytes > 0) ? null : (parsed.firstError || (result.timedOut ? 'bitrate timeout' : 'bitrate probe failed'))
        };
    }

    async runFfprobe(url, transport) {
        const args = [
            '-v', 'error',
            '-rtsp_transport', transport,
            '-select_streams', 'v:0',
            '-show_entries', 'stream=codec_name,width,height,avg_frame_rate,bit_rate',
            '-of', 'json',
            url
        ];
        const result = await this.runWithTimeout('ffprobe', args, FFPROBE_TIMEOUT_MS);
        if (!result.ok || !result.stdout) {
            const parsed = parseErrorSummary(result.stderr);
            return {
                ok: false,
                reason: parsed.firstError || (result.timedOut ? 'ffprobe timeout' : 'ffprobe failed'),
                bitrateKbps: null,
                codec: null,
                width: null,
                height: null,
                fps: null
            };
        }
        try {
            const data = JSON.parse(result.stdout);
            const stream = (data.streams || [])[0] || {};
            return {
                ok: true,
                bitrateKbps: stream.bit_rate ? Number((Number(stream.bit_rate) / 1000).toFixed(2)) : null,
                codec: stream.codec_name || null,
                width: stream.width || null,
                height: stream.height || null,
                fps: parseAvgFrameRate(stream.avg_frame_rate),
                reason: null
            };
        } catch (e) {
            return {
                ok: false,
                reason: `ffprobe parse error: ${e?.message || e}`,
                bitrateKbps: null,
                codec: null,
                width: null,
                height: null,
                fps: null
            };
        }
    }

    getSnapshot() {
        const cameras = [...this.cameraState.values()].map((entry) => ({
            id: entry.camera.id,
            name: entry.camera.name,
            type: entry.camera.type || 'single',
            last: entry.last,
            history: entry.history,
            sources: [...(entry.sourceMap instanceof Map ? entry.sourceMap.values() : [])]
                .sort((a, b) => (a?.index ?? 999) - (b?.index ?? 999))
        }));

        const online = cameras.filter((c) => c.last?.up).length;
        const degraded = cameras.filter((c) => c.last?.availability === 'degraded').length;
        const latencies = cameras.map((c) => c.last?.latencyMs).filter((v) => Number.isFinite(v));
        const bitrates = cameras.map((c) => c.last?.inputKbps).filter((v) => Number.isFinite(v));
        const decode = cameras.map((c) => c.last?.decodeHealth).filter((v) => Number.isFinite(v));
        const wsClients = cameras.reduce((acc, c) => acc + (c.last?.ws?.clients || 0), 0);
        const keepaliveDesired = cameras.filter((c) => c.last?.ws?.keepalive?.desired).length;
        const keepaliveActive = cameras.filter((c) => c.last?.ws?.keepalive?.active).length;
        const sources = cameras.flatMap((c) => c.sources || []);
        const sourceOnline = sources.filter((s) => s.last?.up).length;
        const sourceDegraded = sources.filter((s) => s.last?.availability === 'degraded').length;
        const sourceLatencies = sources.map((s) => s.last?.latencyMs).filter((v) => Number.isFinite(v));
        const sourceBitrates = sources.map((s) => s.last?.inputKbps).filter((v) => Number.isFinite(v));
        const sourceDecode = sources.map((s) => s.last?.decodeHealth).filter((v) => Number.isFinite(v));

        const avg = (arr) => arr.length ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2)) : null;

        return {
            success: true,
            updatedAt: this.updatedAt,
            running: this.running,
            intervalMs: this.intervalMs,
            lastProbeDurationMs: this.lastProbeDurationMs,
            summary: {
                cameras: cameras.length,
                online,
                offline: Math.max(0, cameras.length - online),
                degraded,
                avgLatencyMs: avg(latencies),
                avgInputKbps: avg(bitrates),
                avgDecodeHealth: avg(decode),
                wsClients,
                keepaliveDesired,
                keepaliveActive,
                sources: sources.length,
                sourcesOnline: sourceOnline,
                sourcesOffline: Math.max(0, sources.length - sourceOnline),
                sourcesDegraded: sourceDegraded,
                avgSourceLatencyMs: avg(sourceLatencies),
                avgSourceInputKbps: avg(sourceBitrates),
                avgSourceDecodeHealth: avg(sourceDecode)
            },
            cameras
        };
    }

    waitUntilIdle(timeoutMs = 12000) {
        const startedAt = safeNow();
        return new Promise((resolve) => {
            const tick = () => {
                if (!this.running) return resolve();
                if ((safeNow() - startedAt) >= timeoutMs) return resolve();
                setTimeout(tick, 150);
            };
            tick();
        });
    }

    async forceProbe() {
        if (this.running) {
            await this.waitUntilIdle();
        }
        await this.runProbeCycle();
        if (this.running) {
            await this.waitUntilIdle();
        }
        return this.getSnapshot();
    }
}

module.exports = CameraConnectivityMonitor;

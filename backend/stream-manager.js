const { spawn } = require('child_process');
const { deriveCompanionRtsp } = require('./rtsp-utils');

function parseBool(value, defaultValue = true) {
    if (value === undefined || value === null) return defaultValue;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return defaultValue;
}

class StreamManager {
    constructor() {
        this.streams = new Map(); // id -> { process, clients: Set<ws> }
        this.stopTimeouts = new Map(); // id -> timeout
        this.streamStats = new Map(); // id -> rolling stats
        this.keepaliveStreams = new Map(); // id -> { process, sourceUrl, ... }
        this.keepaliveDesired = new Map(); // id -> sourceUrl
        this.keepaliveRestartTimers = new Map(); // id -> timeout
        this.streamTransportPreference = new Map(); // id -> 'tcp' | 'udp'
        this.keepaliveEnabled = parseBool(process.env.CAMERA_KEEPALIVE_ENABLED, true);
        this.keepaliveSourceIndex = Number.isFinite(Number(process.env.CAMERA_KEEPALIVE_SOURCE_INDEX))
            ? Math.max(0, Number(process.env.CAMERA_KEEPALIVE_SOURCE_INDEX))
            : 1;
        this.keepaliveRestartDelayMs = Number.isFinite(Number(process.env.CAMERA_KEEPALIVE_RESTART_DELAY_MS))
            ? Math.max(300, Number(process.env.CAMERA_KEEPALIVE_RESTART_DELAY_MS))
            : 2200;
        this.keepaliveTransport = String(process.env.CAMERA_KEEPALIVE_TRANSPORT || 'udp').trim().toLowerCase();
        if (!['tcp', 'udp'].includes(this.keepaliveTransport)) this.keepaliveTransport = 'udp';
        this.defaultStreamTransport = String(process.env.CAMERA_STREAM_DEFAULT_TRANSPORT || 'tcp').trim().toLowerCase();
        if (!['tcp', 'udp'].includes(this.defaultStreamTransport)) this.defaultStreamTransport = 'tcp';
        console.log(
            `[STR] Keepalive ${this.keepaliveEnabled ? 'habilitado' : 'deshabilitado'} ` +
            `(sourceIndex=${this.keepaliveSourceIndex}, transport=${this.keepaliveTransport})`
        );
    }

    ensureStats(id) {
        if (!this.streamStats.has(id)) {
            this.streamStats.set(id, {
                id,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                type: 'single',
                sourceUrl: null,
                bytesOutTotal: 0,
                clients: 0,
                restarts: 0,
                stalls: 0,
                lastByteAt: null,
                lastError: null,
                lastExitCode: null,
                keepalive: {
                    desired: false,
                    active: false,
                    sourceUrl: null,
                    startedAt: null,
                    lastByteAt: null,
                    bytesTotal: 0,
                    restarts: 0,
                    lastError: null,
                    lastExitCode: null
                }
            });
        }
        return this.streamStats.get(id);
    }

    markBytesOut(id, byteCount) {
        const st = this.ensureStats(id);
        st.bytesOutTotal += byteCount;
        st.lastByteAt = Date.now();
        st.updatedAt = Date.now();
    }

    updateClientCount(id, count) {
        const st = this.ensureStats(id);
        st.clients = count;
        st.updatedAt = Date.now();
    }

    setLastError(id, message) {
        const st = this.ensureStats(id);
        st.lastError = message;
        st.updatedAt = Date.now();
    }

    getStatsSnapshot() {
        const out = {};
        this.streamStats.forEach((value, key) => {
            const stream = this.streams.get(key);
            const keepalive = value.keepalive || {};
            out[key] = {
                ...value,
                clients: stream ? stream.clients.size : value.clients,
                active: !!stream,
                keepalive: {
                    desired: !!keepalive.desired,
                    active: !!keepalive.active,
                    sourceUrl: keepalive.sourceUrl || null,
                    startedAt: keepalive.startedAt || null,
                    lastByteAt: keepalive.lastByteAt || null,
                    bytesTotal: Number.isFinite(Number(keepalive.bytesTotal)) ? Number(keepalive.bytesTotal) : 0,
                    restarts: Number.isFinite(Number(keepalive.restarts)) ? Number(keepalive.restarts) : 0,
                    lastError: keepalive.lastError || null,
                    lastExitCode: keepalive.lastExitCode ?? null
                }
            };
        });
        return out;
    }

    markKeepaliveDesired(id, sourceUrl) {
        const st = this.ensureStats(id);
        if (!st.keepalive) st.keepalive = {};
        st.keepalive.desired = true;
        st.keepalive.sourceUrl = sourceUrl || null;
        st.updatedAt = Date.now();
    }

    clearKeepaliveDesired(id) {
        const st = this.ensureStats(id);
        if (!st.keepalive) st.keepalive = {};
        st.keepalive.desired = false;
        st.updatedAt = Date.now();
    }

    clearKeepaliveRestartTimer(id) {
        if (!this.keepaliveRestartTimers.has(id)) return;
        clearTimeout(this.keepaliveRestartTimers.get(id));
        this.keepaliveRestartTimers.delete(id);
    }

    chooseKeepaliveSource({ type = 'single', rtspUrl = null, allRtspUrls = [] }) {
        const unique = [...new Set((allRtspUrls || []).filter(Boolean))];
        if (type === 'combined') {
            if (unique.length === 0) return rtspUrl && rtspUrl !== 'combined' ? rtspUrl : null;
            if (unique.length === 1) {
                return deriveCompanionRtsp(unique[0]) || unique[0];
            }
            const preferred = unique[this.keepaliveSourceIndex];
            return preferred || unique[0];
        }
        if (rtspUrl && rtspUrl !== 'combined') return rtspUrl;
        return unique[0] || null;
    }

    syncKeepaliveConfigs(configs = []) {
        if (!this.keepaliveEnabled) return;

        const desired = new Map();
        configs.forEach((cfg) => {
            if (!cfg || !cfg.id) return;
            const sourceUrl = this.chooseKeepaliveSource(cfg);
            if (!sourceUrl) return;
            desired.set(cfg.id, sourceUrl);
        });

        this.keepaliveDesired = desired;

        this.streamStats.forEach((_, id) => {
            if (!desired.has(id)) this.clearKeepaliveDesired(id);
        });

        for (const [id] of this.keepaliveStreams.entries()) {
            if (!desired.has(id)) {
                this.stopKeepalive(id, 'camera-not-desired');
            }
        }

        desired.forEach((sourceUrl, id) => {
            this.markKeepaliveDesired(id, sourceUrl);

            if (this.streams.has(id)) {
                this.stopKeepalive(id, 'viewer-stream-active');
                return;
            }

            const running = this.keepaliveStreams.get(id);
            if (running && running.sourceUrl !== sourceUrl) {
                this.stopKeepalive(id, 'source-changed');
            }
            if (!this.keepaliveStreams.has(id)) {
                this.startKeepalive(id, sourceUrl);
            }
        });
    }

    scheduleKeepaliveRestart(id) {
        if (!this.keepaliveEnabled) return;
        if (!this.keepaliveDesired.has(id)) return;
        if (this.streams.has(id)) return;
        if (this.keepaliveStreams.has(id)) return;
        if (this.keepaliveRestartTimers.has(id)) return;

        const timer = setTimeout(() => {
            this.keepaliveRestartTimers.delete(id);
            if (!this.keepaliveEnabled) return;
            if (!this.keepaliveDesired.has(id)) return;
            if (this.streams.has(id)) return;
            if (this.keepaliveStreams.has(id)) return;
            const sourceUrl = this.keepaliveDesired.get(id);
            if (sourceUrl) this.startKeepalive(id, sourceUrl);
        }, this.keepaliveRestartDelayMs);

        this.keepaliveRestartTimers.set(id, timer);
    }

    startKeepalive(id, sourceUrl) {
        if (!this.keepaliveEnabled || !sourceUrl) return;
        if (this.keepaliveStreams.has(id)) return;
        this.clearKeepaliveRestartTimer(id);

        const st = this.ensureStats(id);
        if (!st.keepalive) st.keepalive = {};
        st.keepalive.active = true;
        st.keepalive.sourceUrl = sourceUrl;
        st.keepalive.startedAt = Date.now();
        st.keepalive.lastError = null;
        st.updatedAt = Date.now();

        console.log(`[STR] Keepalive iniciado para ${id}`);
        const ffmpeg = spawn('ffmpeg', [
            '-hide_banner',
            '-loglevel', 'warning',
            '-rtsp_transport', this.keepaliveTransport,
            '-fflags', 'nobuffer',
            '-flags', 'low_delay',
            '-i', sourceUrl,
            '-an',
            '-sn',
            '-dn',
            '-vf', 'scale=320:-2',
            '-r', '5',
            '-f', 'null',
            '-'
        ]);

        const entry = {
            process: ffmpeg,
            sourceUrl,
            startedAt: Date.now(),
            lastByteAt: null,
            bytesTotal: 0,
            manualStop: false,
            lastLoggedError: null,
            lastLoggedAt: 0
        };
        this.keepaliveStreams.set(id, entry);

        ffmpeg.stdout.on('data', (data) => {
            entry.lastByteAt = Date.now();
            entry.bytesTotal += data.length;
            const latest = this.ensureStats(id);
            if (!latest.keepalive) latest.keepalive = {};
            latest.keepalive.lastByteAt = entry.lastByteAt;
            latest.keepalive.bytesTotal = entry.bytesTotal;
            latest.updatedAt = Date.now();
        });

        ffmpeg.stderr.on('data', (chunk) => {
            const msg = chunk.toString();
            const lines = msg.split(/\r?\n/).filter(Boolean);
            lines.forEach((line) => {
                const lower = line.toLowerCase();
                const noisyDecodeLine =
                    lower.includes('decode_slice_header') ||
                    lower.includes('error while decoding') ||
                    lower.includes('application provided invalid, non monotonically') ||
                    lower.includes('deprecated pixel format') ||
                    lower.includes('no frame!');
                if (noisyDecodeLine) return;

                const looksRelevant =
                    lower.includes('connection refused') ||
                    lower.includes('timed out') ||
                    lower.includes('nonmatching transport') ||
                    lower.includes('invalid data found') ||
                    lower.includes('failed') ||
                    lower.includes('unauthorized') ||
                    lower.includes('forbidden') ||
                    lower.includes('404') ||
                    lower.includes('refused');
                if (!looksRelevant) return;

                const latest = this.ensureStats(id);
                if (!latest.keepalive) latest.keepalive = {};
                latest.keepalive.lastError = line;
                latest.updatedAt = Date.now();

                const now = Date.now();
                const repeated = entry.lastLoggedError === line && (now - entry.lastLoggedAt) < 30000;
                if (!repeated) {
                    entry.lastLoggedError = line;
                    entry.lastLoggedAt = now;
                    console.error(`[STR-KEEPALIVE] ${id}: ${line}`);
                }
            });
        });

        ffmpeg.on('exit', (code) => {
            const current = this.keepaliveStreams.get(id);
            if (current === entry) this.keepaliveStreams.delete(id);

            const latest = this.ensureStats(id);
            if (!latest.keepalive) latest.keepalive = {};
            latest.keepalive.active = false;
            latest.keepalive.lastExitCode = code;
            latest.updatedAt = Date.now();

            if (!entry.manualStop) {
                latest.keepalive.restarts = Number(latest.keepalive.restarts || 0) + 1;
                this.scheduleKeepaliveRestart(id);
            }
        });

        ffmpeg.on('error', (err) => {
            const current = this.keepaliveStreams.get(id);
            if (current === entry) this.keepaliveStreams.delete(id);

            const latest = this.ensureStats(id);
            if (!latest.keepalive) latest.keepalive = {};
            latest.keepalive.active = false;
            latest.keepalive.lastError = err?.message || String(err);
            latest.keepalive.restarts = Number(latest.keepalive.restarts || 0) + 1;
            latest.updatedAt = Date.now();
            this.scheduleKeepaliveRestart(id);
        });
    }

    stopKeepalive(id, reason = 'manual') {
        this.clearKeepaliveRestartTimer(id);
        const entry = this.keepaliveStreams.get(id);
        if (entry) {
            entry.manualStop = true;
            try { entry.process.kill('SIGKILL'); } catch (e) {}
            this.keepaliveStreams.delete(id);
        }
        const st = this.ensureStats(id);
        if (!st.keepalive) st.keepalive = {};
        st.keepalive.active = false;
        st.updatedAt = Date.now();
        if (reason && reason !== 'viewer-stream-active') {
            console.log(`[STR] Keepalive detenido para ${id} (${reason})`);
        }
    }

    resumeKeepaliveIfDesired(id) {
        if (!this.keepaliveEnabled) return;
        if (this.streams.has(id)) return;
        if (this.keepaliveStreams.has(id)) return;
        const sourceUrl = this.keepaliveDesired.get(id);
        if (sourceUrl) this.startKeepalive(id, sourceUrl);
    }

    handleConnection(ws, id, rtspUrl, type = 'single', allRtspUrls = []) {
        const uniqueRtspUrls = [...new Set((allRtspUrls || []).filter(Boolean))];
        console.log(`[STR] Cliente conectado a stream: ${id} (Type: ${type}, RTSP count: ${allRtspUrls.length}, unique: ${uniqueRtspUrls.length})`);
        const stats = this.ensureStats(id);
        stats.type = type;
        stats.updatedAt = Date.now();
        
        // Clear any pending stop timeout for this stream
        if (this.stopTimeouts.has(id)) {
            clearTimeout(this.stopTimeouts.get(id));
            this.stopTimeouts.delete(id);
        }

        // Evita doble socket RTSP cuando hay viewers activos:
        // keepalive liviano para diagnóstico, stream completo para UI.
        if (this.keepaliveStreams.has(id)) {
            this.stopKeepalive(id, 'viewer-stream-active');
        }

        if (!this.streams.has(id)) {
            if (type === 'combined') {
                const primary = uniqueRtspUrls[0] || (rtspUrl !== 'combined' ? rtspUrl : null);
                if (!primary) {
                    console.error(`[STR] No hay RTSP válido para stream combinado ${id}`);
                    ws.close();
                    return;
                }
                const secondary = uniqueRtspUrls[1] || deriveCompanionRtsp(primary) || primary;
                this.startCombinedFFmpeg(id, [primary, secondary], 'combined');
            } else {
                const fallbackRtsp = rtspUrl === 'combined' ? uniqueRtspUrls[0] : rtspUrl;
                if (!fallbackRtsp) {
                    console.error(`[STR] No hay RTSP válido para ${id}`);
                    ws.close();
                    return;
                }
                const secondary = deriveCompanionRtsp(fallbackRtsp) || fallbackRtsp;
                this.startCombinedFFmpeg(id, [fallbackRtsp, secondary], 'single');
            }
        }

        const stream = this.streams.get(id);
        if (!stream) {
            console.error(`[STR] No se pudo inicializar stream ${id}`);
            ws.close();
            return;
        }
        stream.clients.add(ws);
        this.updateClientCount(id, stream.clients.size);

        ws.on('close', () => {
            console.log(`[STR] Cliente desconectado de stream: ${id}`);
            stream.clients.delete(ws);
            this.updateClientCount(id, stream.clients.size);
            
            if (stream.clients.size === 0) {
                // Wait 10 seconds before stopping, in case of refresh
                const timeout = setTimeout(() => {
                    this.stopFFmpeg(id);
                }, 10000);
                this.stopTimeouts.set(id, timeout);
            }
        });
    }

    startCombinedFFmpeg(id, urls, streamType = 'combined') {
        console.log(`[STR] Iniciando Stream RECONSTRUIDO para cámara: ${id} (type=${streamType})`);
        const st = this.ensureStats(id);
        st.type = streamType;
        st.sourceUrl = urls[0] || null;
        st.updatedAt = Date.now();
        
        // Connect to the persistent AI Reconstructor service via HTTP and proxy bytes directly.
        const qs = `main=${encodeURIComponent(urls[0])}&sub=${encodeURIComponent(urls[1])}`;
        const sourceUrl = `http://localhost:5001/stream/${id}?${qs}`;
        console.log(`[STR] Conectando a RECONSTRUCTOR: ${sourceUrl}`);
        const controller = new AbortController();
        const streamInfo = {
            process: { kill: () => controller.abort() },
            clients: new Set(),
            startedAt: Date.now(),
            lastByteAt: null,
            stallTimer: null
        };
        this.streams.set(id, streamInfo);
        this.startStallWatch(id, streamInfo);

        (async () => {
            try {
                const response = await fetch(sourceUrl, { signal: controller.signal });
                if (!response.ok || !response.body) {
                    throw new Error(`Reconstructor HTTP ${response.status}`);
                }

                const reader = response.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (!value || value.byteLength === 0) continue;
                    streamInfo.lastByteAt = Date.now();
                    const chunk = Buffer.from(value);
                    this.markBytesOut(id, chunk.length);
                    streamInfo.clients.forEach((client) => {
                        if (client.readyState === 1) {
                            client.send(chunk);
                        }
                    });
                }
            } catch (err) {
                if (err?.name !== 'AbortError') {
                    console.error(`[AI-STR-ERR] ${id}: ${err.message}`);
                    this.setLastError(id, err.message);
                }
            } finally {
                const current = this.streams.get(id);
                if (current === streamInfo) {
                    if (streamInfo.stallTimer) {
                        clearInterval(streamInfo.stallTimer);
                    }
                    this.streams.delete(id);
                    streamInfo.clients.forEach((client) => {
                        if (client.readyState === 1) {
                            client.close();
                        }
                    });
                    this.updateClientCount(id, 0);
                    this.resumeKeepaliveIfDesired(id);
                }
            }
        })();
    }

    registerStream(id, ffmpeg, meta = {}) {
        const streamInfo = {
            process: ffmpeg,
            clients: new Set(),
            startedAt: Date.now(),
            lastByteAt: null,
            stallTimer: null,
            meta
        };

        ffmpeg.stdout.on('data', (data) => {
            streamInfo.lastByteAt = Date.now();
            this.markBytesOut(id, data.length);
            streamInfo.clients.forEach(client => {
                if (client.readyState === 1) { // OPEN
                    client.send(data);
                }
            });
        });

        this.startStallWatch(id, streamInfo);

        ffmpeg.stderr.on('data', (data) => {
            const msg = data.toString();
            const lines = msg.split(/\r?\n/).filter(Boolean);
            lines.forEach((line) => {
                const lower = line.toLowerCase();
                const noisyDecodeLine =
                    lower.includes('decode_slice_header') ||
                    lower.includes('error while decoding') ||
                    lower.includes('application provided invalid, non monotonically') ||
                    lower.includes('deprecated pixel format') ||
                    lower.includes('no frame!');
                if (noisyDecodeLine) return;

                if (
                    lower.includes('error') ||
                    lower.includes('failed') ||
                    lower.includes('invalid') ||
                    lower.includes('unable') ||
                    lower.includes('refused')
                ) {
                    console.error(`[STR-FFMPEG] ${id}: ${line}`);
                    this.setLastError(id, line);
                }

                if (meta?.kind === 'single' && meta?.transport === 'tcp' && lower.includes('nonmatching transport')) {
                    this.streamTransportPreference.set(id, 'udp');
                    // Forzar reconexión limpia para que el siguiente intento use UDP.
                    this.restartStream(id, 'rtsp-nonmatching-transport');
                }
            });
        });

        ffmpeg.on('exit', (code) => {
            console.log(`[STR] FFmpeg para ${id} salió con código ${code}`);
            const st = this.ensureStats(id);
            st.lastExitCode = code;
            st.updatedAt = Date.now();
            if (streamInfo.stallTimer) {
                clearInterval(streamInfo.stallTimer);
            }
            if (this.streams.has(id) && this.streams.get(id).process === ffmpeg) {
                this.streams.delete(id);
                this.updateClientCount(id, 0);
                this.resumeKeepaliveIfDesired(id);
            }
        });

        ffmpeg.on('error', (err) => {
            console.error(`[STR] Error lanzando FFmpeg para ${id}: ${err.message}`);
            this.setLastError(id, err.message);
            if (streamInfo.stallTimer) {
                clearInterval(streamInfo.stallTimer);
            }
            if (this.streams.has(id) && this.streams.get(id).process === ffmpeg) {
                this.streams.delete(id);
            }
            streamInfo.clients.forEach(client => {
                if (client.readyState === 1) {
                    client.close();
                }
            });
            this.updateClientCount(id, 0);
            this.resumeKeepaliveIfDesired(id);
        });

        this.streams.set(id, streamInfo);
    }

    startStallWatch(id, streamInfo) {
        streamInfo.stallTimer = setInterval(() => {
            const current = this.streams.get(id);
            if (!current || current !== streamInfo) {
                return;
            }
            const now = Date.now();
            const ageMs = now - current.startedAt;
            const noBytesMs = current.lastByteAt ? (now - current.lastByteAt) : ageMs;
            const timeoutMs = current.lastByteAt ? 30000 : 45000;

            if (current.clients.size > 0 && noBytesMs > timeoutMs) {
                console.error(`[STR] Stream ${id} estancado (${Math.round(noBytesMs / 1000)}s sin bytes). Reiniciando.`);
                const st = this.ensureStats(id);
                st.stalls += 1;
                st.updatedAt = Date.now();
                this.restartStream(id, 'stalled-no-bytes');
            }
        }, 5000);
    }

    startFFmpeg(id, rtspUrl, transport = null) {
        const effectiveTransport = (transport && ['tcp', 'udp'].includes(transport))
            ? transport
            : (this.streamTransportPreference.get(id) || this.defaultStreamTransport);
        this.streamTransportPreference.set(id, effectiveTransport);

        console.log(`[STR] Iniciando nuevo FFmpeg para cámara: ${id} (transport=${effectiveTransport})`);
        const st = this.ensureStats(id);
        st.type = 'single';
        st.sourceUrl = rtspUrl || null;
        st.updatedAt = Date.now();
        
        const ffmpeg = spawn('ffmpeg', [
            '-rtsp_transport', effectiveTransport,
            '-fflags', 'nobuffer',
            '-flags', 'low_delay',
            '-i', rtspUrl,
            '-f', 'mpegts',
            '-codec:v', 'mpeg1video',
            '-vf', 'scale=640:360',
            '-b:v', '1000k',
            '-bf', '0',
            '-muxdelay', '0.001',
            '-r', '24',
            '-'
        ]);

        this.registerStream(id, ffmpeg, {
            kind: 'single',
            transport: effectiveTransport,
            rtspUrl
        });
    }

    stopFFmpeg(id) {
        if (this.streams.has(id)) {
            console.log(`[STR] Deteniendo FFmpeg para ${id} (sin espectadores)`);
            const stream = this.streams.get(id);
            if (stream.stallTimer) {
                clearInterval(stream.stallTimer);
            }
            stream.process.kill('SIGKILL');
            this.streams.delete(id);
            this.updateClientCount(id, 0);
        }
        this.stopTimeouts.delete(id);
        this.resumeKeepaliveIfDesired(id);
    }

    restartStream(id, reason = 'unknown') {
        if (!this.streams.has(id)) {
            return;
        }
        console.log(`[STR] Reiniciando stream ${id}. Motivo: ${reason}`);
        const st = this.ensureStats(id);
        st.restarts += 1;
        st.lastError = `restart:${reason}`;
        st.updatedAt = Date.now();
        const stream = this.streams.get(id);
        if (stream.stallTimer) {
            clearInterval(stream.stallTimer);
        }
        stream.clients.forEach(client => {
            if (client.readyState === 1) {
                client.close();
            }
        });
        stream.process.kill('SIGKILL');
        this.streams.delete(id);
        this.stopTimeouts.delete(id);
        this.updateClientCount(id, 0);
        this.resumeKeepaliveIfDesired(id);
    }
}

module.exports = new StreamManager();

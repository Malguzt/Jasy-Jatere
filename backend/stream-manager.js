const { spawn } = require('child_process');

class StreamManager {
    constructor() {
        this.streams = new Map(); // id -> { process, clients: Set<ws> }
        this.stopTimeouts = new Map(); // id -> timeout
    }

    handleConnection(ws, id, rtspUrl, type = 'single', allRtspUrls = []) {
        const uniqueRtspUrls = [...new Set((allRtspUrls || []).filter(Boolean))];
        console.log(`[STR] Cliente conectado a stream: ${id} (Type: ${type}, RTSP count: ${allRtspUrls.length}, unique: ${uniqueRtspUrls.length})`);
        
        // Clear any pending stop timeout for this stream
        if (this.stopTimeouts.has(id)) {
            clearTimeout(this.stopTimeouts.get(id));
            this.stopTimeouts.delete(id);
        }

        if (!this.streams.has(id)) {
            if (type === 'combined') {
                const primary = uniqueRtspUrls[0] || (rtspUrl !== 'combined' ? rtspUrl : null);
                if (!primary) {
                    console.error(`[STR] No hay RTSP válido para stream combinado ${id}`);
                    ws.close();
                    return;
                }
                const secondary = uniqueRtspUrls[1] || primary;
                this.startCombinedFFmpeg(id, [primary, secondary]);
            } else {
                const fallbackRtsp = rtspUrl === 'combined' ? uniqueRtspUrls[0] : rtspUrl;
                if (!fallbackRtsp) {
                    console.error(`[STR] No hay RTSP válido para ${id}`);
                    ws.close();
                    return;
                }
                this.startFFmpeg(id, fallbackRtsp);
            }
        }

        const stream = this.streams.get(id);
        stream.clients.add(ws);

        ws.on('close', () => {
            console.log(`[STR] Cliente desconectado de stream: ${id}`);
            stream.clients.delete(ws);
            
            if (stream.clients.size === 0) {
                // Wait 10 seconds before stopping, in case of refresh
                const timeout = setTimeout(() => {
                    this.stopFFmpeg(id);
                }, 10000);
                this.stopTimeouts.set(id, timeout);
            }
        });
    }

    startCombinedFFmpeg(id, urls) {
        console.log(`[STR] Iniciando Stream RECONSTRUIDO (IA Fusion) para cámara: ${id}`);
        
        // Connect to the persistent AI Reconstructor service via HTTP
        // This is significantly more efficient as it shares VRAM and model state
        const qs = `main=${encodeURIComponent(urls[0])}&sub=${encodeURIComponent(urls[1])}`;
        const sourceUrl = `http://localhost:5001/stream/${id}?${qs}`;
        console.log(`[STR] Conectando a RECONSTRUCTOR: ${sourceUrl}`);
        
        const ffmpeg = spawn('ffmpeg', [
            '-i', sourceUrl,
            '-f', 'mpegts',
            '-codec:v', 'copy', // The reconstructor already sends MPEG-TS, just copy it
            '-'
        ]);
        
        ffmpeg.stderr.on('data', (data) => {
            const msg = data.toString();
            const lines = msg.split(/\r?\n/).filter(Boolean);
            lines.forEach((line) => {
                const lower = line.toLowerCase();
                if (
                    lower.includes('error') ||
                    lower.includes('failed') ||
                    lower.includes('invalid') ||
                    lower.includes('unable') ||
                    lower.includes('refused')
                ) {
                    console.error(`[AI-STR-ERR] ${id}: ${line}`);
                }
            });
        });

        this.registerStream(id, ffmpeg);
    }

    registerStream(id, ffmpeg) {
        const streamInfo = {
            process: ffmpeg,
            clients: new Set()
        };

        ffmpeg.stdout.on('data', (data) => {
            streamInfo.clients.forEach(client => {
                if (client.readyState === 1) { // OPEN
                    client.send(data);
                }
            });
        });

        ffmpeg.stderr.on('data', (data) => {
            const msg = data.toString();
            const lines = msg.split(/\r?\n/).filter(Boolean);
            lines.forEach((line) => {
                const lower = line.toLowerCase();
                if (
                    lower.includes('error') ||
                    lower.includes('failed') ||
                    lower.includes('invalid') ||
                    lower.includes('unable') ||
                    lower.includes('refused')
                ) {
                    console.error(`[STR-FFMPEG] ${id}: ${line}`);
                }
            });
        });

        ffmpeg.on('exit', (code) => {
            console.log(`[STR] FFmpeg para ${id} salió con código ${code}`);
            if (this.streams.has(id) && this.streams.get(id).process === ffmpeg) {
                this.streams.delete(id);
            }
        });

        ffmpeg.on('error', (err) => {
            console.error(`[STR] Error lanzando FFmpeg para ${id}: ${err.message}`);
            if (this.streams.has(id) && this.streams.get(id).process === ffmpeg) {
                this.streams.delete(id);
            }
            streamInfo.clients.forEach(client => {
                if (client.readyState === 1) {
                    client.close();
                }
            });
        });

        this.streams.set(id, streamInfo);
    }

    startFFmpeg(id, rtspUrl) {
        console.log(`[STR] Iniciando nuevo FFmpeg para cámara: ${id}`);
        
        const ffmpeg = spawn('ffmpeg', [
            '-rtsp_transport', 'tcp',
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

        this.registerStream(id, ffmpeg);
    }

    stopFFmpeg(id) {
        if (this.streams.has(id)) {
            console.log(`[STR] Deteniendo FFmpeg para ${id} (sin espectadores)`);
            const stream = this.streams.get(id);
            stream.process.kill('SIGKILL');
            this.streams.delete(id);
        }
        this.stopTimeouts.delete(id);
    }
}

module.exports = new StreamManager();

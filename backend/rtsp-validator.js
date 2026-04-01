const { spawn } = require('child_process');
const { resolveCameraCredentials } = require('./camera-credentials');

const DEFAULT_VALIDATE_TIMEOUT_MS = Number(process.env.CAMERA_RTSP_VALIDATE_TIMEOUT_MS || 6500);

function safeNow() {
    return Date.now();
}

function toMs(start) {
    return Math.max(0, safeNow() - start);
}

function maskRtspUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    return rawUrl.replace(/rtsp:\/\/([^@]+)@/i, 'rtsp://***:***@');
}

function injectAuth(url, user, pass) {
    if (!url || typeof url !== 'string') return null;
    if (!url.startsWith('rtsp://')) return null;
    if (url.includes('@')) return url;
    if (!pass) return url;
    const effectiveUser = user || resolveCameraCredentials({}).user;
    return url.replace('rtsp://', `rtsp://${effectiveUser}:${pass}@`);
}

function normalizeRtspUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== 'rtsp:') return rawUrl.trim();
        parsed.username = '';
        parsed.password = '';
        return parsed.toString();
    } catch (e) {
        return rawUrl.trim();
    }
}

function parseErrorSummary(stderr = '') {
    const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const relevant = lines.filter((l) => /(error|invalid|corrupt|fail|timed out|unauthorized|refused|nonmatching transport|no frame|bad request)/i.test(l));
    return {
        errorCount: relevant.length,
        firstError: relevant[0] || null
    };
}

function runWithTimeout(command, args, timeoutMs) {
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

        child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('error', (err) => finish({ ok: false, code: null, error: err?.message || String(err), timedOut: false }));
        child.on('close', (code) => finish({ ok: code === 0, code, timedOut: false }));
    });
}

async function probeRtspFirstFrame(url, transport, timeoutMs) {
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
    const result = await runWithTimeout('ffmpeg', args, timeoutMs);
    const parsed = parseErrorSummary(result.stderr);
    return {
        ok: result.ok,
        timedOut: result.timedOut,
        transport,
        latencyMs: result.ok ? result.elapsedMs : null,
        reason: result.ok ? null : (parsed.firstError || (result.timedOut ? 'first-frame timeout' : 'first-frame failed'))
    };
}

function buildValidationSourceList(payload = {}) {
    if ((payload.type || 'single') === 'combined') {
        const urls = Array.isArray(payload.allRtspUrls) ? payload.allRtspUrls.filter(Boolean) : [];
        return urls.map((u, idx) => ({ index: idx, rawUrl: u }));
    }
    if (payload.rtspUrl && payload.rtspUrl !== 'combined') {
        return [{ index: 0, rawUrl: payload.rtspUrl }];
    }
    return [];
}

async function validateCameraRtspPayload(payload = {}, options = {}) {
    const timeoutMs = Number(options.timeoutMs || DEFAULT_VALIDATE_TIMEOUT_MS);
    const requireDistinctCombinedSources = options.requireDistinctCombinedSources !== false;
    const type = payload.type || 'single';
    const creds = resolveCameraCredentials(payload);
    const user = creds.user;
    const pass = creds.pass;
    const errors = [];
    const warnings = [];

    const sources = buildValidationSourceList(payload);

    if (sources.length === 0) {
        errors.push(type === 'combined'
            ? 'Modo combinado requiere al menos una URL RTSP en allRtspUrls.'
            : 'rtspUrl es necesario.');
        return { ok: false, errors, warnings, checks: [] };
    }

    if (type === 'combined' && requireDistinctCombinedSources) {
        const normalized = sources
            .map((s) => normalizeRtspUrl(s.rawUrl))
            .filter(Boolean);
        const unique = [...new Set(normalized)];
        if (unique.length < 2) {
            errors.push('Modo combinado requiere 2 canales RTSP distintos (main/sub). Se detectaron URLs duplicadas.');
        }
    }

    const checks = await Promise.all(sources.map(async (source) => {
        const withAuth = injectAuth(source.rawUrl, user, pass);
        if (!withAuth) {
            return {
                sourceIndex: source.index,
                sourceUrl: maskRtspUrl(source.rawUrl),
                ok: false,
                transport: null,
                latencyMs: null,
                reason: 'URL RTSP inválida'
            };
        }

        const tcp = await probeRtspFirstFrame(withAuth, 'tcp', timeoutMs);
        if (tcp.ok) {
            return {
                sourceIndex: source.index,
                sourceUrl: maskRtspUrl(withAuth),
                ok: true,
                transport: 'tcp',
                latencyMs: tcp.latencyMs,
                reason: null
            };
        }

        const udp = await probeRtspFirstFrame(withAuth, 'udp', timeoutMs);
        if (udp.ok) {
            return {
                sourceIndex: source.index,
                sourceUrl: maskRtspUrl(withAuth),
                ok: true,
                transport: 'udp',
                latencyMs: udp.latencyMs,
                reason: null
            };
        }

        return {
            sourceIndex: source.index,
            sourceUrl: maskRtspUrl(withAuth),
            ok: false,
            transport: null,
            latencyMs: null,
            reason: udp.reason || tcp.reason || 'No se obtuvo frame RTSP válido'
        };
    }));

    const failed = checks.filter((c) => !c.ok);
    failed.forEach((f) => {
        errors.push(`Canal ${f.sourceIndex + 1}: ${f.reason}`);
    });

    if (type === 'combined' && checks.length >= 2) {
        const normalizedByCheck = checks.map((c) => normalizeRtspUrl((sources[c.sourceIndex] || {}).rawUrl));
        const unique = [...new Set(normalizedByCheck.filter(Boolean))];
        if (unique.length < 2) {
            warnings.push('Los canales combinados comparten el mismo endpoint RTSP; esto anula la fusión real.');
        }
    }

    return {
        ok: errors.length === 0,
        errors,
        warnings,
        checks
    };
}

module.exports = {
    validateCameraRtspPayload,
    maskRtspUrl,
    normalizeRtspUrl
};

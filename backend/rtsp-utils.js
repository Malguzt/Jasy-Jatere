const { resolveCameraCredentials } = require('./camera-credentials');

function injectRtspAuth(rawUrl, user, pass) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    if (!rawUrl.startsWith('rtsp://')) return rawUrl;
    if (rawUrl.includes('@')) return rawUrl;
    if (!pass) return rawUrl;
    return rawUrl.replace('rtsp://', `rtsp://${user}:${pass}@`);
}

function withCameraAuth(rawUrl, camera = {}) {
    const { user, pass } = resolveCameraCredentials(camera || {});
    return injectRtspAuth(rawUrl, user, pass);
}

function resolveCameraStreamUrls(camera = {}) {
    const rtspUrl = withCameraAuth(camera?.rtspUrl, camera);
    const allRtspUrls = Array.isArray(camera?.allRtspUrls)
        ? camera.allRtspUrls.map((url) => withCameraAuth(url, camera)).filter(Boolean)
        : [];
    return { rtspUrl, allRtspUrls };
}

function deriveCompanionRtsp(url) {
    if (!url || typeof url !== 'string') return null;
    const candidates = [];
    if (url.includes('/onvif1')) candidates.push(url.replace('/onvif1', '/onvif2'));
    if (url.includes('/onvif2')) candidates.push(url.replace('/onvif2', '/onvif1'));
    if (url.includes('/stream1')) candidates.push(url.replace('/stream1', '/stream2'));
    if (url.includes('/stream2')) candidates.push(url.replace('/stream2', '/stream1'));
    if (url.includes('subtype=0')) candidates.push(url.replace('subtype=0', 'subtype=1'));
    if (url.includes('subtype=1')) candidates.push(url.replace('subtype=1', 'subtype=0'));
    return candidates.find((candidate) => candidate && candidate !== url) || null;
}

function parseResolutionHint(label) {
    if (!label || typeof label !== 'string') return null;
    const match = label.match(/(\d{2,5})\s*x\s*(\d{2,5})/i);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return { width, height, pixels: width * height };
}

module.exports = {
    injectRtspAuth,
    withCameraAuth,
    resolveCameraStreamUrls,
    deriveCompanionRtsp,
    parseResolutionHint
};

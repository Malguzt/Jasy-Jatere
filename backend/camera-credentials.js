const DEFAULT_CAMERA_USER = (process.env.CAMERA_DEFAULT_USER || 'admin').trim() || 'admin';
const DEFAULT_CAMERA_PASS = process.env.CAMERA_DEFAULT_PASS !== undefined
    ? String(process.env.CAMERA_DEFAULT_PASS)
    : 'PerroN3gro';

function pickUser(...candidates) {
    for (const value of candidates) {
        if (typeof value !== 'string') continue;
        const clean = value.trim();
        if (clean) return clean;
    }
    return DEFAULT_CAMERA_USER;
}

function pickPass(...candidates) {
    for (const value of candidates) {
        if (value === null || value === undefined) continue;
        const asText = String(value);
        if (asText !== '') return asText;
    }
    return DEFAULT_CAMERA_PASS;
}

function resolveCameraCredentials(source = {}) {
    return {
        user: pickUser(source.user, source.username),
        pass: pickPass(source.pass, source.password)
    };
}

function resolveUserPass(user, pass, source = {}) {
    return {
        user: pickUser(user, source.user, source.username),
        pass: pickPass(pass, source.pass, source.password)
    };
}

module.exports = {
    DEFAULT_CAMERA_USER,
    DEFAULT_CAMERA_PASS,
    resolveCameraCredentials,
    resolveUserPass
};

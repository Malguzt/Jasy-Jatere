function parseBool(value, fallback = true) {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

function resolveMapPersistenceFlags(env = process.env) {
    const metadataDriver = String(env.METADATA_STORE_DRIVER || 'sqlite').toLowerCase();
    const legacyCompatExportsEnabled = parseBool(env.LEGACY_COMPAT_EXPORTS_ENABLED, false);
    return {
        metadataDriver,
        legacyCompatExportsEnabled,
        exportCompatJson: parseBool(env.METADATA_DUAL_WRITE_JSON_EXPORTS, legacyCompatExportsEnabled)
    };
}

module.exports = {
    parseBool,
    resolveMapPersistenceFlags
};

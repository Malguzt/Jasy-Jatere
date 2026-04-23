const path = require('path');
const { resolveMapPersistenceFlags } = require('./persistence-flags');

function toPositiveInt(value, fallback) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
    return fallback;
}

function resolveMapsRuntimeConfig({
    runtimeFlags = {},
    env = process.env,
    mapPersistenceFlags = resolveMapPersistenceFlags(env)
} = {}) {
    const mapsDirRaw = String(runtimeFlags.mapsDataDir || env.MAPS_DATA_DIR || '').trim();
    const mapsDir = mapsDirRaw
        ? path.resolve(mapsDirRaw)
        : path.join(__dirname, '..', 'data', 'maps');
    const metadataDriver = String(
        runtimeFlags.metadataStoreDriver ||
        mapPersistenceFlags.metadataDriver ||
        'sqlite'
    ).toLowerCase();
    const metadataSqlitePath = String(
        runtimeFlags.metadataSqlitePath ||
        env.METADATA_SQLITE_PATH ||
        path.join(mapsDir, 'metadata.db')
    ).trim();
    const mapCorrectionHistoryLimit = toPositiveInt(
        runtimeFlags.mapCorrectionHistoryLimit,
        toPositiveInt(env.MAP_CORRECTION_HISTORY_LIMIT, 20)
    );

    return {
        mapsDir,
        metadataDriver,
        metadataSqlitePath,
        exportCompatJson: mapPersistenceFlags.exportCompatJson === true,
        mapCorrectionHistoryLimit
    };
}

module.exports = {
    resolveMapsRuntimeConfig
};

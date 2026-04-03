const path = require('path');
const { MAPS_DIR } = require('./storage');
const { MetadataSqliteStore } = require('../src/infrastructure/sqlite/metadata-sqlite-store');
const { SqliteMapCorrectionsRepository } = require('../src/infrastructure/sqlite/sqlite-map-corrections-repository');
const { createLegacyJsonAdapter } = require('./legacy-json-adapter');
const { resolveMapPersistenceFlags } = require('./persistence-flags');
const { DEFAULT_INDEX, DEFAULT_CORRECTIONS } = require('./defaults');

const MAX_HISTORY = Number(process.env.MAP_CORRECTION_HISTORY_LIMIT || 20);
const mapPersistenceFlags = resolveMapPersistenceFlags();
const METADATA_DRIVER = mapPersistenceFlags.metadataDriver;
const SQLITE_DB_PATH = process.env.METADATA_SQLITE_PATH || path.join(MAPS_DIR, 'metadata.db');
const EXPORT_COMPAT_JSON = mapPersistenceFlags.exportCompatJson;
const LEGACY_READ_FALLBACK = mapPersistenceFlags.legacyReadFallback;

const legacyAdapter = createLegacyJsonAdapter({
    mapsDir: MAPS_DIR,
    defaultIndex: DEFAULT_INDEX,
    defaultCorrections: DEFAULT_CORRECTIONS
});
const CORRECTIONS_FILE = legacyAdapter.correctionsFile;

let sqliteStore = null;
let sqliteCorrections = null;
let sqliteBootstrapped = false;

function useSqlite() {
    return METADATA_DRIVER === 'sqlite';
}

function ensureSqliteRepository() {
    if (!useSqlite()) return;
    if (sqliteCorrections) return;
    sqliteStore = sqliteStore || new MetadataSqliteStore({ dbPath: SQLITE_DB_PATH });
    sqliteStore.migrate();
    sqliteCorrections = new SqliteMapCorrectionsRepository({ store: sqliteStore });
}

function legacyReadCorrections() {
    try {
        const raw = legacyAdapter.readCorrections({ ensure: true });
        if (!raw || typeof raw !== 'object') return { ...DEFAULT_CORRECTIONS };
        return {
            schemaVersion: raw.schemaVersion || '1.0',
            updatedAt: raw.updatedAt || null,
            lastManualMapId: raw.lastManualMapId || null,
            manualCameraLayout: Array.isArray(raw.manualCameraLayout) ? raw.manualCameraLayout : [],
            objectHints: Array.isArray(raw.objectHints) ? raw.objectHints : [],
            history: Array.isArray(raw.history) ? raw.history : []
        };
    } catch (error) {
        return { ...DEFAULT_CORRECTIONS };
    }
}

function sanitizeCorrections(data) {
    return {
        schemaVersion: data?.schemaVersion || '1.0',
        updatedAt: data?.updatedAt || Date.now(),
        lastManualMapId: data?.lastManualMapId || null,
        manualCameraLayout: Array.isArray(data?.manualCameraLayout) ? data.manualCameraLayout : [],
        objectHints: Array.isArray(data?.objectHints) ? data.objectHints : [],
        history: Array.isArray(data?.history) ? data.history.slice(0, Math.max(1, MAX_HISTORY)) : []
    };
}

function legacyWriteCorrections(data) {
    const safe = sanitizeCorrections(data);
    legacyAdapter.writeCorrections(safe);
    return safe;
}

function bootstrapSqliteFromLegacy({ force = false } = {}) {
    if (!useSqlite()) return;
    ensureSqliteRepository();
    if (sqliteBootstrapped) return;
    if (!force && !LEGACY_READ_FALLBACK) return;

    if (!sqliteCorrections.exists()) {
        const legacy = legacyReadCorrections();
        sqliteCorrections.write(legacy);
    }

    sqliteBootstrapped = true;
}

function readCorrections() {
    if (!useSqlite()) return legacyReadCorrections();
    bootstrapSqliteFromLegacy();
    const stored = sqliteCorrections.read(DEFAULT_CORRECTIONS);
    return sanitizeCorrections(stored);
}

function writeCorrections(data) {
    const safe = sanitizeCorrections(data);
    if (useSqlite()) {
        bootstrapSqliteFromLegacy();
        sqliteCorrections.write(safe);
    }
    if (!useSqlite() || EXPORT_COMPAT_JSON) {
        legacyWriteCorrections(safe);
    }
    return safe;
}

function bootstrapFromLegacy() {
    if (!useSqlite()) return null;
    bootstrapSqliteFromLegacy({ force: true });
    const stored = sqliteCorrections.read(DEFAULT_CORRECTIONS);
    return sanitizeCorrections(stored);
}

function toCameraLayout(cameras = []) {
    if (!Array.isArray(cameras)) return [];
    return cameras
        .map((camera) => ({
            id: String(camera.id),
            label: String(camera.label || camera.name || camera.id || '').trim(),
            x: Number(camera.x),
            y: Number(camera.y),
            yawDeg: Number(camera.yawDeg ?? 0)
        }))
        .filter((camera) =>
            camera.id &&
            camera.label &&
            Number.isFinite(camera.x) &&
            Number.isFinite(camera.y) &&
            Number.isFinite(camera.yawDeg)
        )
        .map((camera) => ({
            ...camera,
            x: Number(camera.x.toFixed(2)),
            y: Number(camera.y.toFixed(2)),
            yawDeg: Number(camera.yawDeg.toFixed(1))
        }));
}

function toObjectHints(objects = []) {
    if (!Array.isArray(objects)) return [];
    return objects
        .map((object) => {
            const label = String(object.label || '').trim();
            if (!label) return null;
            const x = Number(object.x);
            const y = Number(object.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            const confidence = Number(object.confidence);
            const sourceCameraId = Array.isArray(object.sources) && object.sources.length > 0
                ? String(object.sources[0])
                : null;
            return {
                label,
                category: String(object.category || 'estructura'),
                x: Number(x.toFixed(2)),
                y: Number(y.toFixed(2)),
                confidence: Number.isFinite(confidence) ? Number(Math.max(0.05, Math.min(0.99, confidence)).toFixed(2)) : 0.75,
                cameraId: sourceCameraId
            };
        })
        .filter(Boolean);
}

function upsertFromManualMap(mapDoc) {
    const current = readCorrections();
    const next = {
        ...current,
        updatedAt: Date.now(),
        lastManualMapId: mapDoc?.mapId || current.lastManualMapId || null,
        manualCameraLayout: toCameraLayout(mapDoc?.cameras),
        objectHints: toObjectHints(mapDoc?.objects),
        history: [
            {
                mapId: mapDoc?.mapId || null,
                ts: Date.now(),
                cameras: Array.isArray(mapDoc?.cameras) ? mapDoc.cameras.length : 0,
                objects: Array.isArray(mapDoc?.objects) ? mapDoc.objects.length : 0
            },
            ...(Array.isArray(current.history) ? current.history : [])
        ].slice(0, Math.max(1, MAX_HISTORY))
    };
    return writeCorrections(next);
}

function getHintsForGeneration() {
    const data = readCorrections();
    return {
        updatedAt: data.updatedAt || null,
        lastManualMapId: data.lastManualMapId || null,
        manualCameraLayout: Array.isArray(data.manualCameraLayout) ? data.manualCameraLayout : [],
        objectHints: Array.isArray(data.objectHints) ? data.objectHints : []
    };
}

module.exports = {
    CORRECTIONS_FILE,
    readCorrections,
    writeCorrections,
    upsertFromManualMap,
    getHintsForGeneration,
    bootstrapFromLegacy
};

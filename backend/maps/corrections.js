const fs = require('fs');
const path = require('path');
const { MAPS_DIR } = require('./storage');
const { MetadataSqliteStore } = require('../src/infrastructure/sqlite/metadata-sqlite-store');
const { SqliteMapCorrectionsRepository } = require('../src/infrastructure/sqlite/sqlite-map-corrections-repository');

const CORRECTIONS_FILE = path.join(MAPS_DIR, 'manual-corrections.json');
const MAX_HISTORY = Number(process.env.MAP_CORRECTION_HISTORY_LIMIT || 20);
const METADATA_DRIVER = String(process.env.METADATA_STORE_DRIVER || 'sqlite').toLowerCase();
const SQLITE_DB_PATH = process.env.METADATA_SQLITE_PATH || path.join(MAPS_DIR, 'metadata.db');
const EXPORT_COMPAT_JSON = parseBool(process.env.METADATA_DUAL_WRITE_JSON_EXPORTS, true);

const DEFAULT_CORRECTIONS = {
    schemaVersion: '1.0',
    updatedAt: null,
    lastManualMapId: null,
    manualCameraLayout: [],
    objectHints: [],
    history: []
};

let sqliteStore = null;
let sqliteCorrections = null;
let sqliteBootstrapped = false;

function parseBool(value, fallback = true) {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

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

function ensureLegacyFile() {
    fs.mkdirSync(MAPS_DIR, { recursive: true });
    if (!fs.existsSync(CORRECTIONS_FILE)) {
        fs.writeFileSync(CORRECTIONS_FILE, `${JSON.stringify(DEFAULT_CORRECTIONS, null, 2)}\n`);
    }
}

function legacyReadCorrections() {
    try {
        ensureLegacyFile();
        const raw = JSON.parse(fs.readFileSync(CORRECTIONS_FILE, 'utf8'));
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
    ensureLegacyFile();
    const safe = sanitizeCorrections(data);
    fs.writeFileSync(CORRECTIONS_FILE, `${JSON.stringify(safe, null, 2)}\n`);
    return safe;
}

function bootstrapSqliteFromLegacy() {
    if (!useSqlite()) return;
    ensureSqliteRepository();
    if (sqliteBootstrapped) return;

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
    getHintsForGeneration
};

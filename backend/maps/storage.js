const fs = require('fs');
const path = require('path');
const { MetadataSqliteStore } = require('../src/infrastructure/sqlite/metadata-sqlite-store');
const { SqliteMapVersionRepository } = require('../src/infrastructure/sqlite/sqlite-map-version-repository');
const { SqliteMapJobRepository } = require('../src/infrastructure/sqlite/sqlite-map-job-repository');

const MAPS_DIR = process.env.MAPS_DATA_DIR
    ? path.resolve(process.env.MAPS_DATA_DIR)
    : path.join(__dirname, '..', 'data', 'maps');
const INDEX_FILE = path.join(MAPS_DIR, 'index.json');
const JOBS_FILE = path.join(MAPS_DIR, 'jobs.json');

const DEFAULT_INDEX = {
    schemaVersion: '1.0',
    activeMapId: null,
    maps: []
};

const METADATA_DRIVER = String(process.env.METADATA_STORE_DRIVER || 'sqlite').toLowerCase();
const SQLITE_DB_PATH = process.env.METADATA_SQLITE_PATH || path.join(MAPS_DIR, 'metadata.db');
const LEGACY_COMPAT_EXPORTS_ENABLED = parseBool(process.env.LEGACY_COMPAT_EXPORTS_ENABLED, false);
const EXPORT_COMPAT_JSON = parseBool(process.env.METADATA_DUAL_WRITE_JSON_EXPORTS, LEGACY_COMPAT_EXPORTS_ENABLED);
const LEGACY_READ_FALLBACK = parseBool(process.env.METADATA_LEGACY_READ_FALLBACK, LEGACY_COMPAT_EXPORTS_ENABLED);

let sqliteStore = null;
let sqliteMaps = null;
let sqliteJobs = null;
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

function ensureSqliteRepositories() {
    if (!useSqlite()) return;
    if (sqliteMaps && sqliteJobs) return;
    sqliteStore = sqliteStore || new MetadataSqliteStore({ dbPath: SQLITE_DB_PATH });
    sqliteStore.migrate();
    sqliteMaps = sqliteMaps || new SqliteMapVersionRepository({ store: sqliteStore });
    sqliteJobs = sqliteJobs || new SqliteMapJobRepository({ store: sqliteStore });
}

function ensureStorage() {
    fs.mkdirSync(MAPS_DIR, { recursive: true });
    if (!fs.existsSync(INDEX_FILE)) {
        writeJsonAtomic(INDEX_FILE, DEFAULT_INDEX);
    }
    if (!fs.existsSync(JOBS_FILE)) {
        writeJsonAtomic(JOBS_FILE, []);
    }
}

function readJsonSafe(filePath, fallbackValue) {
    try {
        if (!fs.existsSync(filePath)) return fallbackValue;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        return fallbackValue;
    }
}

function writeJsonAtomic(filePath, data) {
    const tempFile = `${filePath}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
    fs.renameSync(tempFile, filePath);
}

function toSummary(mapDoc) {
    return {
        mapId: mapDoc.mapId,
        schemaVersion: mapDoc.schemaVersion || '1.0',
        createdAt: mapDoc.createdAt || Date.now(),
        updatedAt: mapDoc.updatedAt || mapDoc.createdAt || Date.now(),
        quality: mapDoc.quality || {},
        timing: mapDoc?.metadata?.timing || null,
        stats: {
            cameras: Array.isArray(mapDoc.cameras) ? mapDoc.cameras.length : 0,
            objects: Array.isArray(mapDoc.objects) ? mapDoc.objects.length : 0
        }
    };
}

function getMapPath(mapId) {
    return path.join(MAPS_DIR, `${mapId}.json`);
}

function legacyGetIndex() {
    ensureStorage();
    const raw = readJsonSafe(INDEX_FILE, DEFAULT_INDEX);
    const maps = Array.isArray(raw?.maps) ? raw.maps : [];
    return {
        schemaVersion: raw?.schemaVersion || '1.0',
        activeMapId: raw?.activeMapId || null,
        maps: maps.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    };
}

function legacySaveIndex(index) {
    ensureStorage();
    const next = {
        schemaVersion: index?.schemaVersion || '1.0',
        activeMapId: index?.activeMapId || null,
        maps: Array.isArray(index?.maps) ? index.maps : []
    };
    writeJsonAtomic(INDEX_FILE, next);
    return next;
}

function legacySaveMap(mapDoc) {
    ensureStorage();
    if (!mapDoc || !mapDoc.mapId) {
        throw new Error('mapDoc/mapId is required');
    }

    const mapPath = getMapPath(mapDoc.mapId);
    writeJsonAtomic(mapPath, mapDoc);

    const summary = toSummary(mapDoc);
    const index = legacyGetIndex();
    const withoutCurrent = index.maps.filter((map) => map.mapId !== summary.mapId);
    const nextMaps = [summary, ...withoutCurrent].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

    const nextIndex = {
        ...index,
        maps: nextMaps,
        activeMapId: index.activeMapId || summary.mapId
    };
    legacySaveIndex(nextIndex);
    return summary;
}

function legacyGetMap(mapId) {
    ensureStorage();
    if (!mapId) return null;
    const filePath = getMapPath(mapId);
    return readJsonSafe(filePath, null);
}

function legacyListMapSummaries() {
    return legacyGetIndex().maps;
}

function legacyGetLatestMap() {
    const index = legacyGetIndex();
    if (index.activeMapId) {
        const active = legacyGetMap(index.activeMapId);
        if (active) return active;
    }
    const latest = index.maps[0];
    if (!latest) return null;
    return legacyGetMap(latest.mapId);
}

function legacyPromoteMap(mapId) {
    const doc = legacyGetMap(mapId);
    if (!doc) return null;
    const index = legacyGetIndex();
    index.activeMapId = mapId;
    legacySaveIndex(index);
    return toSummary(doc);
}

function legacyLoadJobs() {
    ensureStorage();
    const jobs = readJsonSafe(JOBS_FILE, []);
    if (!Array.isArray(jobs)) return [];
    return jobs.sort((a, b) => Number(b.requestedAt || 0) - Number(a.requestedAt || 0));
}

function legacySaveJobs(jobs) {
    ensureStorage();
    const safeJobs = Array.isArray(jobs) ? jobs : [];
    const sorted = [...safeJobs].sort((a, b) => Number(b.requestedAt || 0) - Number(a.requestedAt || 0));
    writeJsonAtomic(JOBS_FILE, sorted);
    return sorted;
}

function bootstrapSqliteFromLegacy({ force = false } = {}) {
    if (!useSqlite()) return;
    ensureSqliteRepositories();
    if (sqliteBootstrapped) return;
    if (!force && !LEGACY_READ_FALLBACK) return;

    if (sqliteMaps.count() === 0) {
        const legacyIndex = legacyGetIndex();
        const seenMapIds = new Set();
        legacyIndex.maps.forEach((summary) => {
            const mapId = String(summary?.mapId || '').trim();
            if (!mapId || seenMapIds.has(mapId)) return;
            seenMapIds.add(mapId);
            const mapDoc = legacyGetMap(mapId);
            if (!mapDoc || !mapDoc.mapId) return;
            sqliteMaps.saveMap(mapDoc);
        });
        if (legacyIndex.activeMapId) {
            sqliteMaps.promoteMap(legacyIndex.activeMapId);
        }
    }

    if (sqliteJobs.count() === 0) {
        const legacyJobs = legacyLoadJobs();
        if (legacyJobs.length > 0) {
            sqliteJobs.replaceAll(legacyJobs);
        }
    }

    sqliteBootstrapped = true;
}

function getIndex() {
    if (!useSqlite()) return legacyGetIndex();
    bootstrapSqliteFromLegacy();
    return sqliteMaps.getIndex();
}

function saveIndex(index) {
    if (!useSqlite()) return legacySaveIndex(index);
    bootstrapSqliteFromLegacy();

    const nextActiveMapId = index?.activeMapId || null;
    sqliteMaps.setActiveMapId(nextActiveMapId);
    const nextIndex = sqliteMaps.getIndex();
    if (EXPORT_COMPAT_JSON) {
        legacySaveIndex(nextIndex);
    }
    return nextIndex;
}

function bootstrapFromLegacy() {
    if (!useSqlite()) return null;
    bootstrapSqliteFromLegacy({ force: true });
    return {
        maps: sqliteMaps.count(),
        jobs: sqliteJobs.count()
    };
}

function saveMap(mapDoc) {
    if (!useSqlite()) return legacySaveMap(mapDoc);
    bootstrapSqliteFromLegacy();

    const summary = sqliteMaps.saveMap(mapDoc);
    const index = sqliteMaps.getIndex();
    if (!index.activeMapId) {
        sqliteMaps.setActiveMapId(summary.mapId);
    }

    if (EXPORT_COMPAT_JSON) {
        legacySaveMap(mapDoc);
    }
    return summary;
}

function getMap(mapId) {
    if (!useSqlite()) return legacyGetMap(mapId);
    bootstrapSqliteFromLegacy();
    return sqliteMaps.getMap(mapId);
}

function listMapSummaries() {
    if (!useSqlite()) return legacyListMapSummaries();
    bootstrapSqliteFromLegacy();
    return sqliteMaps.listMapSummaries();
}

function getLatestMap() {
    if (!useSqlite()) return legacyGetLatestMap();
    bootstrapSqliteFromLegacy();
    return sqliteMaps.getLatestMap();
}

function promoteMap(mapId) {
    if (!useSqlite()) return legacyPromoteMap(mapId);
    bootstrapSqliteFromLegacy();

    const summary = sqliteMaps.promoteMap(mapId);
    if (summary && EXPORT_COMPAT_JSON) {
        const mapDoc = sqliteMaps.getMap(mapId);
        if (mapDoc) {
            legacySaveMap(mapDoc);
        }
        legacyPromoteMap(mapId);
    }
    return summary;
}

function loadJobs() {
    if (!useSqlite()) return legacyLoadJobs();
    bootstrapSqliteFromLegacy();
    return sqliteJobs.list();
}

function saveJobs(jobs) {
    if (!useSqlite()) return legacySaveJobs(jobs);
    bootstrapSqliteFromLegacy();

    const sorted = sqliteJobs.replaceAll(jobs);
    if (EXPORT_COMPAT_JSON) {
        legacySaveJobs(sorted);
    }
    return sorted;
}

module.exports = {
    MAPS_DIR,
    INDEX_FILE,
    JOBS_FILE,
    ensureStorage,
    getIndex,
    saveIndex,
    saveMap,
    getMap,
    listMapSummaries,
    getLatestMap,
    promoteMap,
    loadJobs,
    saveJobs,
    bootstrapFromLegacy
};

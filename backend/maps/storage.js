const path = require('path');
const { MetadataSqliteStore } = require('../src/infrastructure/sqlite/metadata-sqlite-store');
const { SqliteMapVersionRepository } = require('../src/infrastructure/sqlite/sqlite-map-version-repository');
const { SqliteMapJobRepository } = require('../src/infrastructure/sqlite/sqlite-map-job-repository');
const { createLegacyJsonAdapter } = require('./legacy-json-adapter');
const { resolveMapPersistenceFlags } = require('./persistence-flags');
const { DEFAULT_INDEX } = require('./defaults');

const MAPS_DIR = process.env.MAPS_DATA_DIR
    ? path.resolve(process.env.MAPS_DATA_DIR)
    : path.join(__dirname, '..', 'data', 'maps');
const legacyAdapter = createLegacyJsonAdapter({
    mapsDir: MAPS_DIR,
    defaultIndex: DEFAULT_INDEX,
    defaultCorrections: {}
});

const mapPersistenceFlags = resolveMapPersistenceFlags();
const METADATA_DRIVER = mapPersistenceFlags.metadataDriver;
const SQLITE_DB_PATH = process.env.METADATA_SQLITE_PATH || path.join(MAPS_DIR, 'metadata.db');
const EXPORT_COMPAT_JSON = mapPersistenceFlags.exportCompatJson;

let sqliteStore = null;
let sqliteMaps = null;
let sqliteJobs = null;
let sqliteBootstrapped = false;

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

function legacyGetIndex() {
    const raw = legacyAdapter.readIndex({ ensure: true });
    const maps = Array.isArray(raw?.maps) ? raw.maps : [];
    return {
        schemaVersion: raw?.schemaVersion || '1.0',
        activeMapId: raw?.activeMapId || null,
        maps: maps.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    };
}

function legacySaveIndex(index) {
    const next = {
        schemaVersion: index?.schemaVersion || '1.0',
        activeMapId: index?.activeMapId || null,
        maps: Array.isArray(index?.maps) ? index.maps : []
    };
    legacyAdapter.writeIndex(next);
    return next;
}

function legacySaveMap(mapDoc) {
    legacyAdapter.writeMap(mapDoc);

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
    return legacyAdapter.readMap(mapId, null);
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
    const jobs = legacyAdapter.readJobs({ ensure: true });
    return jobs.sort((a, b) => Number(b.requestedAt || 0) - Number(a.requestedAt || 0));
}

function legacySaveJobs(jobs) {
    const safeJobs = Array.isArray(jobs) ? jobs : [];
    const sorted = [...safeJobs].sort((a, b) => Number(b.requestedAt || 0) - Number(a.requestedAt || 0));
    legacyAdapter.writeJobs(sorted);
    return sorted;
}

function bootstrapSqliteFromLegacy({ force = false } = {}) {
    if (!useSqlite()) return;
    ensureSqliteRepositories();
    if (sqliteBootstrapped) return;
    if (!force) return;

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

const fs = require('fs');
const path = require('path');

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

function getIndex() {
    ensureStorage();
    const raw = readJsonSafe(INDEX_FILE, DEFAULT_INDEX);
    const maps = Array.isArray(raw?.maps) ? raw.maps : [];
    return {
        schemaVersion: raw?.schemaVersion || '1.0',
        activeMapId: raw?.activeMapId || null,
        maps: maps.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    };
}

function saveIndex(index) {
    ensureStorage();
    const next = {
        schemaVersion: index?.schemaVersion || '1.0',
        activeMapId: index?.activeMapId || null,
        maps: Array.isArray(index?.maps) ? index.maps : []
    };
    writeJsonAtomic(INDEX_FILE, next);
    return next;
}

function getMapPath(mapId) {
    return path.join(MAPS_DIR, `${mapId}.json`);
}

function saveMap(mapDoc) {
    ensureStorage();
    if (!mapDoc || !mapDoc.mapId) {
        throw new Error('mapDoc/mapId is required');
    }

    const mapPath = getMapPath(mapDoc.mapId);
    writeJsonAtomic(mapPath, mapDoc);

    const summary = toSummary(mapDoc);
    const index = getIndex();
    const withoutCurrent = index.maps.filter((m) => m.mapId !== summary.mapId);
    const nextMaps = [summary, ...withoutCurrent].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

    const nextIndex = {
        ...index,
        maps: nextMaps,
        activeMapId: index.activeMapId || summary.mapId
    };
    saveIndex(nextIndex);
    return summary;
}

function getMap(mapId) {
    ensureStorage();
    if (!mapId) return null;
    const filePath = getMapPath(mapId);
    return readJsonSafe(filePath, null);
}

function listMapSummaries() {
    return getIndex().maps;
}

function getLatestMap() {
    const index = getIndex();
    if (index.activeMapId) {
        const active = getMap(index.activeMapId);
        if (active) return active;
    }
    const latest = index.maps[0];
    if (!latest) return null;
    return getMap(latest.mapId);
}

function promoteMap(mapId) {
    const doc = getMap(mapId);
    if (!doc) return null;
    const index = getIndex();
    index.activeMapId = mapId;
    saveIndex(index);
    return toSummary(doc);
}

function loadJobs() {
    ensureStorage();
    const jobs = readJsonSafe(JOBS_FILE, []);
    if (!Array.isArray(jobs)) return [];
    return jobs.sort((a, b) => Number(b.requestedAt || 0) - Number(a.requestedAt || 0));
}

function saveJobs(jobs) {
    ensureStorage();
    const safeJobs = Array.isArray(jobs) ? jobs : [];
    const sorted = [...safeJobs].sort((a, b) => Number(b.requestedAt || 0) - Number(a.requestedAt || 0));
    writeJsonAtomic(JOBS_FILE, sorted);
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
    saveJobs
};

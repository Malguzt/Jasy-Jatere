const { MetadataSqliteStore } = require('../src/infrastructure/sqlite/metadata-sqlite-store');
const { SqliteMapCorrectionsRepository } = require('../src/infrastructure/sqlite/sqlite-map-corrections-repository');
const { createLegacyJsonAdapter } = require('./legacy-json-adapter');
const { DEFAULT_INDEX, DEFAULT_CORRECTIONS } = require('./defaults');
const { resolveMapsRuntimeConfig } = require('./runtime-config');

function resolveCorrectionsConfig(options = {}) {
    const runtimeResolved = resolveMapsRuntimeConfig({
        runtimeFlags: options.runtimeFlags,
        env: options.env,
        mapPersistenceFlags: options.mapPersistenceFlags
    });

    return {
        mapsDir: options.mapsDir || options.mapsStorage?.MAPS_DIR || runtimeResolved.mapsDir,
        metadataDriver: options.metadataDriver || runtimeResolved.metadataDriver,
        metadataSqlitePath: options.metadataSqlitePath || runtimeResolved.metadataSqlitePath,
        exportCompatJson: options.exportCompatJson === true || runtimeResolved.exportCompatJson === true,
        maxHistory: Number.isInteger(Number(options.maxHistory)) && Number(options.maxHistory) > 0
            ? Number(options.maxHistory)
            : runtimeResolved.mapCorrectionHistoryLimit
    };
}

function createMapCorrections(options = {}) {
    const config = resolveCorrectionsConfig(options);
    const legacyAdapter = createLegacyJsonAdapter({
        mapsDir: config.mapsDir,
        defaultIndex: DEFAULT_INDEX,
        defaultCorrections: DEFAULT_CORRECTIONS
    });

    let sqliteStore = null;
    let sqliteCorrections = null;
    let sqliteBootstrapped = false;

    function useSqlite() {
        return config.metadataDriver === 'sqlite';
    }

    function ensureSqliteRepository() {
        if (!useSqlite()) return;
        if (sqliteCorrections) return;
        sqliteStore = sqliteStore || new MetadataSqliteStore({ dbPath: config.metadataSqlitePath });
        sqliteStore.migrate();
        sqliteCorrections = new SqliteMapCorrectionsRepository({ store: sqliteStore });
    }

    function sanitizeCorrections(data) {
        return {
            schemaVersion: data?.schemaVersion || '1.0',
            updatedAt: data?.updatedAt || Date.now(),
            lastManualMapId: data?.lastManualMapId || null,
            manualCameraLayout: Array.isArray(data?.manualCameraLayout) ? data.manualCameraLayout : [],
            objectHints: Array.isArray(data?.objectHints) ? data.objectHints : [],
            history: Array.isArray(data?.history) ? data.history.slice(0, Math.max(1, config.maxHistory)) : []
        };
    }

    function legacyReadCorrections() {
        try {
            const raw = legacyAdapter.readCorrections({ ensure: true });
            if (!raw || typeof raw !== 'object') return { ...DEFAULT_CORRECTIONS };
            return sanitizeCorrections(raw);
        } catch (error) {
            return { ...DEFAULT_CORRECTIONS };
        }
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
        if (!force) return;

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
        if (!useSqlite() || config.exportCompatJson) {
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
                const confidence = Number(object.confidence);
                const sourceCameraId = Array.isArray(object.sources) && object.sources.length > 0
                    ? String(object.sources[0])
                    : (object.cameraId ? String(object.cameraId) : null);
                const next = {
                    label,
                    category: String(object.category || 'estructura'),
                    confidence: Number.isFinite(confidence)
                        ? Number(Math.max(0.05, Math.min(0.99, confidence)).toFixed(2))
                        : 0.75,
                    cameraId: sourceCameraId
                };
                if (Number.isFinite(x)) next.x = Number(x.toFixed(2));
                if (Number.isFinite(y)) next.y = Number(y.toFixed(2));
                return next;
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
            ].slice(0, Math.max(1, config.maxHistory))
        };
        return writeCorrections(next);
    }

    function saveReusableCorrections({
        manualCameraLayout,
        objectHints
    } = {}) {
        const current = readCorrections();
        const nextLayout = Array.isArray(manualCameraLayout)
            ? toCameraLayout(manualCameraLayout)
            : (Array.isArray(current.manualCameraLayout) ? current.manualCameraLayout : []);
        const nextObjectHints = Array.isArray(objectHints)
            ? toObjectHints(objectHints)
            : (Array.isArray(current.objectHints) ? current.objectHints : []);

        const next = {
            ...current,
            updatedAt: Date.now(),
            manualCameraLayout: nextLayout,
            objectHints: nextObjectHints,
            history: [
                {
                    mapId: current.lastManualMapId || null,
                    ts: Date.now(),
                    cameras: nextLayout.length,
                    objects: nextObjectHints.length,
                    type: 'corrections'
                },
                ...(Array.isArray(current.history) ? current.history : [])
            ].slice(0, Math.max(1, config.maxHistory))
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

    return {
        readCorrections,
        writeCorrections,
        upsertFromManualMap,
        saveReusableCorrections,
        getHintsForGeneration,
        bootstrapFromLegacy
    };
}

function createMapCorrectionsFromRuntimeFlags({
    runtimeFlags = {},
    mapsStorage = null,
    env
} = {}) {
    return createMapCorrections({
        runtimeFlags,
        mapsStorage,
        env
    });
}

function createDefaultCorrections() {
    const mapsStorage = require('./storage');
    return createMapCorrectionsFromRuntimeFlags({ mapsStorage });
}

const defaultCorrections = createDefaultCorrections();

module.exports = defaultCorrections;
module.exports.createMapCorrections = createMapCorrections;
module.exports.createMapCorrectionsFromRuntimeFlags = createMapCorrectionsFromRuntimeFlags;

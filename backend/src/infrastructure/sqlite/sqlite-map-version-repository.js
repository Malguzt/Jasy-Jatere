const { MetadataSqliteStore } = require('./metadata-sqlite-store');

const ACTIVE_MAP_STATE_KEY = 'maps.activeMapId';

function parseSafeJson(raw, fallback = null) {
    try {
        const parsed = JSON.parse(raw);
        return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (error) {
        return fallback;
    }
}

function toSummary(mapDoc = {}) {
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

class SqliteMapVersionRepository {
    constructor({ store = new MetadataSqliteStore() } = {}) {
        this.store = store;
    }

    count() {
        const db = this.store.getDb();
        return Number(db.prepare('SELECT COUNT(*) AS total FROM map_versions').get()?.total || 0);
    }

    listMapSummaries() {
        const db = this.store.getDb();
        const rows = db
            .prepare('SELECT payload_json FROM map_versions ORDER BY created_at DESC, updated_at DESC')
            .all();

        return rows
            .map((row) => parseSafeJson(row.payload_json))
            .filter((doc) => doc && typeof doc === 'object' && doc.mapId)
            .map((doc) => toSummary(doc));
    }

    saveMap(mapDoc = {}) {
        const mapId = String(mapDoc?.mapId || '').trim();
        if (!mapId) {
            throw new Error('mapDoc/mapId is required');
        }

        const db = this.store.getDb();
        const now = Date.now();
        const normalized = {
            ...mapDoc,
            mapId,
            createdAt: Number.isFinite(Number(mapDoc?.createdAt)) ? Number(mapDoc.createdAt) : now,
            updatedAt: Number.isFinite(Number(mapDoc?.updatedAt)) ? Number(mapDoc.updatedAt) : now
        };

        db.prepare(`
            INSERT INTO map_versions(map_id, created_at, updated_at, payload_json)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(map_id) DO UPDATE SET
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                payload_json = excluded.payload_json
        `).run(
            mapId,
            normalized.createdAt,
            normalized.updatedAt,
            JSON.stringify(normalized)
        );

        return toSummary(normalized);
    }

    getMap(mapId) {
        const safeMapId = String(mapId || '').trim();
        if (!safeMapId) return null;
        const db = this.store.getDb();
        const row = db
            .prepare('SELECT payload_json FROM map_versions WHERE map_id = ?')
            .get(safeMapId);
        if (!row) return null;
        return parseSafeJson(row.payload_json, null);
    }

    getActiveMapId() {
        const db = this.store.getDb();
        const row = db
            .prepare('SELECT value_json FROM control_plane_state WHERE state_key = ?')
            .get(ACTIVE_MAP_STATE_KEY);
        if (!row) return null;
        const value = parseSafeJson(row.value_json, null);
        return value ? String(value) : null;
    }

    setActiveMapId(mapId) {
        const safeMapId = mapId === null || mapId === undefined || mapId === ''
            ? null
            : String(mapId);
        const db = this.store.getDb();
        const now = Date.now();

        db.prepare(`
            INSERT INTO control_plane_state(state_key, value_json, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(state_key) DO UPDATE SET
                value_json = excluded.value_json,
                updated_at = excluded.updated_at
        `).run(
            ACTIVE_MAP_STATE_KEY,
            JSON.stringify(safeMapId),
            now
        );

        return safeMapId;
    }

    getIndex() {
        return {
            schemaVersion: '1.0',
            activeMapId: this.getActiveMapId(),
            maps: this.listMapSummaries()
        };
    }

    getLatestMap() {
        const activeMapId = this.getActiveMapId();
        if (activeMapId) {
            const active = this.getMap(activeMapId);
            if (active) return active;
        }

        const db = this.store.getDb();
        const row = db
            .prepare('SELECT payload_json FROM map_versions ORDER BY created_at DESC, updated_at DESC LIMIT 1')
            .get();
        if (!row) return null;
        return parseSafeJson(row.payload_json, null);
    }

    promoteMap(mapId) {
        const doc = this.getMap(mapId);
        if (!doc) return null;
        this.setActiveMapId(doc.mapId);
        return toSummary(doc);
    }
}

module.exports = {
    SqliteMapVersionRepository
};

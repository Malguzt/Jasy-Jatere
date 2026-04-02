const { MetadataSqliteStore } = require('./metadata-sqlite-store');

const GLOBAL_HEALTH_SNAPSHOT_ID = '__global__';

function parseSafeJson(raw, fallback = null) {
    try {
        const parsed = JSON.parse(raw);
        return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (error) {
        return fallback;
    }
}

class SqliteHealthSnapshotRepository {
    constructor({ store = new MetadataSqliteStore() } = {}) {
        this.store = store;
    }

    getLatest() {
        const db = this.store.getDb();
        const row = db
            .prepare('SELECT payload_json FROM health_snapshots WHERE camera_id = ?')
            .get(GLOBAL_HEALTH_SNAPSHOT_ID);
        if (!row) return null;
        return parseSafeJson(row.payload_json, null);
    }

    save(snapshot = {}) {
        if (!snapshot || typeof snapshot !== 'object') return null;
        const db = this.store.getDb();
        const now = Date.now();
        db.prepare(`
            INSERT INTO health_snapshots(camera_id, payload_json, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(camera_id) DO UPDATE SET
                payload_json = excluded.payload_json,
                updated_at = excluded.updated_at
        `).run(GLOBAL_HEALTH_SNAPSHOT_ID, JSON.stringify(snapshot), now);
        return snapshot;
    }
}

module.exports = {
    SqliteHealthSnapshotRepository,
    GLOBAL_HEALTH_SNAPSHOT_ID
};

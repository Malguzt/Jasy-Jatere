const { MetadataSqliteStore } = require('./metadata-sqlite-store');

function parseSafeJson(raw) {
    try {
        return JSON.parse(raw);
    } catch (error) {
        return null;
    }
}

function eventTimestamp(entry = {}) {
    const parsed = Date.parse(entry?.event_time || entry?.recording_started_at || entry?.created_at || '');
    if (!Number.isFinite(parsed)) return 0;
    return parsed;
}

class SqliteRecordingCatalogRepository {
    constructor({ store = new MetadataSqliteStore() } = {}) {
        this.store = store;
    }

    list() {
        const db = this.store.getDb();
        const rows = db
            .prepare('SELECT payload_json FROM recordings_catalog ORDER BY event_ts DESC, updated_at DESC')
            .all();
        return rows.map((row) => parseSafeJson(row.payload_json)).filter(Boolean);
    }

    upsert(entry = {}) {
        const filename = String(entry?.filename || '').trim();
        if (!filename) return null;
        const db = this.store.getDb();
        const now = Date.now();
        const eventTs = eventTimestamp(entry);
        db.prepare(`
            INSERT INTO recordings_catalog(filename, event_ts, payload_json, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(filename) DO UPDATE SET
                event_ts = excluded.event_ts,
                payload_json = excluded.payload_json,
                updated_at = excluded.updated_at
        `).run(filename, eventTs, JSON.stringify(entry), now);
        return entry;
    }

    remove(filename) {
        const safe = String(filename || '').trim();
        if (!safe) return false;
        const db = this.store.getDb();
        const info = db.prepare('DELETE FROM recordings_catalog WHERE filename = ?').run(safe);
        return Number(info?.changes || 0) > 0;
    }
}

module.exports = {
    SqliteRecordingCatalogRepository
};

const { MetadataSqliteStore } = require('./metadata-sqlite-store');

function parseSafeJson(raw, fallback = null) {
    try {
        const parsed = JSON.parse(raw);
        return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (error) {
        return fallback;
    }
}

class SqliteMapCorrectionsRepository {
    constructor({ store = new MetadataSqliteStore() } = {}) {
        this.store = store;
    }

    exists() {
        const db = this.store.getDb();
        return Number(db.prepare('SELECT COUNT(*) AS total FROM map_manual_corrections').get()?.total || 0) > 0;
    }

    read(defaultValue = null) {
        const db = this.store.getDb();
        const row = db
            .prepare('SELECT payload_json FROM map_manual_corrections WHERE id = 1')
            .get();
        if (!row) return defaultValue;
        return parseSafeJson(row.payload_json, defaultValue);
    }

    write(payload = {}) {
        const db = this.store.getDb();
        const now = Date.now();
        db.prepare(`
            INSERT INTO map_manual_corrections(id, updated_at, payload_json)
            VALUES (1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                updated_at = excluded.updated_at,
                payload_json = excluded.payload_json
        `).run(now, JSON.stringify(payload));
        return payload;
    }
}

module.exports = {
    SqliteMapCorrectionsRepository
};

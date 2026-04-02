const { MetadataSqliteStore } = require('./metadata-sqlite-store');

function parseSafeJson(raw) {
    try {
        return JSON.parse(raw);
    } catch (error) {
        return null;
    }
}

function eventTimestamp(event = {}) {
    const parsed = Date.parse(event?.timestamp || event?.event_time || event?.created_at || '');
    if (!Number.isFinite(parsed)) return Date.now();
    return parsed;
}

class SqliteObservationEventRepository {
    constructor({
        store = new MetadataSqliteStore(),
        maxEntries = Number(process.env.OBSERVATION_MAX_ENTRIES || 2500)
    } = {}) {
        this.store = store;
        this.maxEntries = Number.isFinite(Number(maxEntries)) ? Math.max(100, Number(maxEntries)) : 2500;
    }

    list(limit = null) {
        const db = this.store.getDb();
        const safeLimit = limit === null || limit === undefined
            ? this.maxEntries
            : Math.max(1, Math.min(this.maxEntries, Number(limit) || 1));
        const rows = db
            .prepare('SELECT payload_json FROM observation_events ORDER BY event_ts DESC, id DESC LIMIT ?')
            .all(safeLimit);
        return rows
            .map((row) => parseSafeJson(row.payload_json))
            .filter(Boolean)
            .reverse();
    }

    append(event = {}) {
        if (!event || typeof event !== 'object') return null;
        const db = this.store.getDb();
        const now = Date.now();
        db.prepare(`
            INSERT INTO observation_events(event_ts, payload_json, created_at)
            VALUES (?, ?, ?)
        `).run(eventTimestamp(event), JSON.stringify(event), now);

        const overflow = db.prepare('SELECT COUNT(*) AS total FROM observation_events').get()?.total || 0;
        const excess = Math.max(0, overflow - this.maxEntries);
        if (excess > 0) {
            db.prepare(`
                DELETE FROM observation_events
                WHERE id IN (
                    SELECT id
                    FROM observation_events
                    ORDER BY event_ts ASC, id ASC
                    LIMIT ?
                )
            `).run(excess);
        }
        return event;
    }
}

module.exports = {
    SqliteObservationEventRepository
};

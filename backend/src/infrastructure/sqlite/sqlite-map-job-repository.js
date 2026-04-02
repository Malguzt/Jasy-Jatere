const { MetadataSqliteStore } = require('./metadata-sqlite-store');

function parseSafeJson(raw, fallback = null) {
    try {
        const parsed = JSON.parse(raw);
        return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (error) {
        return fallback;
    }
}

function sortByRequestedAtDesc(jobs = []) {
    return [...jobs].sort((a, b) => Number(b?.requestedAt || 0) - Number(a?.requestedAt || 0));
}

class SqliteMapJobRepository {
    constructor({ store = new MetadataSqliteStore() } = {}) {
        this.store = store;
    }

    count() {
        const db = this.store.getDb();
        return Number(db.prepare('SELECT COUNT(*) AS total FROM map_jobs').get()?.total || 0);
    }

    list(limit = null) {
        const db = this.store.getDb();
        const useLimit = Number.isFinite(Number(limit)) && Number(limit) > 0;
        const rows = useLimit
            ? db.prepare('SELECT payload_json FROM map_jobs ORDER BY requested_at DESC, updated_at DESC LIMIT ?').all(Number(limit))
            : db.prepare('SELECT payload_json FROM map_jobs ORDER BY requested_at DESC, updated_at DESC').all();

        return rows
            .map((row) => parseSafeJson(row.payload_json))
            .filter((job) => job && typeof job === 'object' && job.id);
    }

    replaceAll(jobs = []) {
        const normalized = sortByRequestedAtDesc(
            Array.isArray(jobs) ? jobs.filter((job) => job && typeof job === 'object' && job.id) : []
        );
        const db = this.store.getDb();
        const deleteStmt = db.prepare('DELETE FROM map_jobs');
        const insertStmt = db.prepare(`
            INSERT INTO map_jobs(job_id, requested_at, updated_at, payload_json)
            VALUES (?, ?, ?, ?)
        `);

        const tx = db.transaction((items) => {
            deleteStmt.run();
            const now = Date.now();
            items.forEach((job) => {
                insertStmt.run(
                    String(job.id),
                    Number.isFinite(Number(job.requestedAt)) ? Number(job.requestedAt) : now,
                    now,
                    JSON.stringify(job)
                );
            });
        });

        tx(normalized);
        return normalized;
    }
}

module.exports = {
    SqliteMapJobRepository
};

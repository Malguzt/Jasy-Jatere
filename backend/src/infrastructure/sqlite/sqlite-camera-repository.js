const { MetadataSqliteStore } = require('./metadata-sqlite-store');

class SqliteCameraRepository {
    constructor({ store = new MetadataSqliteStore() } = {}) {
        this.store = store;
    }

    list() {
        const db = this.store.getDb();
        const rows = db.prepare('SELECT payload_json FROM cameras ORDER BY updated_at DESC').all();
        return rows
            .map((row) => {
                try {
                    return JSON.parse(row.payload_json);
                } catch (error) {
                    return null;
                }
            })
            .filter(Boolean);
    }

    findById(cameraId) {
        const id = String(cameraId || '');
        if (!id) return null;
        const db = this.store.getDb();
        const row = db.prepare('SELECT payload_json FROM cameras WHERE id = ?').get(id);
        if (!row) return null;
        try {
            return JSON.parse(row.payload_json);
        } catch (error) {
            return null;
        }
    }

    replace(cameras = []) {
        const db = this.store.getDb();
        const normalized = Array.isArray(cameras)
            ? cameras.filter((camera) => camera && typeof camera === 'object' && camera.id !== undefined && camera.id !== null)
            : [];

        const clearStmt = db.prepare('DELETE FROM cameras');
        const insertStmt = db.prepare(
            'INSERT INTO cameras(id, payload_json, updated_at) VALUES (?, ?, ?)'
        );

        const tx = db.transaction((items) => {
            clearStmt.run();
            const now = Date.now();
            items.forEach((camera) => {
                insertStmt.run(String(camera.id), JSON.stringify(camera), now);
            });
        });

        tx(normalized);
        return normalized;
    }
}

module.exports = {
    SqliteCameraRepository
};

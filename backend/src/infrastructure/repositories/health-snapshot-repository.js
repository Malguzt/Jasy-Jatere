const path = require('path');
const { readJsonFile, writeJsonFile } = require('../metadata/json-file-store');
const { MetadataSqliteStore } = require('../sqlite/metadata-sqlite-store');
const { SqliteHealthSnapshotRepository } = require('../sqlite/sqlite-health-snapshot-repository');

const DEFAULT_FILE = path.join(__dirname, '..', '..', '..', 'data', 'metadata', 'health-snapshot.json');
const DEFAULT_DRIVER = 'sqlite';

function sqlitePathForFile(filePath) {
    if (!filePath || filePath === DEFAULT_FILE) return undefined;
    return `${filePath}.sqlite.db`;
}

class HealthSnapshotRepository {
    constructor({
        filePath = DEFAULT_FILE,
        driver = DEFAULT_DRIVER,
        sqliteStore = null
    } = {}) {
        this.filePath = filePath;
        this.driver = String(driver || 'sqlite').toLowerCase();
        this.writeJsonFile = this.driver !== 'sqlite';
        this.sqlite = this.driver === 'sqlite'
            ? new SqliteHealthSnapshotRepository({
                store: sqliteStore || new MetadataSqliteStore({
                    dbPath: sqlitePathForFile(filePath)
                })
            })
            : null;
    }

    readJsonSnapshot() {
        if (this.driver === 'sqlite') return null;
        const snapshot = readJsonFile(this.filePath, null);
        return snapshot && typeof snapshot === 'object' ? snapshot : null;
    }

    getLatest() {
        if (this.sqlite) {
            const snapshot = this.sqlite.getLatest();
            if (snapshot) return snapshot;
        }
        return this.readJsonSnapshot();
    }

    save(snapshot = {}) {
        const safeSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : null;
        if (!safeSnapshot) return null;

        if (this.sqlite) {
            this.sqlite.save(safeSnapshot);
        }
        if (this.writeJsonFile) {
            writeJsonFile(this.filePath, safeSnapshot);
        }
        return safeSnapshot;
    }
}

module.exports = {
    HealthSnapshotRepository,
    DEFAULT_FILE
};

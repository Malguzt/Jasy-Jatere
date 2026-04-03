const path = require('path');
const { readJsonFile, writeJsonFile } = require('../metadata/json-file-store');
const { SqliteObservationEventRepository } = require('../sqlite/sqlite-observation-event-repository');
const { MetadataSqliteStore } = require('../sqlite/metadata-sqlite-store');

const DEFAULT_FILE = path.join(__dirname, '..', '..', '..', 'data', 'metadata', 'observations.json');
const DEFAULT_DRIVER = process.env.METADATA_STORE_DRIVER || 'sqlite';

function sqlitePathForFile(filePath) {
    if (!filePath || filePath === DEFAULT_FILE) return undefined;
    return `${filePath}.sqlite.db`;
}

class ObservationEventRepository {
    constructor({
        filePath = DEFAULT_FILE,
        maxEntries = Number(process.env.OBSERVATION_MAX_ENTRIES || 2500),
        driver = DEFAULT_DRIVER,
        sqliteStore = null,
        dualWriteLegacy = true
    } = {}) {
        this.filePath = filePath;
        this.maxEntries = Number.isFinite(Number(maxEntries)) ? Math.max(100, Number(maxEntries)) : 2500;
        this.driver = String(driver || 'sqlite').toLowerCase();
        this.legacyCompatEnabled = this.driver === 'sqlite' ? false : true;
        this.sqlite = this.driver === 'sqlite'
            ? new SqliteObservationEventRepository({
                store: sqliteStore || new MetadataSqliteStore({
                    dbPath: sqlitePathForFile(filePath)
                }),
                maxEntries: this.maxEntries
            })
            : null;
    }

    readJsonEvents() {
        if (!this.legacyCompatEnabled) return [];
        const entries = readJsonFile(this.filePath, []);
        if (!Array.isArray(entries)) return [];
        return entries.filter((entry) => entry && typeof entry === 'object');
    }

    ensureSqliteBootstrapped() {
        if (!this.sqlite) return;
        const current = this.sqlite.list(1);
        if (current.length > 0) return;
        const legacy = this.readJsonEvents();
        legacy.forEach((entry) => this.sqlite.append(entry));
    }

    list(limit = null) {
        if (this.sqlite) {
            this.ensureSqliteBootstrapped();
            const rows = this.sqlite.list(limit);
            if (rows.length > 0) return rows;
            if (!this.legacyCompatEnabled) return [];
        }
        const normalized = this.readJsonEvents();
        if (limit === null || limit === undefined) return normalized;
        return normalized.slice(-Math.max(1, Number(limit) || 1));
    }

    append(event = {}) {
        const safeEvent = event && typeof event === 'object' ? event : null;
        if (!safeEvent) return null;
        if (this.sqlite) {
            this.sqlite.append(safeEvent);
        }
        if (this.legacyCompatEnabled) {
            const current = this.readJsonEvents();
            const next = [...current, safeEvent].slice(-this.maxEntries);
            writeJsonFile(this.filePath, next);
        }
        return safeEvent;
    }
}

module.exports = {
    ObservationEventRepository,
    DEFAULT_FILE
};

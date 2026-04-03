const fs = require('fs');
const path = require('path');
const { readJsonFile, writeJsonFile } = require('../metadata/json-file-store');
const { SqliteRecordingCatalogRepository } = require('../sqlite/sqlite-recording-catalog-repository');
const { MetadataSqliteStore } = require('../sqlite/metadata-sqlite-store');

const DEFAULT_PRIMARY_FILE = path.join(__dirname, '..', '..', '..', 'data', 'metadata', 'recordings-catalog.json');
const DEFAULT_LEGACY_FILE = path.join('/app', 'recordings', 'recordings-index.json');
const DEFAULT_DRIVER = process.env.METADATA_STORE_DRIVER || 'sqlite';

function sqlitePathForPrimary(primaryFile) {
    if (!primaryFile || primaryFile === DEFAULT_PRIMARY_FILE) return undefined;
    return `${primaryFile}.sqlite.db`;
}

function normalizeEntry(entry = {}) {
    if (!entry || typeof entry !== 'object') return null;
    const filename = String(entry.filename || '').trim();
    if (!filename) return null;
    return {
        ...entry,
        filename
    };
}

function sortByEventTimeDesc(entries = []) {
    return [...entries].sort((a, b) => {
        const aTs = Date.parse(a?.event_time || a?.recording_started_at || a?.created_at || '') || 0;
        const bTs = Date.parse(b?.event_time || b?.recording_started_at || b?.created_at || '') || 0;
        return bTs - aTs;
    });
}

class RecordingCatalogRepository {
    constructor({
        primaryFile = DEFAULT_PRIMARY_FILE,
        legacyFile = DEFAULT_LEGACY_FILE,
        driver = DEFAULT_DRIVER,
        sqliteStore = null,
        dualWritePrimary = true,
        dualWriteLegacy = true
    } = {}) {
        this.primaryFile = primaryFile;
        this.legacyFile = legacyFile;
        this.driver = String(driver || 'sqlite').toLowerCase();
        this.dualWritePrimary = this.driver === 'sqlite' ? dualWritePrimary === true : true;
        this.dualWriteLegacy = this.driver === 'sqlite' ? dualWriteLegacy === true : dualWriteLegacy !== false;
        this.sqlite = this.driver === 'sqlite'
            ? new SqliteRecordingCatalogRepository({
                store: sqliteStore || new MetadataSqliteStore({
                    dbPath: sqlitePathForPrimary(primaryFile)
                })
            })
            : null;
    }

    readJsonPrimaryOrLegacy() {
        if (fs.existsSync(this.primaryFile)) {
            const primary = readJsonFile(this.primaryFile, []);
            if (Array.isArray(primary)) {
                return sortByEventTimeDesc(primary.map((entry) => normalizeEntry(entry)).filter(Boolean));
            }
            return [];
        }
        if (this.driver === 'sqlite') return [];
        const legacy = readJsonFile(this.legacyFile, []);
        if (!Array.isArray(legacy)) return [];
        return sortByEventTimeDesc(legacy.map((entry) => normalizeEntry(entry)).filter(Boolean));
    }

    ensureSqliteBootstrapped() {
        if (!this.sqlite) return;
        const current = this.sqlite.list();
        if (current.length > 0) return;
        const legacy = this.readJsonPrimaryOrLegacy();
        legacy.forEach((entry) => {
            this.sqlite.upsert(entry);
        });
    }

    list() {
        if (this.sqlite) {
            this.ensureSqliteBootstrapped();
            const sqliteItems = this.sqlite.list();
            if (sqliteItems.length > 0) {
                return sortByEventTimeDesc(sqliteItems.map((entry) => normalizeEntry(entry)).filter(Boolean));
            }
        }
        return this.readJsonPrimaryOrLegacy();
    }

    upsert(entry = {}) {
        const normalized = normalizeEntry(entry);
        if (!normalized) return null;
        if (this.sqlite) {
            this.sqlite.upsert(normalized);
        }
        const existing = this.readJsonPrimaryOrLegacy().filter((item) => item.filename !== normalized.filename);
        const next = sortByEventTimeDesc([normalized, ...existing]);
        if (this.dualWritePrimary) {
            writeJsonFile(this.primaryFile, next);
        }
        if (this.dualWriteLegacy) {
            writeJsonFile(this.legacyFile, next);
        }
        return normalized;
    }

    remove(filename) {
        const safe = String(filename || '').trim();
        if (!safe) return false;
        if (this.sqlite) {
            this.sqlite.remove(safe);
        }
        const current = this.readJsonPrimaryOrLegacy();
        const next = current.filter((entry) => entry.filename !== safe);
        if (next.length === current.length) return false;
        if (this.dualWritePrimary) {
            writeJsonFile(this.primaryFile, next);
        }
        if (this.dualWriteLegacy) {
            writeJsonFile(this.legacyFile, next);
        }
        return true;
    }
}

module.exports = {
    RecordingCatalogRepository,
    DEFAULT_PRIMARY_FILE,
    DEFAULT_LEGACY_FILE
};

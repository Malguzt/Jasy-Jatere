const fs = require('fs');
const path = require('path');
const { readJsonFile, writeJsonFile } = require('../metadata/json-file-store');

const DEFAULT_PRIMARY_FILE = path.join(__dirname, '..', '..', '..', 'data', 'metadata', 'recordings-catalog.json');
const DEFAULT_LEGACY_FILE = path.join('/app', 'recordings', 'recordings-index.json');

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
        legacyFile = DEFAULT_LEGACY_FILE
    } = {}) {
        this.primaryFile = primaryFile;
        this.legacyFile = legacyFile;
    }

    list() {
        if (fs.existsSync(this.primaryFile)) {
            const primary = readJsonFile(this.primaryFile, []);
            return sortByEventTimeDesc(primary.map((entry) => normalizeEntry(entry)).filter(Boolean));
        }

        const legacy = readJsonFile(this.legacyFile, []);
        if (!Array.isArray(legacy)) return [];
        return sortByEventTimeDesc(legacy.map((entry) => normalizeEntry(entry)).filter(Boolean));
    }

    upsert(entry = {}) {
        const normalized = normalizeEntry(entry);
        if (!normalized) return null;
        const existing = this.list().filter((item) => item.filename !== normalized.filename);
        const next = sortByEventTimeDesc([normalized, ...existing]);
        writeJsonFile(this.primaryFile, next);
        writeJsonFile(this.legacyFile, next);
        return normalized;
    }

    remove(filename) {
        const safe = String(filename || '').trim();
        if (!safe) return false;
        const current = this.list();
        const next = current.filter((entry) => entry.filename !== safe);
        if (next.length === current.length) return false;
        writeJsonFile(this.primaryFile, next);
        writeJsonFile(this.legacyFile, next);
        return true;
    }
}

module.exports = {
    RecordingCatalogRepository,
    DEFAULT_PRIMARY_FILE,
    DEFAULT_LEGACY_FILE
};

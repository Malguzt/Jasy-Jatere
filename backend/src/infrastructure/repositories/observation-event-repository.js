const path = require('path');
const { readJsonFile, writeJsonFile } = require('../metadata/json-file-store');

const DEFAULT_FILE = path.join(__dirname, '..', '..', '..', 'data', 'metadata', 'observations.json');

class ObservationEventRepository {
    constructor({
        filePath = DEFAULT_FILE,
        maxEntries = Number(process.env.OBSERVATION_MAX_ENTRIES || 2500)
    } = {}) {
        this.filePath = filePath;
        this.maxEntries = Number.isFinite(Number(maxEntries)) ? Math.max(100, Number(maxEntries)) : 2500;
    }

    list(limit = null) {
        const entries = readJsonFile(this.filePath, []);
        if (!Array.isArray(entries)) return [];
        const normalized = entries.filter((entry) => entry && typeof entry === 'object');
        if (limit === null || limit === undefined) return normalized;
        const safeLimit = Math.max(1, Number(limit) || 1);
        return normalized.slice(-safeLimit);
    }

    append(event = {}) {
        const safeEvent = event && typeof event === 'object' ? event : null;
        if (!safeEvent) return null;
        const current = this.list();
        const next = [...current, safeEvent].slice(-this.maxEntries);
        writeJsonFile(this.filePath, next);
        return safeEvent;
    }
}

module.exports = {
    ObservationEventRepository,
    DEFAULT_FILE
};

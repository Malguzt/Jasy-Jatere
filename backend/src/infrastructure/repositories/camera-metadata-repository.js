const fs = require('fs');
const path = require('path');
const { readJsonFile, writeJsonFile } = require('../metadata/json-file-store');
const { SqliteCameraRepository } = require('../sqlite/sqlite-camera-repository');
const { MetadataSqliteStore } = require('../sqlite/metadata-sqlite-store');

const DEFAULT_PRIMARY_FILE = path.join(__dirname, '..', '..', '..', 'data', 'metadata', 'cameras.json');
const DEFAULT_LEGACY_FILE = path.join(__dirname, '..', '..', '..', 'data', 'cameras.json');
const DEFAULT_DRIVER = process.env.METADATA_STORE_DRIVER || 'sqlite';

function normalizeCameraList(value) {
    if (!Array.isArray(value)) return [];
    return value.filter((item) => item && typeof item === 'object' && item.id !== undefined && item.id !== null);
}

function sqlitePathForPrimary(primaryFile) {
    if (!primaryFile || primaryFile === DEFAULT_PRIMARY_FILE) return undefined;
    return `${primaryFile}.sqlite.db`;
}

class CameraMetadataRepository {
    constructor({
        primaryFile = DEFAULT_PRIMARY_FILE,
        legacyFile = DEFAULT_LEGACY_FILE,
        driver = DEFAULT_DRIVER,
        sqliteStore = null,
        dualWriteLegacy = true
    } = {}) {
        this.primaryFile = primaryFile;
        this.legacyFile = legacyFile;
        this.driver = String(driver || 'sqlite').toLowerCase();
        this.dualWriteLegacy = dualWriteLegacy !== false;
        this.sqlite = this.driver === 'sqlite'
            ? new SqliteCameraRepository({
                store: sqliteStore || new MetadataSqliteStore({
                    dbPath: sqlitePathForPrimary(primaryFile)
                })
            })
            : null;
    }

    readJsonPrimaryOrLegacy() {
        if (fs.existsSync(this.primaryFile)) {
            return normalizeCameraList(readJsonFile(this.primaryFile, []));
        }
        return normalizeCameraList(readJsonFile(this.legacyFile, []));
    }

    ensureSqliteBootstrapped() {
        if (!this.sqlite) return;
        const current = this.sqlite.list();
        if (current.length > 0) return;
        const legacy = this.readJsonPrimaryOrLegacy();
        if (legacy.length === 0) return;
        this.sqlite.replace(legacy);
    }

    list() {
        if (this.sqlite) {
            this.ensureSqliteBootstrapped();
            const sqliteItems = normalizeCameraList(this.sqlite.list());
            if (sqliteItems.length > 0) return sqliteItems;
        }
        return this.readJsonPrimaryOrLegacy();
    }

    findById(cameraId) {
        const id = String(cameraId || '');
        if (!id) return null;
        return this.list().find((camera) => String(camera.id) === id) || null;
    }

    replace(nextCameras = []) {
        const normalized = normalizeCameraList(nextCameras);
        if (this.sqlite) {
            this.sqlite.replace(normalized);
        }
        writeJsonFile(this.primaryFile, normalized);
        if (this.dualWriteLegacy) {
            writeJsonFile(this.legacyFile, normalized);
        }
        return normalized;
    }
}

module.exports = {
    CameraMetadataRepository,
    DEFAULT_PRIMARY_FILE,
    DEFAULT_LEGACY_FILE
};

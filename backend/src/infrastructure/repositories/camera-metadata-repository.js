const fs = require('fs');
const path = require('path');
const { readJsonFile, writeJsonFile } = require('../metadata/json-file-store');
const { SqliteCameraRepository } = require('../sqlite/sqlite-camera-repository');
const { MetadataSqliteStore } = require('../sqlite/metadata-sqlite-store');
const { createCameraCredentialCipher } = require('../../security/camera-credential-cipher');

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
        dualWritePrimary = true,
        dualWriteLegacy = true,
        credentialCipher = createCameraCredentialCipher()
    } = {}) {
        this.primaryFile = primaryFile;
        this.legacyFile = legacyFile;
        this.driver = String(driver || 'sqlite').toLowerCase();
        this.dualWritePrimary = this.driver === 'sqlite' ? false : true;
        this.dualWriteLegacy = this.driver === 'sqlite' ? false : dualWriteLegacy !== false;
        this.credentialCipher = credentialCipher;
        this.sqlite = this.driver === 'sqlite'
            ? new SqliteCameraRepository({
                store: sqliteStore || new MetadataSqliteStore({
                    dbPath: sqlitePathForPrimary(primaryFile)
                })
            })
            : null;
    }

    toRuntimeCamera(camera = {}) {
        const next = { ...camera };
        if (next.pass === undefined || next.pass === null || next.pass === '') {
            const decrypted = this.credentialCipher?.decrypt?.(next.passEnc);
            if (decrypted !== null && decrypted !== undefined) {
                next.pass = decrypted;
            }
        }
        delete next.passEnc;
        return next;
    }

    toPersistedCamera(camera = {}) {
        const next = { ...camera };
        const rawPass = next.pass !== undefined ? next.pass : next.password;

        if (this.credentialCipher?.isEnabled?.()) {
            const encrypted = this.credentialCipher.encrypt(rawPass);
            if (encrypted) {
                next.passEnc = encrypted;
                delete next.pass;
                delete next.password;
            }
        }
        return next;
    }

    toRuntimeCameraList(value) {
        return normalizeCameraList(value).map((camera) => this.toRuntimeCamera(camera));
    }

    toPersistedCameraList(value) {
        return normalizeCameraList(value).map((camera) => this.toPersistedCamera(camera));
    }

    readJsonPrimaryOrLegacy() {
        if (fs.existsSync(this.primaryFile)) {
            return this.toRuntimeCameraList(readJsonFile(this.primaryFile, []));
        }
        if (this.driver === 'sqlite') return [];
        return this.toRuntimeCameraList(readJsonFile(this.legacyFile, []));
    }

    list() {
        if (this.sqlite) {
            return this.toRuntimeCameraList(this.sqlite.list());
        }
        return this.readJsonPrimaryOrLegacy();
    }

    findById(cameraId) {
        const id = String(cameraId || '');
        if (!id) return null;
        return this.list().find((camera) => String(camera.id) === id) || null;
    }

    replace(nextCameras = []) {
        const normalized = this.toRuntimeCameraList(nextCameras);
        const persisted = this.toPersistedCameraList(normalized);
        if (this.sqlite) {
            this.sqlite.replace(persisted);
        }
        if (this.dualWritePrimary) {
            writeJsonFile(this.primaryFile, persisted);
        }
        if (this.dualWriteLegacy) {
            writeJsonFile(this.legacyFile, persisted);
        }
        return normalized;
    }
}

module.exports = {
    CameraMetadataRepository,
    DEFAULT_PRIMARY_FILE,
    DEFAULT_LEGACY_FILE
};

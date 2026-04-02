const fs = require('fs');
const path = require('path');
const { readJsonFile, writeJsonFile } = require('../metadata/json-file-store');

const DEFAULT_PRIMARY_FILE = path.join(__dirname, '..', '..', '..', 'data', 'metadata', 'cameras.json');
const DEFAULT_LEGACY_FILE = path.join(__dirname, '..', '..', '..', 'data', 'cameras.json');

function normalizeCameraList(value) {
    if (!Array.isArray(value)) return [];
    return value.filter((item) => item && typeof item === 'object' && item.id !== undefined && item.id !== null);
}

class CameraMetadataRepository {
    constructor({
        primaryFile = DEFAULT_PRIMARY_FILE,
        legacyFile = DEFAULT_LEGACY_FILE
    } = {}) {
        this.primaryFile = primaryFile;
        this.legacyFile = legacyFile;
    }

    list() {
        if (fs.existsSync(this.primaryFile)) {
            const primary = normalizeCameraList(readJsonFile(this.primaryFile, []));
            return primary;
        }

        // If the primary store is still empty, fall back to the legacy export.
        const legacy = normalizeCameraList(readJsonFile(this.legacyFile, []));
        return legacy;
    }

    findById(cameraId) {
        const id = String(cameraId || '');
        if (!id) return null;
        return this.list().find((camera) => String(camera.id) === id) || null;
    }

    replace(nextCameras = []) {
        const normalized = normalizeCameraList(nextCameras);
        writeJsonFile(this.primaryFile, normalized);
        writeJsonFile(this.legacyFile, normalized);
        return normalized;
    }
}

module.exports = {
    CameraMetadataRepository,
    DEFAULT_PRIMARY_FILE,
    DEFAULT_LEGACY_FILE
};

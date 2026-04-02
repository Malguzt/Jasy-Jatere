const { CameraMetadataRepository } = require('../../infrastructure/repositories/camera-metadata-repository');

function cameraInventoryError(status, message, code = null, details = null) {
    const error = new Error(message || 'Camera inventory error');
    error.status = status;
    if (code) error.code = code;
    if (details !== null && details !== undefined) error.details = details;
    return error;
}

class CameraInventoryService {
    constructor({ repository = new CameraMetadataRepository() } = {}) {
        this.repository = repository;
    }

    listCameras() {
        try {
            return this.repository.list();
        } catch (error) {
            throw cameraInventoryError(500, 'Failed to list cameras', 'CAMERA_LIST_FAILED', error?.message || error);
        }
    }

    findCamera(cameraId) {
        const id = String(cameraId || '').trim();
        if (!id) return null;
        try {
            return this.repository.findById(id);
        } catch (error) {
            throw cameraInventoryError(500, 'Failed to lookup camera', 'CAMERA_LOOKUP_FAILED', error?.message || error);
        }
    }
}

module.exports = {
    CameraInventoryService,
    cameraInventoryError
};

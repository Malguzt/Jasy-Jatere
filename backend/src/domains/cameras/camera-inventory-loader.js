const fs = require('fs');

function loadCameraInventory({
    cameraInventoryService = null,
    legacyFilePath = '',
    legacyFileFallbackEnabled = false,
    fsModule = fs,
    logger = console,
    serviceErrorPrefix = '[CAM] failed to load cameras from inventory service:',
    fileErrorPrefix = '[CAM] failed to load cameras file:'
} = {}) {
    if (cameraInventoryService && typeof cameraInventoryService.listCameras === 'function') {
        try {
            const cameras = cameraInventoryService.listCameras();
            if (Array.isArray(cameras)) return cameras;
            if (!legacyFileFallbackEnabled) return [];
        } catch (error) {
            logger.error(serviceErrorPrefix, error?.message || error);
            if (!legacyFileFallbackEnabled) return [];
        }
    }

    if (!legacyFileFallbackEnabled) return [];

    try {
        if (!legacyFilePath || !fsModule.existsSync(legacyFilePath)) return [];
        const payload = JSON.parse(fsModule.readFileSync(legacyFilePath, 'utf8'));
        return Array.isArray(payload) ? payload : [];
    } catch (error) {
        logger.error(fileErrorPrefix, error?.message || error);
        return [];
    }
}

function loadCameraById({
    cameraId,
    cameraInventoryService = null,
    legacyFilePath = '',
    legacyFileFallbackEnabled = false,
    fsModule = fs,
    logger = console,
    serviceErrorPrefix = '[CAM] failed to load camera from inventory service:',
    fileErrorPrefix = '[CAM] failed to load cameras file:'
} = {}) {
    const id = String(cameraId || '').trim();
    if (!id) {
        return { camera: null, reason: 'camera-not-found' };
    }

    if (cameraInventoryService && typeof cameraInventoryService.findCamera === 'function') {
        try {
            const camera = cameraInventoryService.findCamera(id);
            return { camera: camera || null, reason: camera ? null : 'camera-not-found' };
        } catch (error) {
            logger.error(serviceErrorPrefix, error?.message || error);
            if (!legacyFileFallbackEnabled) {
                return { camera: null, reason: 'inventory-unavailable' };
            }
        }
    }

    if (cameraInventoryService && typeof cameraInventoryService.listCameras === 'function') {
        try {
            const cameras = cameraInventoryService.listCameras();
            if (Array.isArray(cameras)) {
                const camera = cameras.find((item) => item?.id === id) || null;
                return { camera, reason: camera ? null : 'camera-not-found' };
            }
            if (!legacyFileFallbackEnabled) {
                return { camera: null, reason: 'inventory-unavailable' };
            }
        } catch (error) {
            logger.error(serviceErrorPrefix, error?.message || error);
            if (!legacyFileFallbackEnabled) {
                return { camera: null, reason: 'inventory-unavailable' };
            }
        }
    }

    if (!legacyFileFallbackEnabled) {
        return { camera: null, reason: 'inventory-unavailable' };
    }

    if (!legacyFilePath || !fsModule.existsSync(legacyFilePath)) {
        return { camera: null, reason: 'missing-camera-file' };
    }

    try {
        const payload = JSON.parse(fsModule.readFileSync(legacyFilePath, 'utf8'));
        if (!Array.isArray(payload)) {
            return { camera: null, reason: 'invalid-camera-file' };
        }
        const camera = payload.find((item) => item?.id === id) || null;
        return { camera, reason: camera ? null : 'camera-not-found' };
    } catch (error) {
        logger.error(fileErrorPrefix, error?.message || error);
        return { camera: null, reason: 'camera-file-read-error' };
    }
}

module.exports = {
    loadCameraInventory,
    loadCameraById
};

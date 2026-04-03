const fs = require('fs');

function loadCameraInventory({
    cameraInventoryService = null,
    legacyFilePath = '',
    legacyFileFallbackEnabled = true,
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

module.exports = {
    loadCameraInventory
};

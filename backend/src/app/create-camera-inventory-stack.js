const { CameraMetadataRepository } = require('../infrastructure/repositories/camera-metadata-repository');
const { CameraInventoryService } = require('../domains/cameras/camera-inventory-service');
const {
    buildLegacyFileFallbackOptions
} = require('./composition-options');

function createCameraInventoryStack({
    cameraFile,
    runtimeFlags,
    metadataDriver,
    sqliteStore
}) {
    const legacyFileFallbackOptions = buildLegacyFileFallbackOptions(runtimeFlags);

    const cameraRepository = new CameraMetadataRepository({
        legacyFile: cameraFile,
        driver: metadataDriver,
        sqliteStore
    });
    const cameraInventoryService = new CameraInventoryService({
        repository: cameraRepository
    });

    return {
        cameraRepository,
        cameraInventoryService,
        legacyFileFallbackOptions
    };
}

module.exports = {
    createCameraInventoryStack
};

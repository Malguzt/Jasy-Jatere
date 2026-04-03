const { CameraMetadataRepository } = require('../infrastructure/repositories/camera-metadata-repository');
const { CameraInventoryService } = require('../domains/cameras/camera-inventory-service');

function createCameraInventoryStack({
    metadataDriver,
    sqliteStore
}) {
    const cameraRepository = new CameraMetadataRepository({
        driver: metadataDriver,
        sqliteStore
    });
    const cameraInventoryService = new CameraInventoryService({
        repository: cameraRepository
    });

    return {
        cameraRepository,
        cameraInventoryService
    };
}

module.exports = {
    createCameraInventoryStack
};

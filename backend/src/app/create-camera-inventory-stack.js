const { CameraMetadataRepository } = require('../infrastructure/repositories/camera-metadata-repository');
const { CameraInventoryService } = require('../domains/cameras/camera-inventory-service');
const {
    buildRepositoryCompatOptions,
    buildLegacyFileFallbackOptions
} = require('./composition-options');

function createCameraInventoryStack({
    cameraFile,
    runtimeFlags,
    metadataDriver,
    sqliteStore
}) {
    const repositoryCompatOptions = buildRepositoryCompatOptions(runtimeFlags);
    const legacyFileFallbackOptions = buildLegacyFileFallbackOptions(runtimeFlags);

    const cameraRepository = new CameraMetadataRepository({
        legacyFile: cameraFile,
        driver: metadataDriver,
        sqliteStore,
        ...repositoryCompatOptions
    });
    const cameraInventoryService = new CameraInventoryService({
        repository: cameraRepository
    });

    return {
        cameraRepository,
        cameraInventoryService,
        repositoryCompatOptions,
        legacyFileFallbackOptions
    };
}

module.exports = {
    createCameraInventoryStack
};

const { CameraMetadataRepository } = require('../infrastructure/repositories/camera-metadata-repository');
const { CameraInventoryService } = require('../domains/cameras/camera-inventory-service');
const { createCameraCredentialCipher } = require('../security/camera-credential-cipher');

function createCameraInventoryStack({
    metadataDriver,
    sqliteStore,
    cameraCredentialsMasterKey = ''
}) {
    const credentialCipher = createCameraCredentialCipher({
        masterKey: cameraCredentialsMasterKey
    });
    const cameraRepository = new CameraMetadataRepository({
        driver: metadataDriver,
        sqliteStore,
        credentialCipher
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

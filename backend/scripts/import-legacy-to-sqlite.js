const fs = require('fs');
const path = require('path');
const { CameraMetadataRepository } = require('../src/infrastructure/repositories/camera-metadata-repository');
const { RecordingCatalogRepository } = require('../src/infrastructure/repositories/recording-catalog-repository');
const { ObservationEventRepository } = require('../src/infrastructure/repositories/observation-event-repository');
const { HealthSnapshotRepository } = require('../src/infrastructure/repositories/health-snapshot-repository');
const mapStorage = require('../maps/storage');
const mapCorrections = require('../maps/corrections');

const camerasPath = path.join(__dirname, '..', 'data', 'cameras.json');
const recordingsPath = path.join('/app', 'recordings', 'recordings-index.json');
const observationsPath = path.join(__dirname, '..', 'data', 'metadata', 'observations.json');
const healthSnapshotPath = path.join(__dirname, '..', 'data', 'metadata', 'health-snapshot.json');

function readArraySafe(filePath) {
    try {
        if (!fs.existsSync(filePath)) return [];
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        return [];
    }
}

function readObjectSafe(filePath) {
    try {
        if (!fs.existsSync(filePath)) return null;
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (error) {
        return null;
    }
}

function run() {
    const cameraRepo = new CameraMetadataRepository({ driver: 'sqlite' });
    const recordingRepo = new RecordingCatalogRepository({ driver: 'sqlite' });
    const observationRepo = new ObservationEventRepository({ driver: 'sqlite' });
    const healthRepo = new HealthSnapshotRepository({ driver: 'sqlite' });

    const cameras = readArraySafe(camerasPath);
    const recordings = readArraySafe(recordingsPath);
    const observations = readArraySafe(observationsPath);
    const healthSnapshot = readObjectSafe(healthSnapshotPath);

    if (cameras.length > 0) cameraRepo.replace(cameras);
    recordings.forEach((entry) => recordingRepo.upsert(entry));
    observations.forEach((entry) => observationRepo.append(entry));
    if (healthSnapshot) healthRepo.save(healthSnapshot);

    // Trigger map/corrections bootstrap from legacy JSON files.
    const mapsIndex = mapStorage.getIndex();
    const mapJobs = mapStorage.loadJobs();
    const corrections = mapCorrections.readCorrections();

    // eslint-disable-next-line no-console
    console.log(
        `metadata-db import complete: cameras=${cameras.length} recordings=${recordings.length} observations=${observations.length} maps=${mapsIndex.maps.length} mapJobs=${mapJobs.length} correctionsHistory=${Array.isArray(corrections.history) ? corrections.history.length : 0} health=${healthSnapshot ? 1 : 0}`
    );
}

try {
    run();
} catch (error) {
    // eslint-disable-next-line no-console
    console.error(`metadata-db import failed: ${error?.message || error}`);
    process.exit(1);
}

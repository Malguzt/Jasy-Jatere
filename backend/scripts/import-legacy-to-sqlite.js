const fs = require('fs');
const path = require('path');
const { CameraMetadataRepository } = require('../src/infrastructure/repositories/camera-metadata-repository');
const { RecordingCatalogRepository } = require('../src/infrastructure/repositories/recording-catalog-repository');
const { ObservationEventRepository } = require('../src/infrastructure/repositories/observation-event-repository');
const { HealthSnapshotRepository } = require('../src/infrastructure/repositories/health-snapshot-repository');
const mapStorage = require('../maps/storage');
const mapCorrections = require('../maps/corrections');

const DEFAULT_PATHS = {
    camerasPath: path.join(__dirname, '..', 'data', 'cameras.json'),
    recordingsPath: path.join('/app', 'recordings', 'recordings-index.json'),
    observationsPath: path.join(__dirname, '..', 'data', 'metadata', 'observations.json'),
    healthSnapshotPath: path.join(__dirname, '..', 'data', 'metadata', 'health-snapshot.json')
};

function readArraySafe(filePath, fsModule = fs) {
    try {
        if (!fsModule.existsSync(filePath)) return [];
        const parsed = JSON.parse(fsModule.readFileSync(filePath, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        return [];
    }
}

function readObjectSafe(filePath, fsModule = fs) {
    try {
        if (!fsModule.existsSync(filePath)) return null;
        const parsed = JSON.parse(fsModule.readFileSync(filePath, 'utf8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (error) {
        return null;
    }
}

function run({
    paths = {},
    repositories = {},
    mapAdapters = {},
    fsModule = fs,
    logger = console
} = {}) {
    const resolvedPaths = {
        ...DEFAULT_PATHS,
        ...(paths || {})
    };
    const injectedRepositories = repositories || {};
    const cameraRepo = injectedRepositories.cameraRepo || new CameraMetadataRepository({ driver: 'sqlite' });
    const recordingRepo = injectedRepositories.recordingRepo || new RecordingCatalogRepository({ driver: 'sqlite' });
    const observationRepo = injectedRepositories.observationRepo || new ObservationEventRepository({ driver: 'sqlite' });
    const healthRepo = injectedRepositories.healthRepo || new HealthSnapshotRepository({ driver: 'sqlite' });
    const resolvedMapStorage = mapAdapters.mapStorage || mapStorage;
    const resolvedMapCorrections = mapAdapters.mapCorrections || mapCorrections;

    const cameras = readArraySafe(resolvedPaths.camerasPath, fsModule);
    const recordings = readArraySafe(resolvedPaths.recordingsPath, fsModule);
    const observations = readArraySafe(resolvedPaths.observationsPath, fsModule);
    const healthSnapshot = readObjectSafe(resolvedPaths.healthSnapshotPath, fsModule);

    if (cameras.length > 0) cameraRepo.replace(cameras);
    recordings.forEach((entry) => recordingRepo.upsert(entry));
    observations.forEach((entry) => observationRepo.append(entry));
    if (healthSnapshot) healthRepo.save(healthSnapshot);

    // Trigger map/corrections bootstrap from legacy JSON files.
    const mapsIndex = resolvedMapStorage.getIndex();
    const mapJobs = resolvedMapStorage.loadJobs();
    const corrections = resolvedMapCorrections.readCorrections();

    const summary = {
        cameras: cameras.length,
        recordings: recordings.length,
        observations: observations.length,
        maps: Array.isArray(mapsIndex?.maps) ? mapsIndex.maps.length : 0,
        mapJobs: Array.isArray(mapJobs) ? mapJobs.length : 0,
        correctionsHistory: Array.isArray(corrections?.history) ? corrections.history.length : 0,
        health: healthSnapshot ? 1 : 0
    };

    logger.log(
        `metadata-db import complete: cameras=${summary.cameras} recordings=${summary.recordings} observations=${summary.observations} maps=${summary.maps} mapJobs=${summary.mapJobs} correctionsHistory=${summary.correctionsHistory} health=${summary.health}`
    );
    return summary;
}

if (require.main === module) {
    try {
        run();
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error(`metadata-db import failed: ${error?.message || error}`);
        process.exit(1);
    }
}

module.exports = {
    DEFAULT_PATHS,
    readArraySafe,
    readObjectSafe,
    run
};

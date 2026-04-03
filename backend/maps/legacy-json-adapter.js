const fs = require('fs');
const path = require('path');

function createLegacyJsonAdapter({
    mapsDir,
    defaultIndex,
    defaultCorrections
}) {
    const indexFile = path.join(mapsDir, 'index.json');
    const jobsFile = path.join(mapsDir, 'jobs.json');
    const correctionsFile = path.join(mapsDir, 'manual-corrections.json');

    function ensureDir() {
        fs.mkdirSync(mapsDir, { recursive: true });
    }

    function readJsonSafe(filePath, fallbackValue) {
        try {
            if (!fs.existsSync(filePath)) return fallbackValue;
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (error) {
            return fallbackValue;
        }
    }

    function writeJsonAtomic(filePath, data) {
        ensureDir();
        const tempFile = `${filePath}.tmp`;
        fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
        fs.renameSync(tempFile, filePath);
    }

    function ensureStorageFiles() {
        ensureDir();
        if (!fs.existsSync(indexFile)) {
            writeJsonAtomic(indexFile, defaultIndex);
        }
        if (!fs.existsSync(jobsFile)) {
            writeJsonAtomic(jobsFile, []);
        }
    }

    function ensureCorrectionsFile() {
        ensureDir();
        if (!fs.existsSync(correctionsFile)) {
            fs.writeFileSync(correctionsFile, `${JSON.stringify(defaultCorrections, null, 2)}\n`);
        }
    }

    function readIndex({ ensure = true } = {}) {
        if (ensure) ensureStorageFiles();
        return readJsonSafe(indexFile, defaultIndex);
    }

    function writeIndex(index) {
        writeJsonAtomic(indexFile, index);
        return index;
    }

    function readJobs({ ensure = true } = {}) {
        if (ensure) ensureStorageFiles();
        const jobs = readJsonSafe(jobsFile, []);
        return Array.isArray(jobs) ? jobs : [];
    }

    function writeJobs(jobs) {
        const safeJobs = Array.isArray(jobs) ? jobs : [];
        writeJsonAtomic(jobsFile, safeJobs);
        return safeJobs;
    }

    function getMapPath(mapId) {
        return path.join(mapsDir, `${mapId}.json`);
    }

    function readMap(mapId, fallback = null) {
        if (!mapId) return fallback;
        return readJsonSafe(getMapPath(mapId), fallback);
    }

    function writeMap(mapDoc) {
        if (!mapDoc || !mapDoc.mapId) {
            throw new Error('mapDoc/mapId is required');
        }
        writeJsonAtomic(getMapPath(mapDoc.mapId), mapDoc);
        return mapDoc;
    }

    function readCorrections({ ensure = true } = {}) {
        if (ensure) ensureCorrectionsFile();
        return readJsonSafe(correctionsFile, defaultCorrections);
    }

    function writeCorrections(corrections) {
        ensureCorrectionsFile();
        fs.writeFileSync(correctionsFile, `${JSON.stringify(corrections, null, 2)}\n`);
        return corrections;
    }

    return {
        indexFile,
        jobsFile,
        correctionsFile,
        ensureStorageFiles,
        readIndex,
        writeIndex,
        readJobs,
        writeJobs,
        readMap,
        writeMap,
        readCorrections,
        writeCorrections
    };
}

module.exports = {
    createLegacyJsonAdapter
};

const fs = require('fs');
const path = require('path');

function ensureParentDir(filePath, fsModule = fs) {
    const dirPath = path.dirname(filePath);
    if (!fsModule.existsSync(dirPath)) {
        fsModule.mkdirSync(dirPath, { recursive: true });
    }
}

function readJsonFile(filePath, fallbackValue, fsModule = fs) {
    try {
        if (!fsModule.existsSync(filePath)) return fallbackValue;
        const raw = fsModule.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed;
    } catch (error) {
        return fallbackValue;
    }
}

function writeJsonFile(filePath, value, fsModule = fs) {
    ensureParentDir(filePath, fsModule);
    const tempPath = `${filePath}.tmp`;
    fsModule.writeFileSync(tempPath, JSON.stringify(value, null, 2));
    fsModule.renameSync(tempPath, filePath);
}

module.exports = {
    ensureParentDir,
    readJsonFile,
    writeJsonFile
};

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createCameraInventoryStack } = require('../src/app/create-camera-inventory-stack');

function makeTempSqlitePath() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camera-stack-'));
    return path.join(dir, 'metadata.db');
}

test('createCameraInventoryStack builds repository and inventory service', () => {
    const sqlitePath = makeTempSqlitePath();
    const sqliteStore = {
        dbPath: sqlitePath,
        open() {
            const Database = require('better-sqlite3');
            return new Database(sqlitePath);
        },
        migrate() {}
    };

    const stack = createCameraInventoryStack({
        metadataDriver: 'sqlite',
        sqliteStore
    });

    assert.equal(typeof stack.cameraRepository.list, 'function');
    assert.equal(typeof stack.cameraInventoryService.listCameras, 'function');
});

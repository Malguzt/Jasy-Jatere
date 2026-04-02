const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { HealthSnapshotRepository } = require('../src/infrastructure/repositories/health-snapshot-repository');
const { MetadataSqliteStore } = require('../src/infrastructure/sqlite/metadata-sqlite-store');

function makeSnapshot(status = 'online') {
    return {
        camera_id: 'cam-1',
        status,
        updatedAt: Date.now()
    };
}

test('HealthSnapshotRepository can disable legacy JSON dual-write in sqlite mode', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-repo-sqlite-only-'));
    const filePath = path.join(tmpDir, 'health-snapshot.json');
    const sqliteStore = new MetadataSqliteStore({
        dbPath: path.join(tmpDir, 'metadata.db')
    });
    sqliteStore.migrate();

    const repository = new HealthSnapshotRepository({
        filePath,
        driver: 'sqlite',
        sqliteStore,
        dualWriteFile: false,
        legacyReadFallback: false
    });

    repository.save(makeSnapshot('degraded'));
    const latest = repository.getLatest();
    assert.equal(latest.status, 'degraded');
    assert.equal(fs.existsSync(filePath), false);
});

test('HealthSnapshotRepository can read legacy JSON fallback when explicitly enabled', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-repo-legacy-read-'));
    const filePath = path.join(tmpDir, 'health-snapshot.json');
    const legacySnapshot = makeSnapshot('legacy-online');
    fs.writeFileSync(filePath, JSON.stringify(legacySnapshot, null, 2));

    const sqliteStore = new MetadataSqliteStore({
        dbPath: path.join(tmpDir, 'metadata.db')
    });
    sqliteStore.migrate();

    const repository = new HealthSnapshotRepository({
        filePath,
        driver: 'sqlite',
        sqliteStore,
        dualWriteFile: false,
        legacyReadFallback: true
    });

    const latest = repository.getLatest();
    assert.equal(latest.status, 'legacy-online');
});

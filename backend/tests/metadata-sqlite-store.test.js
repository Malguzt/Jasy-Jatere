const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { MetadataSqliteStore } = require('../src/infrastructure/sqlite/metadata-sqlite-store');

function makeDbPath() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadata-sqlite-'));
    return path.join(dir, 'metadata.db');
}

test('MetadataSqliteStore creates core metadata tables through migrations', () => {
    const dbPath = makeDbPath();
    const store = new MetadataSqliteStore({ dbPath });
    store.migrate();
    const db = store.getDb();

    const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((row) => row.name);

    assert.ok(tables.includes('schema_migrations'));
    assert.ok(tables.includes('cameras'));
    assert.ok(tables.includes('recordings_catalog'));
    assert.ok(tables.includes('observation_events'));
    assert.ok(tables.includes('health_snapshots'));
    assert.ok(tables.includes('control_plane_state'));
    assert.ok(tables.includes('map_versions'));
    assert.ok(tables.includes('map_jobs'));
    assert.ok(tables.includes('map_manual_corrections'));
});

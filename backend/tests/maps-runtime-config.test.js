const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { resolveMapsRuntimeConfig } = require('../maps/runtime-config');

test('resolveMapsRuntimeConfig derives defaults from env and persistence flags', () => {
    const config = resolveMapsRuntimeConfig({
        env: {},
        mapPersistenceFlags: {
            metadataDriver: 'sqlite',
            exportCompatJson: false
        }
    });

    assert.equal(config.metadataDriver, 'sqlite');
    assert.equal(config.exportCompatJson, false);
    assert.equal(config.mapCorrectionHistoryLimit, 20);
    assert.equal(
        config.mapsDir,
        path.join(path.resolve(__dirname, '..'), 'data', 'maps')
    );
    assert.equal(
        config.metadataSqlitePath,
        path.join(config.mapsDir, 'metadata.db')
    );
});

test('resolveMapsRuntimeConfig prioritizes runtime flags for maps config', () => {
    const config = resolveMapsRuntimeConfig({
        runtimeFlags: {
            mapsDataDir: '/tmp/custom-maps',
            metadataStoreDriver: 'json',
            metadataSqlitePath: '/tmp/custom.db',
            mapCorrectionHistoryLimit: 45
        },
        env: {
            MAPS_DATA_DIR: '/tmp/env-maps',
            MAP_CORRECTION_HISTORY_LIMIT: '9',
            METADATA_SQLITE_PATH: '/tmp/env.db'
        },
        mapPersistenceFlags: {
            metadataDriver: 'sqlite',
            exportCompatJson: true
        }
    });

    assert.equal(config.mapsDir, '/tmp/custom-maps');
    assert.equal(config.metadataDriver, 'json');
    assert.equal(config.metadataSqlitePath, '/tmp/custom.db');
    assert.equal(config.mapCorrectionHistoryLimit, 45);
    assert.equal(config.exportCompatJson, true);
});

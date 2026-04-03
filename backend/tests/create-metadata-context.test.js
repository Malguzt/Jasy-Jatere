const test = require('node:test');
const assert = require('node:assert/strict');

const { createMetadataContext } = require('../src/app/create-metadata-context');

test('createMetadataContext builds sqlite store and runs migrate when driver is sqlite', () => {
    let migrateCalls = 0;
    const store = {
        migrate() {
            migrateCalls += 1;
        }
    };

    const context = createMetadataContext({
        metadataDriver: 'sqlite',
        metadataSqlitePath: '/tmp/test-metadata.db',
        sqliteStoreFactory: ({ metadataSqlitePath }) => {
            assert.equal(metadataSqlitePath, '/tmp/test-metadata.db');
            return store;
        }
    });

    assert.equal(context.metadataDriver, 'sqlite');
    assert.equal(context.sqliteStore, store);
    assert.equal(migrateCalls, 1);
});

test('createMetadataContext skips sqlite store when driver is not sqlite', () => {
    let storeFactoryCalls = 0;
    const context = createMetadataContext({
        metadataDriver: 'memory',
        sqliteStoreFactory: () => {
            storeFactoryCalls += 1;
            return { migrate() {} };
        }
    });

    assert.equal(context.metadataDriver, 'memory');
    assert.equal(context.sqliteStore, null);
    assert.equal(storeFactoryCalls, 0);
});

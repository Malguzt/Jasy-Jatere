const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveMapPersistenceFlags } = require('../maps/persistence-flags');

test('resolveMapPersistenceFlags defaults to sqlite with repository-first runtime behavior', () => {
    const flags = resolveMapPersistenceFlags({});
    assert.equal(flags.metadataDriver, 'sqlite');
    assert.equal(flags.exportCompatJson, false);
});

test('resolveMapPersistenceFlags normalizes configured metadata driver', () => {
    const flags = resolveMapPersistenceFlags({
        METADATA_STORE_DRIVER: 'json'
    });
    assert.equal(flags.metadataDriver, 'json');
    assert.equal(flags.exportCompatJson, false);
});

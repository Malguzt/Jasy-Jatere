const test = require('node:test');
const assert = require('node:assert/strict');

const { parseBool, resolveMapPersistenceFlags } = require('../maps/persistence-flags');

test('parseBool handles common truthy and falsy values', () => {
    assert.equal(parseBool('1', false), true);
    assert.equal(parseBool('true', false), true);
    assert.equal(parseBool('yes', false), true);
    assert.equal(parseBool('on', false), true);
    assert.equal(parseBool('0', true), false);
    assert.equal(parseBool('false', true), false);
    assert.equal(parseBool('no', true), false);
    assert.equal(parseBool('off', true), false);
});

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

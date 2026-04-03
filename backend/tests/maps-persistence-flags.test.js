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

test('resolveMapPersistenceFlags defaults to sqlite with legacy compat disabled', () => {
    const flags = resolveMapPersistenceFlags({});
    assert.equal(flags.metadataDriver, 'sqlite');
    assert.equal(flags.legacyCompatExportsEnabled, false);
    assert.equal(flags.exportCompatJson, false);
    assert.equal(flags.legacyReadFallback, false);
});

test('resolveMapPersistenceFlags derives dual-write and fallback defaults from legacy compat flag', () => {
    const flags = resolveMapPersistenceFlags({
        METADATA_STORE_DRIVER: 'sqlite',
        LEGACY_COMPAT_EXPORTS_ENABLED: '1'
    });
    assert.equal(flags.legacyCompatExportsEnabled, true);
    assert.equal(flags.exportCompatJson, true);
    assert.equal(flags.legacyReadFallback, true);
});

test('resolveMapPersistenceFlags allows explicit override of dual-write and fallback flags', () => {
    const flags = resolveMapPersistenceFlags({
        METADATA_STORE_DRIVER: 'sqlite',
        LEGACY_COMPAT_EXPORTS_ENABLED: '1',
        METADATA_DUAL_WRITE_JSON_EXPORTS: '0',
        METADATA_LEGACY_READ_FALLBACK: '0'
    });
    assert.equal(flags.legacyCompatExportsEnabled, true);
    assert.equal(flags.exportCompatJson, false);
    assert.equal(flags.legacyReadFallback, false);
});

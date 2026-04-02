const test = require('node:test');
const assert = require('node:assert/strict');

const { listSchemaFiles, loadSchemaSummaries } = require('../src/contracts/schema-registry');

test('contract schemas exist and parse correctly', () => {
    const files = listSchemaFiles();
    assert.ok(files.length >= 7, 'Expected at least 7 contract schemas');

    const summaries = loadSchemaSummaries();
    const broken = summaries.filter((schema) => !schema.ok);
    assert.equal(broken.length, 0, `Invalid schemas: ${broken.map((s) => s.fileName).join(', ')}`);
});

test('contract schemas have unique ids and titles', () => {
    const summaries = loadSchemaSummaries();
    const ids = summaries.map((schema) => schema.schemaId).filter(Boolean);
    const titles = summaries.map((schema) => schema.title).filter(Boolean);

    assert.equal(ids.length, summaries.length, 'Each schema must declare $id');
    assert.equal(titles.length, summaries.length, 'Each schema must declare title');
    assert.equal(new Set(ids).size, ids.length, 'Schema $id values must be unique');
});

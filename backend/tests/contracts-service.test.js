const test = require('node:test');
const assert = require('node:assert/strict');

const { ContractsService } = require('../src/domains/contracts/contracts-service');

test('getCatalog returns summary and strips internal filePath field', () => {
    const service = new ContractsService({
        loadSchemaSummariesFn: () => ([
            {
                filePath: '/tmp/a.schema.json',
                relativePath: 'contracts/schemas/a.schema.json',
                fileName: 'a.schema.json',
                ok: true,
                parseError: null,
                schemaId: 'jasy/a/v1',
                title: 'A',
                schemaRef: 'https://json-schema.org/draft/2020-12/schema'
            },
            {
                filePath: '/tmp/b.schema.json',
                relativePath: 'contracts/schemas/b.schema.json',
                fileName: 'b.schema.json',
                ok: false,
                parseError: 'invalid json',
                schemaId: null,
                title: null,
                schemaRef: null
            }
        ])
    });

    const catalog = service.getCatalog();
    assert.equal(catalog.schemaCount, 2);
    assert.equal(catalog.invalidSchemas, 1);
    assert.equal(catalog.schemas[0].filePath, undefined);
    assert.equal(catalog.schemas[1].fileName, 'b.schema.json');
});

const { loadSchemaSummaries } = require('../../contracts/schema-registry');

class ContractsService {
    constructor({
        loadSchemaSummariesFn = loadSchemaSummaries
    } = {}) {
        this.loadSchemaSummaries = loadSchemaSummariesFn;
    }

    getCatalog() {
        const schemas = this.loadSchemaSummaries().map((schema) => {
            const { filePath, ...safe } = schema;
            return safe;
        });
        const invalidSchemas = schemas.filter((schema) => !schema.ok).length;
        return {
            schemaCount: schemas.length,
            invalidSchemas,
            schemas
        };
    }
}

module.exports = {
    ContractsService
};

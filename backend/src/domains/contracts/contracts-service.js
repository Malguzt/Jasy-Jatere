class ContractsService {
    constructor({
        loadSchemaSummariesFn
    } = {}) {
        if (typeof loadSchemaSummariesFn !== 'function') {
            throw new Error('loadSchemaSummariesFn is required');
        }
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

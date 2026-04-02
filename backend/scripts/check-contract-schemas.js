const { listSchemaFiles, loadSchemaSummaries } = require('../src/contracts/schema-registry');

function checkSchemaSet() {
    const files = listSchemaFiles();
    if (files.length === 0) {
        throw new Error('No schema files found under contracts/schemas');
    }

    const summaries = loadSchemaSummaries();
    const parseErrors = summaries.filter((summary) => !summary.ok);
    if (parseErrors.length > 0) {
        const details = parseErrors
            .map((summary) => `- ${summary.relativePath}: ${summary.parseError}`)
            .join('\n');
        throw new Error(`Schema parse failures:\n${details}`);
    }

    const missingIds = summaries.filter((summary) => !summary.schemaId);
    if (missingIds.length > 0) {
        const details = missingIds
            .map((summary) => `- ${summary.relativePath}`)
            .join('\n');
        throw new Error(`Schemas missing $id:\n${details}`);
    }

    const idCounts = summaries.reduce((acc, summary) => {
        const key = summary.schemaId;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
    const duplicatedIds = Object.entries(idCounts).filter(([, count]) => count > 1);
    if (duplicatedIds.length > 0) {
        const details = duplicatedIds
            .map(([schemaId, count]) => `- ${schemaId} (x${count})`)
            .join('\n');
        throw new Error(`Duplicated schema $id values:\n${details}`);
    }

    console.log(`contracts-check: ${summaries.length} schemas OK`);
}

try {
    checkSchemaSet();
} catch (error) {
    console.error(`contracts-check failed: ${error.message || error}`);
    process.exit(1);
}

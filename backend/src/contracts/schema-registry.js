const fs = require('fs');
const path = require('path');

const SCHEMA_DIR = path.join(__dirname, '..', '..', 'contracts', 'schemas');

function walkSchemaFiles(dirPath) {
    if (!fs.existsSync(dirPath)) return [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
        .flatMap((entry) => {
            const nextPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                return walkSchemaFiles(nextPath);
            }
            if (!entry.isFile()) return [];
            if (!entry.name.endsWith('.schema.json')) return [];
            return [nextPath];
        })
        .sort((a, b) => a.localeCompare(b));
}

function listSchemaFiles() {
    return walkSchemaFiles(SCHEMA_DIR);
}

function safeReadJson(filePath) {
    try {
        return {
            ok: true,
            data: JSON.parse(fs.readFileSync(filePath, 'utf8')),
            error: null
        };
    } catch (error) {
        return {
            ok: false,
            data: null,
            error: error?.message || String(error)
        };
    }
}

function loadSchemaSummaries() {
    return listSchemaFiles().map((filePath) => {
        const parsed = safeReadJson(filePath);
        const relativePath = path.relative(path.join(__dirname, '..', '..'), filePath);
        const base = {
            filePath,
            relativePath,
            fileName: path.basename(filePath),
            ok: parsed.ok,
            parseError: parsed.error
        };

        if (!parsed.ok || !parsed.data || typeof parsed.data !== 'object') {
            return {
                ...base,
                schemaId: null,
                title: null,
                schemaRef: null
            };
        }

        return {
            ...base,
            schemaId: parsed.data.$id || null,
            title: parsed.data.title || null,
            schemaRef: parsed.data.$schema || null
        };
    });
}

function loadSchemas() {
    const byId = {};
    const byFile = {};

    listSchemaFiles().forEach((filePath) => {
        const parsed = safeReadJson(filePath);
        const relativePath = path.relative(path.join(__dirname, '..', '..'), filePath);
        if (!parsed.ok || !parsed.data || typeof parsed.data !== 'object') {
            byFile[relativePath] = {
                ok: false,
                parseError: parsed.error,
                schema: null
            };
            return;
        }

        const schema = parsed.data;
        const schemaId = schema.$id || null;
        const item = {
            ok: true,
            parseError: null,
            schema
        };
        byFile[relativePath] = item;
        if (schemaId) byId[schemaId] = item;
    });

    return { byId, byFile };
}

module.exports = {
    SCHEMA_DIR,
    listSchemaFiles,
    loadSchemaSummaries,
    loadSchemas
};

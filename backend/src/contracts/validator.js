const { loadSchemas } = require('./schema-registry');

let cachedBundle = null;

function getSchemaBundle() {
    if (!cachedBundle) {
        cachedBundle = loadSchemas();
    }
    return cachedBundle;
}

function refreshSchemaCache() {
    cachedBundle = loadSchemas();
    return cachedBundle;
}

function pickType(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (Number.isInteger(value)) return 'integer';
    return typeof value;
}

function allowedTypes(schema) {
    if (!schema || schema.type === undefined) return [];
    if (Array.isArray(schema.type)) return schema.type;
    return [schema.type];
}

function typeMatches(schema, value) {
    const types = allowedTypes(schema);
    if (types.length === 0) return true;
    const actual = pickType(value);
    if (types.includes(actual)) return true;
    if (actual === 'integer' && types.includes('number')) return true;
    return false;
}

function validateNode(schema, value, path, errors) {
    if (!schema || typeof schema !== 'object') return;

    if (!typeMatches(schema, value)) {
        errors.push({
            path,
            message: `Expected type ${allowedTypes(schema).join('|')}, received ${pickType(value)}`
        });
        return;
    }

    if (schema.enum && Array.isArray(schema.enum)) {
        const found = schema.enum.some((candidate) => candidate === value);
        if (!found) {
            errors.push({
                path,
                message: `Value must be one of: ${schema.enum.map((v) => String(v)).join(', ')}`
            });
            return;
        }
    }

    if ((schema.type === 'string' || (Array.isArray(schema.type) && schema.type.includes('string'))) && typeof value === 'string') {
        if (Number.isFinite(Number(schema.minLength)) && value.length < Number(schema.minLength)) {
            errors.push({ path, message: `String length must be >= ${schema.minLength}` });
        }
        if (schema.pattern) {
            try {
                const re = new RegExp(schema.pattern);
                if (!re.test(value)) {
                    errors.push({ path, message: `String does not match pattern ${schema.pattern}` });
                }
            } catch (error) {
                errors.push({ path, message: `Invalid schema pattern ${schema.pattern}` });
            }
        }
        if (schema.format === 'date-time') {
            const stamp = Date.parse(value);
            if (!Number.isFinite(stamp)) {
                errors.push({ path, message: 'String must be a valid date-time' });
            }
        }
    }

    if ((schema.type === 'number' || schema.type === 'integer' || (Array.isArray(schema.type) && (schema.type.includes('number') || schema.type.includes('integer'))))
        && typeof value === 'number' && Number.isFinite(value)) {
        if (Number.isFinite(Number(schema.minimum)) && value < Number(schema.minimum)) {
            errors.push({ path, message: `Number must be >= ${schema.minimum}` });
        }
        if (Number.isFinite(Number(schema.maximum)) && value > Number(schema.maximum)) {
            errors.push({ path, message: `Number must be <= ${schema.maximum}` });
        }
    }

    if ((schema.type === 'array' || (Array.isArray(schema.type) && schema.type.includes('array'))) && Array.isArray(value)) {
        if (Number.isFinite(Number(schema.minItems)) && value.length < Number(schema.minItems)) {
            errors.push({ path, message: `Array size must be >= ${schema.minItems}` });
        }
        if (schema.items && typeof schema.items === 'object') {
            value.forEach((item, index) => {
                validateNode(schema.items, item, `${path}[${index}]`, errors);
            });
        }
    }

    const supportsObject =
        schema.type === 'object' || (Array.isArray(schema.type) && schema.type.includes('object'));
    if (supportsObject && value && typeof value === 'object' && !Array.isArray(value)) {
        if (Array.isArray(schema.required)) {
            schema.required.forEach((key) => {
                if (!Object.prototype.hasOwnProperty.call(value, key)) {
                    errors.push({ path: `${path}.${key}`, message: 'Required field is missing' });
                }
            });
        }

        if (Number.isFinite(Number(schema.minProperties))) {
            const count = Object.keys(value).length;
            if (count < Number(schema.minProperties)) {
                errors.push({ path, message: `Object must have at least ${schema.minProperties} properties` });
            }
        }

        const props = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
        Object.entries(value).forEach(([key, fieldValue]) => {
            if (Object.prototype.hasOwnProperty.call(props, key)) {
                validateNode(props[key], fieldValue, `${path}.${key}`, errors);
                return;
            }
            if (schema.additionalProperties === false) {
                errors.push({ path: `${path}.${key}`, message: 'Unexpected property' });
                return;
            }
            if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
                validateNode(schema.additionalProperties, fieldValue, `${path}.${key}`, errors);
            }
        });
    }
}

function formatErrors(errors = []) {
    return errors.map((entry) => `${entry.path}: ${entry.message}`);
}

function validateBySchemaId(schemaId, payload) {
    const bundle = getSchemaBundle();
    const schemaEntry = bundle.byId[schemaId];
    if (!schemaEntry || !schemaEntry.ok || !schemaEntry.schema) {
        return {
            ok: false,
            errors: [`Schema not found: ${schemaId}`]
        };
    }

    const errors = [];
    validateNode(schemaEntry.schema, payload, '$', errors);
    return {
        ok: errors.length === 0,
        errors: formatErrors(errors)
    };
}

function validateBody(schemaId) {
    return (req, res, next) => {
        const body = req.body === undefined ? {} : req.body;
        const result = validateBySchemaId(schemaId, body);
        if (result.ok) return next();
        return res.status(400).json({
            success: false,
            error: 'Invalid request body',
            code: 'INVALID_REQUEST_BODY',
            schemaId,
            details: result.errors
        });
    };
}

module.exports = {
    refreshSchemaCache,
    validateBySchemaId,
    validateBody
};

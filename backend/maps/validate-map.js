function isFiniteNumber(value) {
    return Number.isFinite(Number(value));
}

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function validateCamera(camera, index, errors) {
    const prefix = `cameras[${index}]`;
    if (!camera || typeof camera !== 'object') {
        errors.push(`${prefix} must be an object`);
        return;
    }
    if (!isNonEmptyString(camera.id)) errors.push(`${prefix}.id is required`);
    if (!isNonEmptyString(camera.label)) errors.push(`${prefix}.label is required`);
    if (!isFiniteNumber(camera.x)) errors.push(`${prefix}.x must be a number`);
    if (!isFiniteNumber(camera.y)) errors.push(`${prefix}.y must be a number`);
    if (camera.yawDeg !== undefined && !isFiniteNumber(camera.yawDeg)) {
        errors.push(`${prefix}.yawDeg must be a number when present`);
    }
}

function validateObject(object, index, errors) {
    const prefix = `objects[${index}]`;
    if (!object || typeof object !== 'object') {
        errors.push(`${prefix} must be an object`);
        return;
    }
    if (!isNonEmptyString(object.id)) errors.push(`${prefix}.id is required`);
    if (!isNonEmptyString(object.label)) errors.push(`${prefix}.label is required`);
    if (!isNonEmptyString(object.category)) errors.push(`${prefix}.category is required`);
    if (!isFiniteNumber(object.x)) errors.push(`${prefix}.x must be a number`);
    if (!isFiniteNumber(object.y)) errors.push(`${prefix}.y must be a number`);
    if (object.confidence !== undefined && !isFiniteNumber(object.confidence)) {
        errors.push(`${prefix}.confidence must be a number`);
    }
    if (object.sources !== undefined && !Array.isArray(object.sources)) {
        errors.push(`${prefix}.sources must be an array when present`);
    }
}

function validateMapDocument(doc) {
    const errors = [];
    if (!doc || typeof doc !== 'object') {
        return { ok: false, errors: ['Map document must be an object'] };
    }

    if (!isNonEmptyString(doc.schemaVersion)) errors.push('schemaVersion is required');
    if (!isNonEmptyString(doc.mapId)) errors.push('mapId is required');
    if (!isFiniteNumber(doc.createdAt)) errors.push('createdAt must be a unix epoch number');

    if (!Array.isArray(doc.cameras) || doc.cameras.length === 0) {
        errors.push('cameras must be a non-empty array');
    } else {
        doc.cameras.forEach((camera, index) => validateCamera(camera, index, errors));
    }

    if (!Array.isArray(doc.objects)) {
        errors.push('objects must be an array');
    } else {
        doc.objects.forEach((object, index) => validateObject(object, index, errors));
    }

    if (!doc.quality || typeof doc.quality !== 'object') {
        errors.push('quality must be an object');
    } else {
        if (!isNonEmptyString(doc.quality.mode)) errors.push('quality.mode is required');
        if (doc.quality.score !== undefined && !isFiniteNumber(doc.quality.score)) {
            errors.push('quality.score must be numeric when present');
        }
    }

    return { ok: errors.length === 0, errors };
}

module.exports = {
    validateMapDocument
};

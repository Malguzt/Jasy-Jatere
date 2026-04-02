function fail(res, status, payload = {}) {
    const body = {
        success: false,
        code: payload.code || 'UNKNOWN_ERROR',
        error: payload.error || 'Unknown error'
    };
    if (payload.details !== undefined) {
        body.details = payload.details;
    }
    return res.status(status).json(body);
}

function badRequest(res, payload = {}) {
    return fail(res, 400, { code: 'BAD_REQUEST', ...payload });
}

function notFound(res, payload = {}) {
    return fail(res, 404, { code: 'NOT_FOUND', ...payload });
}

function conflict(res, payload = {}) {
    return fail(res, 409, { code: 'CONFLICT', ...payload });
}

function internalError(res, payload = {}) {
    return fail(res, 500, { code: 'INTERNAL_ERROR', ...payload });
}

module.exports = {
    fail,
    badRequest,
    notFound,
    conflict,
    internalError
};

const { randomUUID } = require('crypto');

function resolveCorrelationId(req, uuidFn = randomUUID) {
    const headerValue = req?.get ? req.get('x-correlation-id') : null;
    if (typeof headerValue === 'string' && headerValue.trim()) {
        return headerValue.trim().slice(0, 128);
    }
    return uuidFn();
}

function attachCorrelationId() {
    return (req, res, next) => {
        req.correlationId = resolveCorrelationId(req);
        res.set('x-correlation-id', req.correlationId);
        next();
    };
}

function injectCorrelationIdIntoJson() {
    return (req, res, next) => {
        const originalJson = res.json.bind(res);
        res.json = (payload) => {
            if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
                if (!Object.prototype.hasOwnProperty.call(payload, 'correlationId')) {
                    payload.correlationId = req.correlationId;
                }
            }
            return originalJson(payload);
        };
        next();
    };
}

module.exports = {
    resolveCorrelationId,
    attachCorrelationId,
    injectCorrelationIdIntoJson
};

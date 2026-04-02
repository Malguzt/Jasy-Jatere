const test = require('node:test');
const assert = require('node:assert/strict');

const {
    resolveCorrelationId,
    attachCorrelationId,
    injectCorrelationIdIntoJson
} = require('../src/http/correlation-id-middleware');

test('resolveCorrelationId returns trimmed header value and caps length', () => {
    const req = {
        get: () => `   ${'x'.repeat(200)}   `
    };
    const id = resolveCorrelationId(req, () => 'generated');
    assert.equal(id.length, 128);
    assert.equal(id, 'x'.repeat(128));
});

test('resolveCorrelationId falls back to UUID function when header is missing', () => {
    const req = { get: () => null };
    const id = resolveCorrelationId(req, () => 'generated-uuid');
    assert.equal(id, 'generated-uuid');
});

test('attachCorrelationId sets request correlation id and response header', () => {
    const middleware = attachCorrelationId();
    const req = {
        get: () => 'from-header'
    };
    const setCalls = [];
    const res = {
        set: (key, value) => setCalls.push([key, value])
    };
    let nextCalls = 0;
    middleware(req, res, () => {
        nextCalls += 1;
    });

    assert.equal(req.correlationId, 'from-header');
    assert.deepEqual(setCalls, [['x-correlation-id', 'from-header']]);
    assert.equal(nextCalls, 1);
});

test('injectCorrelationIdIntoJson appends correlationId when missing', () => {
    const middleware = injectCorrelationIdIntoJson();
    const req = { correlationId: 'corr-123' };
    const sent = [];
    const res = {
        json: (payload) => {
            sent.push(payload);
            return payload;
        }
    };
    middleware(req, res, () => {});

    const payload = { success: true };
    res.json(payload);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].correlationId, 'corr-123');
});

test('injectCorrelationIdIntoJson preserves existing correlationId and arrays', () => {
    const middleware = injectCorrelationIdIntoJson();
    const req = { correlationId: 'corr-123' };
    const sent = [];
    const res = {
        json: (payload) => {
            sent.push(payload);
            return payload;
        }
    };
    middleware(req, res, () => {});

    const objectPayload = { correlationId: 'already-there', ok: true };
    const arrayPayload = [{ ok: true }];
    res.json(objectPayload);
    res.json(arrayPayload);

    assert.equal(sent[0].correlationId, 'already-there');
    assert.deepEqual(sent[1], [{ ok: true }]);
});

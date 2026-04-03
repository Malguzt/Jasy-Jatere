const express = require('express');
const cors = require('cors');
const { attachCorrelationId, injectCorrelationIdIntoJson } = require('../http/correlation-id-middleware');

function createHttpAppBase() {
    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use(attachCorrelationId());
    app.use(injectCorrelationIdIntoJson());
    return app;
}

module.exports = {
    createHttpAppBase
};

const express = require('express');
const { internalError } = require('../src/http/respond');

function createHealthRouter({ platformHealthService }) {
    const router = express.Router();

    router.get('/', (req, res) => {
        try {
            return res.json({
                success: true,
                health: platformHealthService.getHealthSnapshot()
            });
        } catch (error) {
            return internalError(res, {
                error: error?.message || String(error)
            });
        }
    });

    return router;
}

module.exports = {
    createHealthRouter
};

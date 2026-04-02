const express = require('express');

function createStreamGatewayProbesRouter({ streamControlService }) {
    const router = express.Router();

    router.get('/livez', (req, res) => {
        return res.json({
            success: true,
            service: 'stream-gateway',
            status: 'alive'
        });
    });

    router.get('/readyz', async (req, res) => {
        try {
            await streamControlService.getRuntimeSnapshot();
            return res.json({
                success: true,
                service: 'stream-gateway',
                status: 'ready'
            });
        } catch (error) {
            return res.status(503).json({
                success: false,
                service: 'stream-gateway',
                status: 'degraded',
                error: error?.message || String(error)
            });
        }
    });

    return router;
}

module.exports = {
    createStreamGatewayProbesRouter
};

const express = require('express');
const path = require('path');

function createContractsRouter({ contractsService }) {
    const router = express.Router();

    router.get('/', (req, res) => {
        const catalog = contractsService.getCatalog();
        return res.json({
            success: true,
            ...catalog
        });
    });

    router.use('/schemas', express.static(path.join(__dirname, '..', 'contracts', 'schemas')));

    return router;
}

module.exports = {
    createContractsRouter
};

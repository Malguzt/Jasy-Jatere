const express = require('express');
const { badRequest, internalError } = require('../src/http/respond');

function createRecordingsRouter({ recordingCatalogService }) {
    const router = express.Router();

    router.get('/', (req, res) => {
        try {
            const recordings = recordingCatalogService.listRecordings(req.query || {});
            return res.json({ success: true, recordings });
        } catch (error) {
            return internalError(res, {
                error: error?.message || 'Failed to list recordings',
                code: error?.code || 'RECORDING_LIST_FAILED'
            });
        }
    });

    router.delete('/:filename', (req, res) => {
        try {
            const outcome = recordingCatalogService.removeRecording(req.params.filename);
            return res.json({ success: true, ...outcome });
        } catch (error) {
            if (Number(error?.status) === 400) {
                return badRequest(res, {
                    error: error?.message || 'Invalid filename',
                    code: error?.code || 'INVALID_FILENAME'
                });
            }
            return internalError(res, {
                error: error?.message || 'Failed to delete recording',
                code: error?.code || 'RECORDING_DELETE_FAILED'
            });
        }
    });

    return router;
}

module.exports = {
    createRecordingsRouter
};

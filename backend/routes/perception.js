const express = require('express');
const { validateBody } = require('../src/contracts/validator');
const { badRequest, internalError } = require('../src/http/respond');

function createPerceptionRouter({ perceptionIngestService }) {
    const router = express.Router();

    router.get('/observations', (req, res) => {
        try {
            const observations = perceptionIngestService.listObservations(req.query?.limit);
            return res.json({ success: true, observations });
        } catch (error) {
            return internalError(res, {
                error: error?.message || 'Failed to list observations',
                code: error?.code || 'OBSERVATION_LIST_FAILED'
            });
        }
    });

    router.post(
        '/observations',
        validateBody('jasy-jatere/contracts/observation-event-ingest-request/v1'),
        (req, res) => {
            try {
                const observation = perceptionIngestService.ingestObservation(req.body || {});
                return res.status(202).json({ success: true, observation });
            } catch (error) {
                if (Number(error?.status) === 400) {
                    return badRequest(res, {
                        error: error?.message || 'Invalid observation payload',
                        code: error?.code || 'INVALID_OBSERVATION_PAYLOAD'
                    });
                }
                return internalError(res, {
                    error: error?.message || 'Failed to ingest observation',
                    code: error?.code || 'OBSERVATION_INGEST_FAILED'
                });
            }
        }
    );

    router.post(
        '/recordings',
        validateBody('jasy-jatere/contracts/recording-catalog-upsert-request/v1'),
        (req, res) => {
            try {
                const recording = perceptionIngestService.upsertRecordingCatalog(req.body || {});
                return res.status(202).json({ success: true, recording });
            } catch (error) {
                if (Number(error?.status) === 400) {
                    return badRequest(res, {
                        error: error?.message || 'Invalid recording payload',
                        code: error?.code || 'INVALID_RECORDING_PAYLOAD'
                    });
                }
                return internalError(res, {
                    error: error?.message || 'Failed to ingest recording metadata',
                    code: error?.code || 'RECORDING_INGEST_FAILED'
                });
            }
        }
    );

    return router;
}

module.exports = {
    createPerceptionRouter
};

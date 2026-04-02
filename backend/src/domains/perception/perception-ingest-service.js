const { ObservationEventRepository } = require('../../infrastructure/repositories/observation-event-repository');

function perceptionIngestError(status, message, code = null, details = null) {
    const error = new Error(message || 'Perception ingest error');
    error.status = status;
    if (code) error.code = code;
    if (details !== null && details !== undefined) error.details = details;
    return error;
}

class PerceptionIngestService {
    constructor({
        observationRepository = new ObservationEventRepository(),
        recordingCatalogService
    } = {}) {
        this.observationRepository = observationRepository;
        this.recordingCatalogService = recordingCatalogService;
    }

    ingestObservation(event = {}) {
        const eventType = String(event.type || '').trim();
        const timestamp = String(event.timestamp || '').trim();
        const cameraId = String(event.camera_id || '').trim();

        if (!eventType) {
            throw perceptionIngestError(400, 'type is required', 'OBSERVATION_TYPE_REQUIRED');
        }
        if (!timestamp) {
            throw perceptionIngestError(400, 'timestamp is required', 'OBSERVATION_TIMESTAMP_REQUIRED');
        }
        if (!cameraId) {
            throw perceptionIngestError(400, 'camera_id is required', 'OBSERVATION_CAMERA_REQUIRED');
        }

        const normalized = {
            ...event,
            type: eventType,
            timestamp,
            camera_id: cameraId,
            ingested_at: new Date().toISOString()
        };
        this.observationRepository.append(normalized);
        return normalized;
    }

    listObservations(limit = 60) {
        const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(2000, Number(limit))) : 60;
        return this.observationRepository.list(safeLimit);
    }

    upsertRecordingCatalog(metadata = {}) {
        if (!this.recordingCatalogService || typeof this.recordingCatalogService.upsertRecording !== 'function') {
            throw perceptionIngestError(500, 'Recording catalog service not configured', 'CATALOG_SERVICE_NOT_CONFIGURED');
        }
        return this.recordingCatalogService.upsertRecording(metadata);
    }
}

module.exports = {
    PerceptionIngestService,
    perceptionIngestError
};

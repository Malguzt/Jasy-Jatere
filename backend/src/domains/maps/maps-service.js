const defaultStorage = require('../../../maps/storage');
const defaultJobs = require('../../../maps/job-queue');
const defaultCorrections = require('../../../maps/corrections');
const { validateMapDocument } = require('../../../maps/validate-map');
const { makeMapId, resolveCategory, normalizeManualLayout } = require('../../../maps/fallback-generator');

function mapServiceError(status, message, code = null, details = null) {
    const error = new Error(message || 'Map service error');
    error.status = status;
    if (code) error.code = code;
    if (details !== null && details !== undefined) error.details = details;
    return error;
}

class MapsService {
    constructor({
        storage = defaultStorage,
        jobs = defaultJobs,
        corrections = defaultCorrections
    } = {}) {
        this.storage = storage;
        this.jobs = jobs;
        this.corrections = corrections;
    }

    getHealth() {
        const runtime = this.jobs.getRuntimeConfig ? this.jobs.getRuntimeConfig() : {};
        const hints = this.corrections.getHintsForGeneration();
        return {
            mapsDir: this.storage.MAPS_DIR,
            queued: this.jobs.queue.length,
            running: !!this.jobs.running,
            runtime,
            corrections: {
                updatedAt: hints.updatedAt || null,
                lastManualMapId: hints.lastManualMapId || null,
                manualCameraLayout: Array.isArray(hints.manualCameraLayout) ? hints.manualCameraLayout.length : 0,
                objectHints: Array.isArray(hints.objectHints) ? hints.objectHints.length : 0
            }
        };
    }

    createGenerationJob(body = {}) {
        return this.jobs.createJob({
            promote: body.promote !== false,
            reason: body.reason || 'manual',
            objectHints: Array.isArray(body.objectHints) ? body.objectHints : [],
            manualCameraLayout: Array.isArray(body.manualCameraLayout) ? body.manualCameraLayout : [],
            planHint: body.planHint || null,
            forceFallback: body.forceFallback === true
        });
    }

    saveManualMap(body = {}) {
        const runtime = this.jobs.getRuntimeConfig ? this.jobs.getRuntimeConfig() : null;
        if (runtime?.plans && runtime.plans.D === false) {
            throw mapServiceError(409, 'Plan D deshabilitado por configuracion (MAP_PLAN_D_ENABLED=0)');
        }

        const manualCameras = normalizeManualLayout(Array.isArray(body.cameras) ? body.cameras : []);
        if (manualCameras.length === 0) {
            throw mapServiceError(400, 'Debe incluir al menos una camara manual con x/y');
        }

        const manualObjectsRaw = Array.isArray(body.objects) ? body.objects : [];
        const objects = manualObjectsRaw
            .map((object, index) => {
                if (!object || typeof object !== 'object') return null;
                const label = String(object.label || '').trim();
                if (!label) return null;
                const x = Number(object.x);
                const y = Number(object.y);
                if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
                const category = String(object.category || resolveCategory(label)).trim() || 'estructura';
                const confidence = Number.isFinite(Number(object.confidence)) ? Number(object.confidence) : 0.8;
                const cameraId = object.cameraId ? String(object.cameraId) : null;
                return {
                    id: `manual_obj_${index + 1}`,
                    label,
                    category,
                    x: Number(x.toFixed(2)),
                    y: Number(y.toFixed(2)),
                    confidence: Number(Math.max(0.05, Math.min(0.99, confidence)).toFixed(2)),
                    sources: cameraId ? [cameraId] : []
                };
            })
            .filter(Boolean);

        const warnings = [];
        if (objects.length === 0) warnings.push('Mapa manual sin objetos; solo posicionamiento de camaras.');

        const mapDoc = {
            schemaVersion: '1.0',
            mapId: makeMapId(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            sourceJobId: null,
            quality: {
                mode: 'croquis',
                score: Number.isFinite(Number(body.qualityScore))
                    ? Math.max(0.05, Math.min(0.99, Number(body.qualityScore)))
                    : 0.45,
                planUsed: 'D',
                warnings
            },
            cameras: manualCameras,
            objects,
            metadata: {
                generatedBy: 'manual-editor',
                cameraCount: manualCameras.length,
                objectCount: objects.length
            }
        };

        const validation = validateMapDocument(mapDoc);
        if (!validation.ok) {
            throw mapServiceError(400, 'Mapa manual invalido', null, validation.errors);
        }

        const summary = this.storage.saveMap(mapDoc);
        this.corrections.upsertFromManualMap(mapDoc);
        if (body.promote !== false) {
            this.storage.promoteMap(summary.mapId);
        }

        return { map: mapDoc, summary };
    }

    getCorrections() {
        return this.corrections.readCorrections();
    }

    getMetrics() {
        const jobs = this.jobs.listJobs(500);
        const doneJobs = jobs.filter((job) => job.status === 'done');
        const failedJobs = jobs.filter((job) => job.status === 'failed');
        const cancelledJobs = jobs.filter((job) => job.status === 'cancelled');

        const avg = (values) => {
            const nums = values.filter((value) => Number.isFinite(Number(value))).map((value) => Number(value));
            if (nums.length === 0) return null;
            return Number((nums.reduce((acc, value) => acc + value, 0) / nums.length).toFixed(2));
        };

        const stageAverages = {
            queuedMs: avg(doneJobs.map((job) => job?.timing?.queuedMs)),
            captureMs: avg(doneJobs.map((job) => job?.timing?.captureMs)),
            eventsMs: avg(doneJobs.map((job) => job?.timing?.eventsMs)),
            planAMs: avg(doneJobs.map((job) => job?.timing?.planAMs)),
            fallbackMs: avg(doneJobs.map((job) => job?.timing?.fallbackMs)),
            validateMs: avg(doneJobs.map((job) => job?.timing?.validateMs)),
            publishMs: avg(doneJobs.map((job) => job?.timing?.publishMs)),
            totalRunMs: avg(doneJobs.map((job) => job?.timing?.totalRunMs))
        };

        const planCounts = doneJobs.reduce((acc, job) => {
            const plan = String(job.planUsed || 'unknown').toUpperCase();
            acc[plan] = (acc[plan] || 0) + 1;
            return acc;
        }, {});

        return {
            totals: {
                jobs: jobs.length,
                done: doneJobs.length,
                failed: failedJobs.length,
                cancelled: cancelledJobs.length,
                queued: jobs.filter((job) => job.status === 'queued').length,
                running: jobs.filter((job) => job.status === 'running').length
            },
            plans: planCounts,
            averagesMs: stageAverages
        };
    }

    listJobs(limit = 50) {
        return this.jobs.listJobs(Number(limit || 50));
    }

    getJob(jobId) {
        const job = this.jobs.getJob(jobId);
        if (!job) throw mapServiceError(404, 'Trabajo no encontrado');
        return job;
    }

    cancelJob(jobId) {
        const job = this.jobs.cancelJob(jobId);
        if (!job) throw mapServiceError(404, 'Trabajo no encontrado');
        return job;
    }

    retryJob(jobId, body = {}) {
        try {
            const retried = this.jobs.retryJob(jobId, {
                promote: body.promote,
                reason: body.reason,
                objectHints: Array.isArray(body.objectHints) ? body.objectHints : undefined,
                manualCameraLayout: Array.isArray(body.manualCameraLayout) ? body.manualCameraLayout : undefined,
                planHint: body.planHint,
                forceFallback: body.forceFallback
            });

            if (!retried) throw mapServiceError(404, 'Trabajo no encontrado');
            return retried;
        } catch (error) {
            if (error?.code === 'JOB_NOT_FINISHED') {
                throw mapServiceError(409, error.message || 'Trabajo aun no finalizado', error.code);
            }
            throw error;
        }
    }

    getLatestMap() {
        const map = this.storage.getLatestMap();
        if (!map) throw mapServiceError(404, 'No hay mapa generado');
        return map;
    }

    getHistory() {
        return {
            activeMapId: this.storage.getIndex().activeMapId || null,
            maps: this.storage.listMapSummaries()
        };
    }

    promoteMap(mapId) {
        const summary = this.storage.promoteMap(mapId);
        if (!summary) throw mapServiceError(404, 'Mapa no encontrado');
        return summary;
    }

    getMap(mapId) {
        const map = this.storage.getMap(mapId);
        if (!map) throw mapServiceError(404, 'Mapa no encontrado');
        return map;
    }
}

module.exports = {
    MapsService,
    mapServiceError
};

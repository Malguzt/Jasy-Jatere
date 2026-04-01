const express = require('express');
const mapStorage = require('../maps/storage');
const mapJobs = require('../maps/job-queue');
const corrections = require('../maps/corrections');
const { validateMapDocument } = require('../maps/validate-map');
const { makeMapId, resolveCategory, normalizeManualLayout } = require('../maps/fallback-generator');

const router = express.Router();

router.get('/health', (req, res) => {
    const runtime = mapJobs.getRuntimeConfig ? mapJobs.getRuntimeConfig() : {};
    const hints = corrections.getHintsForGeneration();
    res.json({
        success: true,
        mapsDir: mapStorage.MAPS_DIR,
        queued: mapJobs.queue.length,
        running: !!mapJobs.running,
        runtime,
        corrections: {
            updatedAt: hints.updatedAt || null,
            lastManualMapId: hints.lastManualMapId || null,
            manualCameraLayout: Array.isArray(hints.manualCameraLayout) ? hints.manualCameraLayout.length : 0,
            objectHints: Array.isArray(hints.objectHints) ? hints.objectHints.length : 0
        }
    });
});

router.post('/generate', (req, res) => {
    try {
        const body = req.body || {};
        const job = mapJobs.createJob({
            promote: body.promote !== false,
            reason: body.reason || 'manual',
            objectHints: Array.isArray(body.objectHints) ? body.objectHints : [],
            manualCameraLayout: Array.isArray(body.manualCameraLayout) ? body.manualCameraLayout : [],
            planHint: body.planHint || null,
            forceFallback: body.forceFallback === true
        });

        res.status(202).json({
            success: true,
            job
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message || String(error) });
    }
});

router.post('/manual', (req, res) => {
    try {
        const runtime = mapJobs.getRuntimeConfig ? mapJobs.getRuntimeConfig() : null;
        if (runtime?.plans && runtime.plans.D === false) {
            return res.status(409).json({
                success: false,
                error: 'Plan D deshabilitado por configuracion (MAP_PLAN_D_ENABLED=0)'
            });
        }

        const body = req.body || {};
        const manualCameras = normalizeManualLayout(Array.isArray(body.cameras) ? body.cameras : []);
        if (manualCameras.length === 0) {
            return res.status(400).json({ success: false, error: 'Debe incluir al menos una camara manual con x/y' });
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
            return res.status(400).json({
                success: false,
                error: 'Mapa manual invalido',
                details: validation.errors
            });
        }

        const summary = mapStorage.saveMap(mapDoc);
        corrections.upsertFromManualMap(mapDoc);
        if (body.promote !== false) {
            mapStorage.promoteMap(summary.mapId);
        }

        return res.status(201).json({
            success: true,
            map: mapDoc,
            summary
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message || String(error) });
    }
});

router.get('/corrections', (req, res) => {
    const data = corrections.readCorrections();
    return res.json({ success: true, corrections: data });
});

router.get('/metrics', (req, res) => {
    const jobs = mapJobs.listJobs(500);
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

    return res.json({
        success: true,
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
    });
});

router.get('/jobs', (req, res) => {
    const limit = Number(req.query.limit || 50);
    const jobs = mapJobs.listJobs(limit);
    res.json({ success: true, jobs });
});

router.get('/jobs/:jobId', (req, res) => {
    const job = mapJobs.getJob(req.params.jobId);
    if (!job) {
        return res.status(404).json({ success: false, error: 'Trabajo no encontrado' });
    }
    return res.json({ success: true, job });
});

router.post('/jobs/:jobId/cancel', (req, res) => {
    const job = mapJobs.cancelJob(req.params.jobId);
    if (!job) {
        return res.status(404).json({ success: false, error: 'Trabajo no encontrado' });
    }
    return res.json({ success: true, job });
});

router.post('/jobs/:jobId/retry', (req, res) => {
    try {
        const body = req.body || {};
        const retried = mapJobs.retryJob(req.params.jobId, {
            promote: body.promote,
            reason: body.reason,
            objectHints: Array.isArray(body.objectHints) ? body.objectHints : undefined,
            manualCameraLayout: Array.isArray(body.manualCameraLayout) ? body.manualCameraLayout : undefined,
            planHint: body.planHint,
            forceFallback: body.forceFallback
        });

        if (!retried) {
            return res.status(404).json({ success: false, error: 'Trabajo no encontrado' });
        }
        return res.status(202).json({ success: true, job: retried });
    } catch (error) {
        if (error?.code === 'JOB_NOT_FINISHED') {
            return res.status(409).json({ success: false, error: error.message || 'Trabajo aun no finalizado' });
        }
        return res.status(500).json({ success: false, error: error.message || String(error) });
    }
});

router.get('/latest', (req, res) => {
    const map = mapStorage.getLatestMap();
    if (!map) {
        return res.status(404).json({ success: false, error: 'No hay mapa generado' });
    }
    return res.json({ success: true, map });
});

router.get('/history', (req, res) => {
    const history = mapStorage.listMapSummaries();
    return res.json({
        success: true,
        activeMapId: mapStorage.getIndex().activeMapId || null,
        maps: history
    });
});

router.post('/:mapId/promote', (req, res) => {
    const summary = mapStorage.promoteMap(req.params.mapId);
    if (!summary) {
        return res.status(404).json({ success: false, error: 'Mapa no encontrado' });
    }
    return res.json({ success: true, map: summary });
});

router.get('/:mapId', (req, res) => {
    const map = mapStorage.getMap(req.params.mapId);
    if (!map) {
        return res.status(404).json({ success: false, error: 'Mapa no encontrado' });
    }
    return res.json({ success: true, map });
});

module.exports = router;

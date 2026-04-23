const storage = require('./storage');
const { validateMapDocument } = require('./validate-map');

function parseBool(value, fallback = true) {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

function toPositiveInt(value, fallback) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
    return fallback;
}

function makeJobId() {
    const stamp = Date.now().toString(36);
    const suffix = Math.random().toString(36).slice(2, 7);
    return `job_${stamp}_${suffix}`;
}

function normalizeObjectHint(hint) {
    if (!hint || typeof hint !== 'object') return null;
    const label = String(hint.label || '').trim();
    if (!label) return null;
    const out = {
        label,
        category: String(hint.category || 'estructura'),
        cameraId: hint.cameraId ? String(hint.cameraId) : null
    };
    const x = Number(hint.x);
    const y = Number(hint.y);
    const confidence = Number(hint.confidence);
    if (Number.isFinite(x)) out.x = Number(x.toFixed(2));
    if (Number.isFinite(y)) out.y = Number(y.toFixed(2));
    if (Number.isFinite(confidence)) out.confidence = Number(Math.max(0.05, Math.min(0.99, confidence)).toFixed(2));
    return out;
}

function mergeObjectHints(primary = [], secondary = []) {
    const seen = new Set();
    const out = [];
    [...primary, ...secondary].forEach((hint) => {
        const normalized = normalizeObjectHint(hint);
        if (!normalized) return;
        const key = `${normalized.cameraId || 'none'}:${normalized.label.toLowerCase()}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(normalized);
    });
    return out;
}

function toDurationMs(startMs) {
    return Math.max(0, Date.now() - Number(startMs || Date.now()));
}

class MapJobQueue {
    constructor({
        cameraInventoryService = null,
        observationRepository = null,
        correctionsService = null,
        fetchImpl = fetch,
        mapperUrl = 'http://localhost:5002',
        mapperTimeoutMs = 90000,
        maxJobs = 250,
        planAEnabled = true,
        planBEnabled = true,
        planCEnabled = true,
        planDEnabled = true,
        applyManualCorrections = true
    } = {}) {
        this.cameraInventoryService = cameraInventoryService;
        this.observationRepository = observationRepository;
        this.correctionsService = correctionsService;
        this.fetchImpl = fetchImpl;
        this.mapperUrl = String(mapperUrl || 'http://localhost:5002').replace(/\/$/, '');
        this.mapperTimeoutMs = toPositiveInt(mapperTimeoutMs, 90000);
        this.maxJobs = toPositiveInt(maxJobs, 250);
        this.planAEnabled = parseBool(planAEnabled, true);
        this.planBEnabled = parseBool(planBEnabled, true);
        this.planCEnabled = parseBool(planCEnabled, true);
        this.planDEnabled = parseBool(planDEnabled, true);
        this.applyManualCorrections = parseBool(applyManualCorrections, true);

        this.jobs = new Map();
        this.queue = [];
        this.running = false;
        this.controllers = new Map();
        this.restorePersistedJobs();
    }

    getRuntimeConfig() {
        return {
            mapperUrl: this.mapperUrl,
            mapperTimeoutMs: this.mapperTimeoutMs,
            maxJobs: this.maxJobs,
            plans: {
                A: this.planAEnabled,
                B: this.planBEnabled,
                C: this.planCEnabled,
                D: this.planDEnabled
            },
            applyManualCorrections: this.applyManualCorrections
        };
    }

    restorePersistedJobs() {
        const persisted = storage.loadJobs();
        persisted.forEach((job) => {
            if (!job || !job.id) return;
            const safeJob = { ...job };
            const wasRunning = safeJob.status === 'running';
            if (safeJob.status === 'queued' || wasRunning) {
                safeJob.status = 'failed';
                safeJob.error = 'Trabajo interrumpido por reinicio del backend';
                safeJob.finishedAt = Date.now();
                safeJob.progress = {
                    stage: 'failed',
                    percent: wasRunning ? 40 : 0,
                    message: 'Interrumpido por reinicio'
                };
            }
            this.jobs.set(safeJob.id, safeJob);
        });
        this.persist();
    }

    persist() {
        const ordered = [...this.jobs.values()]
            .sort((a, b) => Number(b.requestedAt || 0) - Number(a.requestedAt || 0))
            .slice(0, Math.max(50, this.maxJobs));
        this.jobs = new Map(ordered.map((job) => [job.id, job]));
        storage.saveJobs(ordered);
    }

    listJobs(limit = 60) {
        return [...this.jobs.values()]
            .sort((a, b) => Number(b.requestedAt || 0) - Number(a.requestedAt || 0))
            .slice(0, Math.max(1, Math.min(500, Number(limit) || 60)));
    }

    getJob(jobId) {
        return this.jobs.get(String(jobId)) || null;
    }

    createJob(options = {}) {
        const id = makeJobId();
        const now = Date.now();
        const job = {
            id,
            status: 'queued',
            requestedAt: now,
            startedAt: null,
            finishedAt: null,
            mapId: null,
            retryOf: options.retryOf ? String(options.retryOf) : null,
            error: null,
            cancelRequested: false,
            options: {
                promote: options.promote !== false,
                reason: options.reason || 'manual-request',
                objectHints: Array.isArray(options.objectHints) ? options.objectHints : [],
                manualCameraLayout: Array.isArray(options.manualCameraLayout) ? options.manualCameraLayout : [],
                planHint: options.planHint ? String(options.planHint).trim().toUpperCase() : null,
                forceFallback: options.forceFallback === true
            },
            progress: {
                stage: 'queued',
                percent: 0,
                message: 'En cola'
            },
            logs: [{ ts: now, level: 'info', message: 'Trabajo creado y encolado' }]
        };

        this.jobs.set(id, job);
        this.queue.push(id);
        this.persist();
        this.schedule();
        return job;
    }

    retryJob(jobId, overrides = {}) {
        const previous = this.getJob(jobId);
        if (!previous) return null;
        if (previous.status === 'queued' || previous.status === 'running') {
            const error = new Error('Solo se puede reintentar un trabajo finalizado (done/failed/cancelled)');
            error.code = 'JOB_NOT_FINISHED';
            throw error;
        }

        const previousOptions = previous.options || {};
        const nextOptions = {
            ...previousOptions,
            retryOf: previous.id,
            reason: (typeof overrides.reason === 'string' && overrides.reason.trim())
                ? overrides.reason.trim()
                : `retry:${previous.id}`
        };

        if (overrides.promote !== undefined) nextOptions.promote = overrides.promote !== false;
        if (Array.isArray(overrides.objectHints)) nextOptions.objectHints = overrides.objectHints;
        if (Array.isArray(overrides.manualCameraLayout)) nextOptions.manualCameraLayout = overrides.manualCameraLayout;
        if (overrides.planHint !== undefined) {
            nextOptions.planHint = overrides.planHint ? String(overrides.planHint).trim().toUpperCase() : null;
        }
        if (overrides.forceFallback !== undefined) nextOptions.forceFallback = overrides.forceFallback === true;

        const next = this.createJob(nextOptions);
        this.log(next, 'info', `Trabajo reintentado desde ${previous.id}`);
        this.persist();
        return next;
    }

    cancelJob(jobId) {
        const job = this.getJob(jobId);
        if (!job) return null;
        if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') {
            return job;
        }

        if (job.status === 'queued') {
            job.status = 'cancelled';
            job.cancelRequested = true;
            job.finishedAt = Date.now();
            job.progress = {
                stage: 'cancelled',
                percent: 0,
                message: 'Cancelado en cola'
            };
            this.queue = this.queue.filter((queuedId) => queuedId !== job.id);
            this.log(job, 'info', 'Trabajo cancelado antes de ejecutar');
            this.persist();
            return job;
        }

        job.cancelRequested = true;
        const controller = this.controllers.get(job.id);
        if (controller) controller.abort();
        this.log(job, 'warn', 'Se solicito cancelacion en ejecucion');
        this.persist();
        return job;
    }

    schedule() {
        if (this.running) return;
        setTimeout(() => {
            this.processQueue().catch((error) => {
                console.error('[MAP-JOBS] queue error:', error?.message || error);
            });
        }, 0);
    }

    async processQueue() {
        if (this.running) return;
        this.running = true;
        try {
            while (this.queue.length > 0) {
                const nextId = this.queue.shift();
                const job = this.getJob(nextId);
                if (!job || job.status !== 'queued') continue;
                await this.runJob(job);
            }
        } finally {
            this.running = false;
        }
    }

    log(job, level, message) {
        const entry = { ts: Date.now(), level, message: String(message) };
        if (!Array.isArray(job.logs)) job.logs = [];
        job.logs.push(entry);
        if (job.logs.length > 120) job.logs = job.logs.slice(-120);
    }

    setProgress(job, stage, percent, message) {
        job.progress = {
            stage,
            percent: Number.isFinite(Number(percent)) ? Math.max(0, Math.min(100, Number(percent))) : 0,
            message: message || stage
        };
    }

    loadSavedCamerasSafe() {
        if (!this.cameraInventoryService || typeof this.cameraInventoryService.listCameras !== 'function') {
            return [];
        }
        try {
            const data = this.cameraInventoryService.listCameras();
            return Array.isArray(data) ? data : [];
        } catch (error) {
            return [];
        }
    }

    loadObservationEventsSafe(limit = 60) {
        if (!this.observationRepository || typeof this.observationRepository.list !== 'function') {
            return [];
        }
        try {
            const safeLimit = Math.max(1, Number(limit) || 60);
            const data = this.observationRepository.list(safeLimit);
            if (!Array.isArray(data)) return [];
            return data.slice(-safeLimit);
        } catch (error) {
            return [];
        }
    }

    async runJob(job) {
        job.status = 'running';
        job.startedAt = Date.now();
        job.error = null;
        job.planUsed = null;
        this.setProgress(job, 'running', 5, 'Inicializando mapeo');
        this.log(job, 'info', 'Inicio de ejecucion');
        this.persist();

        const controller = new AbortController();
        this.controllers.set(job.id, controller);
        const runStartMs = Date.now();
        const timing = {
            queuedMs: Math.max(0, Number(job.startedAt || 0) - Number(job.requestedAt || 0)),
            captureMs: 0,
            eventsMs: 0,
            planAMs: 0,
            fallbackMs: 0,
            validateMs: 0,
            publishMs: 0,
            totalRunMs: 0
        };
        job.timing = timing;

        try {
            this.setProgress(job, 'capture', 15, 'Cargando camaras');
            const captureStart = Date.now();
            let cameras = this.loadSavedCamerasSafe();
            const manualLayoutInput = Array.isArray(job.options.manualCameraLayout) ? job.options.manualCameraLayout : [];
            const correctionHints = (
                this.applyManualCorrections &&
                this.correctionsService &&
                typeof this.correctionsService.getHintsForGeneration === 'function'
            )
                ? this.correctionsService.getHintsForGeneration()
                : {
                manualCameraLayout: [],
                objectHints: [],
                lastManualMapId: null
            };
            const correctionLayout = Array.isArray(correctionHints.manualCameraLayout) ? correctionHints.manualCameraLayout : [];
            const correctionObjectHints = Array.isArray(correctionHints.objectHints) ? correctionHints.objectHints : [];

            const manualLayout = manualLayoutInput.length > 0 ? manualLayoutInput : correctionLayout;
            const inputHints = Array.isArray(job.options.objectHints) ? job.options.objectHints : [];
            const objectHints = inputHints.length > 0
                ? mergeObjectHints(inputHints, [])
                : mergeObjectHints([], correctionObjectHints);

            const usingCorrectionLayout = manualLayoutInput.length === 0 && correctionLayout.length > 0;
            const usingCorrectionHints = inputHints.length === 0 && correctionObjectHints.length > 0;
            if (usingCorrectionLayout || usingCorrectionHints) {
                this.log(
                    job,
                    'info',
                    `Aplicando correcciones manuales previas (layout=${usingCorrectionLayout ? 'si' : 'no'}, objectHints=${usingCorrectionHints ? 'si' : 'no'})`
                );
            }

            if ((!Array.isArray(cameras) || cameras.length === 0) && manualLayout.length > 0) {
                cameras = manualLayout.map((item, index) => ({
                    id: String(item.id ?? item.cameraId ?? `manual-${index + 1}`),
                    name: String(item.label || item.name || `Camara ${index + 1}`)
                }));
            }
            if (!Array.isArray(cameras) || cameras.length === 0) {
                throw new Error('No hay camaras guardadas para mapear');
            }
            timing.captureMs = toDurationMs(captureStart);

            this.setProgress(job, 'events', 28, 'Buscando eventos recientes');
            const eventsStart = Date.now();
            const recentEvents = await this.fetchRecentEvents();
            timing.eventsMs = toDurationMs(eventsStart);

            this.setProgress(job, 'mapping', 45, 'Intentando generacion principal (Plan A)');
            let mapDoc = null;
            let planUsed = 'A';
            let mapperWarnings = [];
            const pickEnabledFallbackPlan = (preferred = null) => {
                const desired = preferred ? String(preferred).toUpperCase() : null;
                const isEnabled = (plan) => {
                    if (plan === 'B') return this.planBEnabled;
                    if (plan === 'C') return this.planCEnabled;
                    if (plan === 'D') return this.planDEnabled;
                    return false;
                };
                if (desired && isEnabled(desired)) return desired;
                if (this.planBEnabled) return 'B';
                if (this.planCEnabled) return 'C';
                if (this.planDEnabled) return 'D';
                return null;
            };

            const planAAllowed = this.planAEnabled && !job.options.forceFallback;
            if (planAAllowed) {
                const planAStart = Date.now();
                try {
                    const mapped = await this.generateWithMapper({
                        jobId: job.id,
                        cameras,
                        recentEvents,
                        objectHints,
                        manualCameraLayout: manualLayout,
                        planHint: job.options.planHint
                    }, controller.signal);
                    mapDoc = mapped.map;
                    planUsed = mapped.planUsed || 'A';
                    mapperWarnings = Array.isArray(mapped.warnings) ? mapped.warnings : [];
                    this.log(job, 'info', `Mapper respondio correctamente (plan=${planUsed})`);
                } catch (mapperError) {
                    this.log(job, 'warn', `Mapper no disponible o invalido: ${mapperError.message || mapperError}`);
                    planUsed = pickEnabledFallbackPlan(job.options.planHint || 'B') || 'B';
                } finally {
                    timing.planAMs = toDurationMs(planAStart);
                }
            } else {
                planUsed = pickEnabledFallbackPlan(job.options.planHint || 'B') || 'B';
                const reason = !this.planAEnabled ? 'MAP_PLAN_A_ENABLED=0' : 'forceFallback=true';
                this.log(job, 'info', `Plan A omitido (${reason}). Continuando con fallback ${planUsed}`);
            }

            if (!mapDoc) {
                const fallbackPlan = pickEnabledFallbackPlan(job.options.planHint || planUsed || 'B');
                if (!fallbackPlan) {
                    throw new Error('No hay planes de fallback habilitados (B/C/D) para continuar');
                }
                const fallbackStart = Date.now();
                this.setProgress(job, 'fallback', 62, `Aplicando fallback heuristico (Plan ${fallbackPlan})`);
                try {
                    const mappedFallback = await this.generateWithMapper({
                        jobId: job.id,
                        cameras,
                        recentEvents,
                        objectHints,
                        manualCameraLayout: manualLayout,
                        planHint: fallbackPlan,
                        forceFallback: true
                    }, controller.signal);
                    mapDoc = mappedFallback.map;
                    planUsed = mappedFallback.planUsed || fallbackPlan;
                    mapperWarnings = [
                        ...mapperWarnings,
                        ...(Array.isArray(mappedFallback.warnings) ? mappedFallback.warnings : [])
                    ].slice(0, 20);
                    this.log(job, 'info', `Mapper fallback aplicado (plan=${planUsed})`);
                } catch (mapperFallbackError) {
                    throw new Error(`Mapper fallback unavailable: ${mapperFallbackError?.message || mapperFallbackError}`);
                }
                timing.fallbackMs = toDurationMs(fallbackStart);
            }

            if (job.cancelRequested) throw new Error('cancelled-by-user');

            const validateStart = Date.now();
            mapDoc = {
                ...mapDoc,
                sourceJobId: job.id,
                updatedAt: Date.now(),
                quality: {
                    ...(mapDoc.quality || {}),
                    planUsed: mapDoc?.quality?.planUsed || planUsed,
                    warnings: [
                        ...(Array.isArray(mapDoc?.quality?.warnings) ? mapDoc.quality.warnings : []),
                        ...mapperWarnings
                    ].slice(0, 20)
                },
                metadata: {
                    ...(mapDoc.metadata || {}),
                    generatedAt: Date.now(),
                    generatedByJobId: job.id,
                    appliedCorrections: {
                        enabled: this.applyManualCorrections,
                        usedLayoutFromCorrections: manualLayoutInput.length === 0 && correctionLayout.length > 0,
                        usedObjectHintsFromCorrections: inputHints.length === 0 && correctionObjectHints.length > 0,
                        lastManualMapId: correctionHints.lastManualMapId || null
                    }
                }
            };

            const validation = validateMapDocument(mapDoc);
            if (!validation.ok) {
                this.log(job, 'warn', 'Mapa invalido tras Plan A/B, intentando Plan C');
                const validationFallbackPlan = pickEnabledFallbackPlan('C') || pickEnabledFallbackPlan('D');
                if (!validationFallbackPlan) {
                    throw new Error(`Mapa invalido y sin fallback de validacion habilitado: ${validation.errors.join('; ')}`);
                }
                try {
                    const mappedFallback = await this.generateWithMapper({
                        jobId: job.id,
                        cameras,
                        recentEvents: [],
                        objectHints,
                        manualCameraLayout: manualLayout,
                        planHint: validationFallbackPlan,
                        forceFallback: true
                    }, controller.signal);
                    mapDoc = mappedFallback.map;
                    planUsed = mappedFallback.planUsed || validationFallbackPlan;
                } catch (mapperValidationFallbackError) {
                    throw new Error(`Mapper validation fallback unavailable: ${mapperValidationFallbackError?.message || mapperValidationFallbackError}`);
                }
                const validationC = validateMapDocument(mapDoc);
                if (!validationC.ok) {
                    throw new Error(`No se pudo validar mapa generado: ${validationC.errors.join('; ')}`);
                }
            }
            timing.validateMs = toDurationMs(validateStart);

            this.setProgress(job, 'saving', 84, 'Guardando version de mapa');
            const publishStart = Date.now();
            timing.totalRunMs = toDurationMs(runStartMs);
            mapDoc.metadata = {
                ...(mapDoc.metadata || {}),
                timing: { ...timing }
            };
            const summary = storage.saveMap(mapDoc);
            timing.publishMs = toDurationMs(publishStart);
            timing.totalRunMs = toDurationMs(runStartMs);

            const storedMap = storage.getMap(summary.mapId);
            if (storedMap) {
                storedMap.metadata = {
                    ...(storedMap.metadata || {}),
                    timing: { ...timing }
                };
                storedMap.quality = {
                    ...(storedMap.quality || {}),
                    planUsed
                };
                storage.saveMap(storedMap);
            }

            if (job.options.promote !== false) {
                storage.promoteMap(summary.mapId);
            }

            this.setProgress(job, 'done', 100, 'Mapa generado');
            job.mapId = summary.mapId;
            job.planUsed = planUsed;
            job.timing = { ...timing };
            job.status = 'done';
            job.finishedAt = Date.now();
            this.log(
                job,
                'info',
                `Mapa ${summary.mapId} generado (${summary.stats.objects} objetos, plan=${planUsed}, total=${timing.totalRunMs}ms)`
            );
        } catch (error) {
            if (job.cancelRequested || String(error?.message || '').includes('cancelled-by-user') || error?.name === 'AbortError') {
                job.status = 'cancelled';
                job.finishedAt = Date.now();
                this.setProgress(job, 'cancelled', job.progress?.percent || 0, 'Cancelado por usuario');
                this.log(job, 'warn', 'Trabajo cancelado por usuario');
            } else {
                job.status = 'failed';
                job.finishedAt = Date.now();
                job.error = error?.message || String(error);
                timing.totalRunMs = toDurationMs(runStartMs);
                job.timing = { ...timing };
                this.setProgress(job, 'failed', job.progress?.percent || 0, 'Fallo de generacion');
                this.log(job, 'error', job.error);
            }
        } finally {
            this.controllers.delete(job.id);
            this.persist();
        }
    }

    async fetchRecentEvents() {
        return this.loadObservationEventsSafe(60);
    }

    async generateWithMapper(payload, signal) {
        const timeoutMs = toPositiveInt(this.mapperTimeoutMs, 90000);
        const timeoutController = new AbortController();
        const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
        const bridgeController = new AbortController();

        const abortFromInput = () => bridgeController.abort();
        const abortFromTimeout = () => bridgeController.abort();

        if (signal) signal.addEventListener('abort', abortFromInput, { once: true });
        timeoutController.signal.addEventListener('abort', abortFromTimeout, { once: true });

        try {
            const response = await this.fetchImpl(`${this.mapperUrl}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: bridgeController.signal
            });
            if (!response.ok) {
                throw new Error(`Mapper HTTP ${response.status}`);
            }
            const result = await response.json();
            if (!result?.success || !result?.map) {
                throw new Error(result?.error || 'Mapper payload invalido');
            }
            return result;
        } finally {
            clearTimeout(timeout);
            if (signal) signal.removeEventListener('abort', abortFromInput);
            timeoutController.signal.removeEventListener('abort', abortFromTimeout);
        }
    }
}

function createMapJobQueueFromRuntimeFlags({
    runtimeFlags = {},
    cameraInventoryService = null,
    observationRepository = null,
    correctionsService = null
} = {}) {
    return new MapJobQueue({
        cameraInventoryService,
        observationRepository,
        correctionsService,
        mapperUrl: runtimeFlags.mapperUrl || 'http://localhost:5002',
        mapperTimeoutMs: runtimeFlags.mapMapperTimeoutMs,
        maxJobs: runtimeFlags.mapMaxJobsHistory,
        planAEnabled: runtimeFlags.mapPlanAEnabled,
        planBEnabled: runtimeFlags.mapPlanBEnabled,
        planCEnabled: runtimeFlags.mapPlanCEnabled,
        planDEnabled: runtimeFlags.mapPlanDEnabled,
        applyManualCorrections: runtimeFlags.mapApplyManualCorrections
    });
}

module.exports = {
    MapJobQueue,
    createMapJobQueueFromRuntimeFlags
};

const DAY_MS = 24 * 60 * 60 * 1000;

function parseTimestamp(entry = {}) {
    const metadata = entry?.metadata && typeof entry.metadata === 'object' ? entry.metadata : {};
    const raw = metadata.event_time || metadata.recording_started_at || metadata.created_at || entry.event_time || entry.created;
    const stamp = Date.parse(raw || '');
    return Number.isFinite(stamp) ? stamp : null;
}

function buildSortedEntries(recordings = []) {
    return [...recordings].sort((a, b) => {
        const bTs = parseTimestamp(b) || 0;
        const aTs = parseTimestamp(a) || 0;
        return bTs - aTs;
    });
}

class RecordingRetentionJob {
    constructor({
        recordingCatalogService,
        enabled = false,
        intervalMs = 60 * 60 * 1000,
        maxAgeDays = null,
        maxEntries = null,
        now = () => Date.now(),
        logger = console
    } = {}) {
        this.recordingCatalogService = recordingCatalogService;
        this.enabled = enabled === true;
        this.intervalMs = Number.isFinite(Number(intervalMs)) ? Math.max(1000, Number(intervalMs)) : 60 * 60 * 1000;
        this.maxAgeDays = Number.isFinite(Number(maxAgeDays)) && Number(maxAgeDays) > 0 ? Number(maxAgeDays) : null;
        this.maxEntries = Number.isFinite(Number(maxEntries)) && Number(maxEntries) > 0 ? Number(maxEntries) : null;
        this.now = now;
        this.logger = logger;
        this.timer = null;
        this.lastRun = null;
    }

    getPolicy() {
        return {
            enabled: this.enabled,
            intervalMs: this.intervalMs,
            maxAgeDays: this.maxAgeDays,
            maxEntries: this.maxEntries
        };
    }

    getStatus() {
        return {
            ...this.getPolicy(),
            running: !!this.timer,
            lastRun: this.lastRun
        };
    }

    pickAgeExpired(entries = []) {
        if (!this.maxAgeDays) return [];
        const cutoff = this.now() - (this.maxAgeDays * DAY_MS);
        return entries.filter((entry) => {
            const stamp = parseTimestamp(entry);
            return stamp !== null && stamp < cutoff;
        });
    }

    pickCountOverflow(entries = [], alreadyExpired = []) {
        if (!this.maxEntries) return [];
        const ageExpiredSet = new Set(alreadyExpired.map((entry) => entry.filename));
        const survivors = entries.filter((entry) => !ageExpiredSet.has(entry.filename));
        if (survivors.length <= this.maxEntries) return [];
        return survivors.slice(this.maxEntries);
    }

    async runOnce({ dryRun = false, reason = 'manual' } = {}) {
        if (!this.recordingCatalogService || typeof this.recordingCatalogService.listRecordings !== 'function') {
            throw new Error('Recording catalog service is not configured');
        }

        const sorted = buildSortedEntries(this.recordingCatalogService.listRecordings());
        const ageExpired = this.pickAgeExpired(sorted);
        const countOverflow = this.pickCountOverflow(sorted, ageExpired);
        const targets = [...new Map(
            [...ageExpired, ...countOverflow].map((entry) => [entry.filename, entry])
        ).values()];

        const deleted = [];
        const errors = [];

        if (!dryRun && typeof this.recordingCatalogService.removeRecording === 'function') {
            targets.forEach((entry) => {
                try {
                    const outcome = this.recordingCatalogService.removeRecording(entry.filename);
                    deleted.push({
                        filename: entry.filename,
                        outcome
                    });
                } catch (error) {
                    errors.push({
                        filename: entry.filename,
                        error: error?.message || String(error)
                    });
                }
            });
        }

        const summary = {
            status: errors.length > 0 ? 'degraded' : 'ok',
            ranAt: new Date(this.now()).toISOString(),
            reason: String(reason || 'manual'),
            dryRun: dryRun === true,
            policy: this.getPolicy(),
            totalBefore: sorted.length,
            ageExpired: ageExpired.map((entry) => entry.filename),
            countOverflow: countOverflow.map((entry) => entry.filename),
            deleted: deleted.map((entry) => entry.filename),
            errors,
            totalAfter: dryRun ? sorted.length : Math.max(0, sorted.length - deleted.length)
        };

        this.lastRun = summary;
        return summary;
    }

    start() {
        if (!this.enabled || this.timer || !this.recordingCatalogService) return;
        const runPeriodic = async () => {
            try {
                await this.runOnce({ reason: 'periodic' });
            } catch (error) {
                this.logger.error('[RETENTION] periodic cleanup failed:', error?.message || error);
            }
        };
        runPeriodic();
        this.timer = setInterval(runPeriodic, this.intervalMs);
    }

    stop() {
        if (!this.timer) return;
        clearInterval(this.timer);
        this.timer = null;
    }
}

module.exports = {
    RecordingRetentionJob
};

class PlatformHealthService {
    constructor({
        contractsService,
        monitoringService,
        streamControlService,
        streamControlProxyService,
        streamProxyModeEnabled = false,
        streamProxyRequired = false,
        recordingRetentionJob,
        now = () => Date.now(),
        uptimeSeconds = () => process.uptime()
    } = {}) {
        this.contractsService = contractsService;
        this.monitoringService = monitoringService;
        this.streamControlService = streamControlService;
        this.streamControlProxyService = streamControlProxyService;
        this.streamProxyModeEnabled = streamProxyModeEnabled === true;
        this.streamProxyRequired = streamProxyRequired === true;
        this.recordingRetentionJob = recordingRetentionJob;
        this.now = now;
        this.uptimeSeconds = uptimeSeconds;
    }

    safeCall(fn, fallback = null) {
        try {
            return fn();
        } catch (error) {
            return fallback;
        }
    }

    async safeCallAsync(fn, fallback = null) {
        try {
            const result = fn();
            if (result && typeof result.then === 'function') {
                return await result;
            }
            return result;
        } catch (error) {
            return fallback;
        }
    }

    getHealthSnapshot() {
        const contracts = this.safeCall(() => this.contractsService.getCatalog(), null);
        const monitoring = this.safeCall(() => this.monitoringService.getConnectivitySnapshot(), null);
        const streams = this.safeCall(() => this.streamControlService.getRuntimeSnapshot(), null);
        const recordingsRetention = this.safeCall(() => this.recordingRetentionJob.getStatus(), null);

        return {
            status: 'ok',
            now: this.now(),
            uptimeSeconds: Number(this.uptimeSeconds().toFixed(3)),
            contracts: contracts
                ? {
                    schemaCount: contracts.schemaCount,
                    invalidSchemas: contracts.invalidSchemas
                }
                : null,
            monitoring: monitoring
                ? {
                    running: !!monitoring.running,
                    updatedAt: monitoring.updatedAt || null,
                    summary: monitoring.summary || null
                }
                : null,
            streams: streams
                ? {
                    summary: streams.summary || null,
                    syncRuntime: streams.syncRuntime || null,
                    lastManualSync: streams.lastManualSync || null
                }
                : null,
            recordingsRetention
        };
    }

    getLivenessSnapshot() {
        return {
            status: 'alive',
            alive: true,
            now: this.now(),
            uptimeSeconds: Number(this.uptimeSeconds().toFixed(3))
        };
    }

    async getReadinessSnapshot() {
        const health = this.getHealthSnapshot();
        const proxySnapshot =
            this.streamProxyModeEnabled && this.streamControlProxyService
                ? await this.safeCallAsync(() => this.streamControlProxyService.getRuntimeSnapshot(), null)
                : null;
        const checks = {
            contracts: !this.contractsService
                ? { ready: true, skipped: true }
                : {
                    ready: !!health.contracts && Number(health.contracts.invalidSchemas || 0) === 0,
                    invalidSchemas: health.contracts?.invalidSchemas ?? null
                },
            monitoring: !this.monitoringService
                ? { ready: true, skipped: true }
                : {
                    ready: !!health.monitoring,
                    updatedAt: health.monitoring?.updatedAt || null
                },
            streams: !this.streamControlService
                ? { ready: true, skipped: true }
                : {
                    ready: !!health.streams,
                    summary: health.streams?.summary || null
                },
            streamGatewayProxy:
                !this.streamProxyModeEnabled
                    ? { ready: true, skipped: true, required: false }
                    : {
                        required: this.streamProxyRequired,
                        ready: this.streamProxyRequired ? !!proxySnapshot : true,
                        summary: proxySnapshot?.summary || null
                }
        };

        const failures = Object.entries(checks)
            .filter(([, value]) => value.ready === false)
            .map(([key]) => key);

        const ready = failures.length === 0;
        return {
            status: ready ? 'ready' : 'degraded',
            ready,
            now: health.now,
            uptimeSeconds: health.uptimeSeconds,
            checks,
            failures
        };
    }
}

module.exports = {
    PlatformHealthService
};

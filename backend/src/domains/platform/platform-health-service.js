class PlatformHealthService {
    constructor({
        contractsService,
        monitoringService,
        streamControlService,
        now = () => Date.now(),
        uptimeSeconds = () => process.uptime()
    } = {}) {
        this.contractsService = contractsService;
        this.monitoringService = monitoringService;
        this.streamControlService = streamControlService;
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

    getHealthSnapshot() {
        const contracts = this.safeCall(() => this.contractsService.getCatalog(), null);
        const monitoring = this.safeCall(() => this.monitoringService.getConnectivitySnapshot(), null);
        const streams = this.safeCall(() => this.streamControlService.getRuntimeSnapshot(), null);

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
                : null
        };
    }
}

module.exports = {
    PlatformHealthService
};

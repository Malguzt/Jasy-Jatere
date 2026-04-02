class PlatformRuntimeCoordinator {
    constructor({
        cameraEventMonitor,
        connectivityMonitor,
        streamSyncOrchestrator,
        streamWebSocketGateway,
        recordingRetentionJob,
        streamRuntimeEnabled = true,
        streamWebSocketGatewayEnabled = true
    } = {}) {
        this.cameraEventMonitor = cameraEventMonitor;
        this.connectivityMonitor = connectivityMonitor;
        this.streamSyncOrchestrator = streamSyncOrchestrator;
        this.streamWebSocketGateway = streamWebSocketGateway;
        this.recordingRetentionJob = recordingRetentionJob;
        this.streamRuntimeEnabled = streamRuntimeEnabled !== false;
        this.streamWebSocketGatewayEnabled = streamWebSocketGatewayEnabled !== false;
    }

    start(server) {
        if (this.cameraEventMonitor && typeof this.cameraEventMonitor.start === 'function') {
            this.cameraEventMonitor.start();
        }
        if (this.connectivityMonitor && typeof this.connectivityMonitor.start === 'function') {
            this.connectivityMonitor.start();
        }
        if (
            this.streamRuntimeEnabled &&
            this.streamSyncOrchestrator &&
            typeof this.streamSyncOrchestrator.start === 'function'
        ) {
            this.streamSyncOrchestrator.start();
        }
        if (this.recordingRetentionJob && typeof this.recordingRetentionJob.start === 'function') {
            this.recordingRetentionJob.start();
        }
        if (
            this.streamWebSocketGatewayEnabled &&
            this.streamWebSocketGateway &&
            typeof this.streamWebSocketGateway.attach === 'function'
        ) {
            this.streamWebSocketGateway.attach(server);
        }
    }

    stop() {
        if (
            this.streamWebSocketGatewayEnabled &&
            this.streamWebSocketGateway &&
            typeof this.streamWebSocketGateway.stop === 'function'
        ) {
            this.streamWebSocketGateway.stop();
        }
        if (
            this.streamRuntimeEnabled &&
            this.streamSyncOrchestrator &&
            typeof this.streamSyncOrchestrator.stop === 'function'
        ) {
            this.streamSyncOrchestrator.stop();
        }
        if (this.recordingRetentionJob && typeof this.recordingRetentionJob.stop === 'function') {
            this.recordingRetentionJob.stop();
        }
        if (this.connectivityMonitor && typeof this.connectivityMonitor.stop === 'function') {
            this.connectivityMonitor.stop();
        }
        if (this.cameraEventMonitor && typeof this.cameraEventMonitor.stop === 'function') {
            this.cameraEventMonitor.stop();
        }
    }
}

module.exports = {
    PlatformRuntimeCoordinator
};

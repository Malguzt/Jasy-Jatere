class PlatformRuntimeCoordinator {
    constructor({
        cameraEventMonitor,
        connectivityMonitor,
        streamSyncOrchestrator,
        streamWebSocketGateway,
        streamRuntimeEnabled = true,
        streamWebSocketGatewayEnabled = true
    } = {}) {
        this.cameraEventMonitor = cameraEventMonitor;
        this.connectivityMonitor = connectivityMonitor;
        this.streamSyncOrchestrator = streamSyncOrchestrator;
        this.streamWebSocketGateway = streamWebSocketGateway;
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

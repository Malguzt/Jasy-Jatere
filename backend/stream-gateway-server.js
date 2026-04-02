const { createStreamGatewayApp } = require('./src/app/create-stream-gateway-app');

const PORT = process.env.STREAM_GATEWAY_PORT || process.env.PORT || 4100;

const { app, platformRuntimeCoordinator } = createStreamGatewayApp();

const server = app.listen(PORT, '0.0.0.0', () => {
    // eslint-disable-next-line no-console
    console.log(`Stream gateway server running on http://0.0.0.0:${PORT}`);
});

platformRuntimeCoordinator.start(server);

let shuttingDown = false;

function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log(`[STREAM-GATEWAY] Received ${signal}, shutting down...`);

    try {
        platformRuntimeCoordinator.stop();
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[STREAM-GATEWAY] Runtime stop error:', error?.message || error);
    }

    const forceExitTimer = setTimeout(() => {
        // eslint-disable-next-line no-console
        console.error('[STREAM-GATEWAY] Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
    forceExitTimer.unref();

    server.close((error) => {
        clearTimeout(forceExitTimer);
        if (error) {
            // eslint-disable-next-line no-console
            console.error('[STREAM-GATEWAY] Server close error:', error?.message || error);
            process.exit(1);
            return;
        }
        process.exit(0);
    });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

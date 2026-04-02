const { createBackendApp } = require('./src/app/create-backend-app');

const PORT = process.env.PORT || 4000;

const { app, platformRuntimeCoordinator } = createBackendApp();

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend server running on http://0.0.0.0:${PORT}`);
});

platformRuntimeCoordinator.start(server);

let shuttingDown = false;

function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[BOOT] Received ${signal}, shutting down...`);

    try {
        platformRuntimeCoordinator.stop();
    } catch (error) {
        console.error('[BOOT] Runtime stop error:', error?.message || error);
    }

    const forceExitTimer = setTimeout(() => {
        console.error('[BOOT] Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
    forceExitTimer.unref();

    server.close((error) => {
        clearTimeout(forceExitTimer);
        if (error) {
            console.error('[BOOT] Server close error:', error?.message || error);
            process.exit(1);
            return;
        }
        process.exit(0);
    });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

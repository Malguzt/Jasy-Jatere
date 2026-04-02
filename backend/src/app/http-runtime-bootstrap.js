function detachSignalListener(processRef, signal, handler) {
    if (typeof processRef?.off === 'function') {
        processRef.off(signal, handler);
        return;
    }
    if (typeof processRef?.removeListener === 'function') {
        processRef.removeListener(signal, handler);
    }
}

function installGracefulShutdown({
    server,
    platformRuntimeCoordinator,
    logPrefix = 'BOOT',
    logger = console,
    processRef = process,
    forceShutdownTimeoutMs = 10000
}) {
    let shuttingDown = false;

    function gracefulShutdown(signal) {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.log(`[${logPrefix}] Received ${signal}, shutting down...`);

        try {
            platformRuntimeCoordinator.stop();
        } catch (error) {
            logger.error(`[${logPrefix}] Runtime stop error:`, error?.message || error);
        }

        const forceExitTimer = setTimeout(() => {
            logger.error(`[${logPrefix}] Forced shutdown after timeout`);
            processRef.exit(1);
        }, forceShutdownTimeoutMs);
        forceExitTimer.unref();

        server.close((error) => {
            clearTimeout(forceExitTimer);
            if (error) {
                logger.error(`[${logPrefix}] Server close error:`, error?.message || error);
                processRef.exit(1);
                return;
            }
            processRef.exit(0);
        });
    }

    const sigintHandler = () => gracefulShutdown('SIGINT');
    const sigtermHandler = () => gracefulShutdown('SIGTERM');
    processRef.on('SIGINT', sigintHandler);
    processRef.on('SIGTERM', sigtermHandler);

    return {
        gracefulShutdown,
        disposeSignalHandlers() {
            detachSignalListener(processRef, 'SIGINT', sigintHandler);
            detachSignalListener(processRef, 'SIGTERM', sigtermHandler);
        }
    };
}

function startHttpRuntime({
    app,
    platformRuntimeCoordinator,
    port,
    host = '0.0.0.0',
    startupMessage,
    logPrefix = 'BOOT',
    logger = console,
    processRef = process,
    forceShutdownTimeoutMs = 10000
}) {
    const server = app.listen(port, host, () => {
        logger.log(startupMessage || `[${logPrefix}] Server running on http://${host}:${port}`);
    });

    platformRuntimeCoordinator.start(server);
    const shutdown = installGracefulShutdown({
        server,
        platformRuntimeCoordinator,
        logPrefix,
        logger,
        processRef,
        forceShutdownTimeoutMs
    });

    return {
        server,
        gracefulShutdown: shutdown.gracefulShutdown,
        disposeSignalHandlers: shutdown.disposeSignalHandlers
    };
}

module.exports = {
    installGracefulShutdown,
    startHttpRuntime
};

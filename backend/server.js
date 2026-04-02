const { createBackendApp } = require('./src/app/create-backend-app');
const { startHttpRuntime } = require('./src/app/http-runtime-bootstrap');

const PORT = process.env.PORT || 4000;

const { app, platformRuntimeCoordinator } = createBackendApp();

startHttpRuntime({
    app,
    platformRuntimeCoordinator,
    port: PORT,
    startupMessage: `Backend server running on http://0.0.0.0:${PORT}`
});

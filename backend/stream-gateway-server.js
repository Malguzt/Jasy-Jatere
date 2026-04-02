const { createStreamGatewayApp } = require('./src/app/create-stream-gateway-app');
const { startHttpRuntime } = require('./src/app/http-runtime-bootstrap');

const PORT = process.env.STREAM_GATEWAY_PORT || process.env.PORT || 4100;

const { app, platformRuntimeCoordinator } = createStreamGatewayApp();

startHttpRuntime({
    app,
    platformRuntimeCoordinator,
    port: PORT,
    logPrefix: 'STREAM-GATEWAY',
    startupMessage: `Stream gateway server running on http://0.0.0.0:${PORT}`
});

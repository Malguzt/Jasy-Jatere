const { createInternalStreamsGatewayRouter } = require('../../routes/internal-streams-gateway');
const { createStreamGatewayProbesRouter } = require('../../routes/stream-gateway-probes');

function registerStreamGatewayRoutes({
    app,
    services,
    runtimeFlags
}) {
    app.use('/api/internal/streams', createInternalStreamsGatewayRouter({
        streamControlService: services.streamControlService,
        runtimeFlags
    }));
    app.use('/', createStreamGatewayProbesRouter({
        streamControlService: services.streamControlService
    }));
}

module.exports = {
    registerStreamGatewayRoutes
};

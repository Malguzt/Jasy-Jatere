const { createInternalStreamsGatewayRouter } = require('../../routes/internal-streams-gateway');
const { createStreamGatewayProbesRouter } = require('../../routes/stream-gateway-probes');

function registerStreamGatewayRoutes({
    app,
    services,
    runtimeFlags
}) {
    const routeRegistrations = [
        {
            path: '/api/internal/streams',
            router: createInternalStreamsGatewayRouter({
                streamControlService: services.streamControlService,
                runtimeFlags
            })
        },
        {
            path: '/',
            router: createStreamGatewayProbesRouter({
                streamControlService: services.streamControlService
            })
        }
    ];

    routeRegistrations.forEach(({ path, router }) => {
        app.use(path, router);
    });
}

module.exports = {
    registerStreamGatewayRoutes
};

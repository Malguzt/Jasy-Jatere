const express = require('express');
const cors = require('cors');
const path = require('path');
const streamManager = require('../../stream-manager');
const { resolveCameraStreamUrls, deriveCompanionRtsp, parseResolutionHint } = require('../../rtsp-utils');
const { validateBody } = require('../contracts/validator');
const { attachCorrelationId, injectCorrelationIdIntoJson } = require('../http/correlation-id-middleware');
const { PlatformRuntimeCoordinator } = require('./platform-runtime-coordinator');
const { resolveRuntimeFlags } = require('./runtime-flags');
const { CameraMetadataRepository } = require('../infrastructure/repositories/camera-metadata-repository');
const { MetadataSqliteStore } = require('../infrastructure/sqlite/metadata-sqlite-store');
const { CameraInventoryService } = require('../domains/cameras/camera-inventory-service');
const { StreamSyncOrchestrator } = require('../domains/streams/stream-sync-orchestrator');
const { StreamWebSocketGateway } = require('../domains/streams/stream-websocket-gateway');
const { StreamControlService } = require('../domains/streams/stream-control-service');

function sendGatewayError(res, error) {
    const status = Number(error?.status) || 500;
    return res.status(status).json({
        success: false,
        error: error?.message || String(error),
        details: error?.details
    });
}

function createStreamGatewayApp({
    cameraFile = path.join(__dirname, '..', '..', 'data', 'cameras.json'),
    runtimeFlags = resolveRuntimeFlags()
} = {}) {
    const app = express();

    app.use(cors());
    app.use(express.json());
    app.use(attachCorrelationId());
    app.use(injectCorrelationIdIntoJson());

    const metadataDriver = String(process.env.METADATA_STORE_DRIVER || 'sqlite').toLowerCase();
    const sqliteStore = metadataDriver === 'sqlite' ? new MetadataSqliteStore() : null;
    if (metadataDriver === 'sqlite') {
        sqliteStore.migrate();
    }

    const cameraRepository = new CameraMetadataRepository({
        legacyFile: cameraFile,
        driver: metadataDriver,
        sqliteStore
    });
    const cameraInventoryService = new CameraInventoryService({
        repository: cameraRepository
    });

    const streamSyncOrchestrator = new StreamSyncOrchestrator({
        cameraFile,
        cameraInventoryService,
        streamManager,
        resolveCameraStreamUrls,
        deriveCompanionRtsp,
        parseResolutionHint
    });

    const streamControlService = new StreamControlService({
        streamManager,
        streamSyncOrchestrator
    });

    const streamWebSocketGateway = new StreamWebSocketGateway({
        cameraFile,
        cameraInventoryService,
        streamManager,
        resolveCameraStreamUrls
    });

    const platformRuntimeCoordinator = new PlatformRuntimeCoordinator({
        streamSyncOrchestrator,
        streamWebSocketGateway,
        streamRuntimeEnabled: runtimeFlags.streamRuntimeEnabled,
        streamWebSocketGatewayEnabled: runtimeFlags.streamWebSocketGatewayEnabled
    });

    app.get('/api/internal/streams/health', (req, res) => {
        return res.json({
            success: true,
            service: 'stream-gateway',
            streamRuntimeEnabled: runtimeFlags.streamRuntimeEnabled,
            streamWebSocketGatewayEnabled: runtimeFlags.streamWebSocketGatewayEnabled
        });
    });

    app.get('/api/internal/streams/runtime', async (req, res) => {
        try {
            const snapshot = await streamControlService.getRuntimeSnapshot();
            return res.json({
                success: true,
                ...snapshot
            });
        } catch (error) {
            return sendGatewayError(res, error);
        }
    });

    app.post('/api/internal/streams/sync', validateBody('jasy-jatere/contracts/stream-sync-request/v1'), async (req, res) => {
        try {
            const sync = await streamControlService.triggerManualSync(req.body || {});
            return res.json({
                success: true,
                sync
            });
        } catch (error) {
            return sendGatewayError(res, error);
        }
    });

    return {
        app,
        platformRuntimeCoordinator
    };
}

module.exports = {
    createStreamGatewayApp
};

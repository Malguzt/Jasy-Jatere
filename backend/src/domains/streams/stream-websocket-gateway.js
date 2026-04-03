const fs = require('fs');
const WebSocket = require('ws');
const { loadCameraInventory } = require('../cameras/camera-inventory-loader');

class StreamWebSocketGateway {
    constructor({
        cameraFile,
        cameraInventoryService,
        streamManager,
        resolveCameraStreamUrls,
        legacyFileFallbackEnabled = true,
        fsModule = fs,
        webSocketLib = WebSocket,
        logger = console
    } = {}) {
        this.cameraFile = cameraFile;
        this.cameraInventoryService = cameraInventoryService;
        this.streamManager = streamManager;
        this.resolveCameraStreamUrls = resolveCameraStreamUrls;
        this.legacyFileFallbackEnabled = legacyFileFallbackEnabled === true;
        this.fs = fsModule;
        this.webSocketLib = webSocketLib;
        this.logger = logger;
        this.wss = null;
    }

    extractCameraId(requestUrl) {
        const match = String(requestUrl || '').match(/\/stream\/([^\/]+)/);
        return match ? match[1] : null;
    }

    loadCameraById(cameraId) {
        if (this.cameraInventoryService && typeof this.cameraInventoryService.findCamera === 'function') {
            try {
                const camera = this.cameraInventoryService.findCamera(cameraId);
                return { camera, reason: camera ? null : 'camera-not-found' };
            } catch (error) {
                this.logger.error('[WS] Error cargando inventario de cámaras:', error?.message || error);
                if (!this.legacyFileFallbackEnabled) {
                    return { camera: null, reason: 'inventory-unavailable' };
                }
            }
        }

        if (!this.legacyFileFallbackEnabled) {
            return { camera: null, reason: 'inventory-unavailable' };
        }

        const cameras = loadCameraInventory({
            cameraInventoryService: null,
            legacyFilePath: this.cameraFile,
            legacyFileFallbackEnabled: this.legacyFileFallbackEnabled,
            fsModule: this.fs,
            logger: this.logger,
            fileErrorPrefix: '[WS] Error cargando cámaras:'
        });
        if (cameras.length === 0 && !this.fs.existsSync(this.cameraFile)) {
            this.logger.error('[WS] cameras.json no existe');
            return { camera: null, reason: 'missing-camera-file' };
        }
        const camera = cameras.find((item) => item.id === cameraId) || null;
        return { camera, reason: camera ? null : 'camera-not-found' };
    }

    handleConnection(ws, req) {
        const cameraId = this.extractCameraId(req?.url);
        if (!cameraId) {
            ws.close();
            return;
        }

        const loaded = this.loadCameraById(cameraId);
        if (!loaded.camera) {
            if (loaded.reason === 'camera-not-found') {
                this.logger.error(`[WS] Cámara no encontrada: ${cameraId}`);
            }
            ws.close();
            return;
        }

        try {
            const { rtspUrl, allRtspUrls } = this.resolveCameraStreamUrls(loaded.camera);
            this.streamManager.handleConnection(ws, cameraId, rtspUrl, loaded.camera.type, allRtspUrls);
        } catch (error) {
            this.logger.error('[WS] Error resolviendo RTSP de cámara:', error?.message || error);
            ws.close();
        }
    }

    attach(server) {
        this.wss = new this.webSocketLib.Server({ server });
        this.wss.on('connection', (ws, req) => {
            this.handleConnection(ws, req);
        });
        return this.wss;
    }

    stop() {
        if (!this.wss) return;
        if (typeof this.wss.close === 'function') {
            this.wss.close();
        }
        this.wss = null;
    }
}

module.exports = {
    StreamWebSocketGateway
};

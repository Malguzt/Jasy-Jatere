const WebSocket = require('ws');
const { loadCameraById } = require('../cameras/camera-inventory-loader');

class StreamWebSocketGateway {
    constructor({
        cameraFile,
        cameraInventoryService,
        streamManager,
        resolveCameraStreamUrls,
        webSocketLib = WebSocket,
        logger = console
    } = {}) {
        this.cameraFile = cameraFile;
        this.cameraInventoryService = cameraInventoryService;
        this.streamManager = streamManager;
        this.resolveCameraStreamUrls = resolveCameraStreamUrls;
        this.webSocketLib = webSocketLib;
        this.logger = logger;
        this.wss = null;
    }

    extractCameraId(requestUrl) {
        const match = String(requestUrl || '').match(/\/stream\/([^\/]+)/);
        return match ? match[1] : null;
    }

    loadCameraById(cameraId) {
        const loaded = loadCameraById({
            cameraId,
            cameraInventoryService: this.cameraInventoryService,
            logger: this.logger,
            serviceErrorPrefix: '[WS] Error cargando inventario de cámaras:'
        });
        return loaded;
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

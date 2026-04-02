function cameraMotionError(status, message, code = null, details = null) {
    const error = new Error(message || 'Camera motion error');
    error.status = status;
    if (code) error.code = code;
    if (details !== null && details !== undefined) error.details = details;
    return error;
}

class CameraMotionService {
    constructor({
        cameraEventMonitor
    } = {}) {
        this.cameraEventMonitor = cameraEventMonitor;
    }

    ensureMonitor() {
        if (!this.cameraEventMonitor) {
            throw cameraMotionError(500, 'Camera event monitor not configured', 'CAMERA_EVENT_MONITOR_NOT_CONFIGURED');
        }
    }

    listMotionState() {
        this.ensureMonitor();
        if (typeof this.cameraEventMonitor.getAll !== 'function') {
            throw cameraMotionError(500, 'Camera event monitor missing getAll()', 'CAMERA_EVENT_MONITOR_INVALID');
        }
        return this.cameraEventMonitor.getAll() || {};
    }

    getMotionState(cameraId) {
        this.ensureMonitor();
        if (typeof this.cameraEventMonitor.getMotion !== 'function') {
            throw cameraMotionError(500, 'Camera event monitor missing getMotion()', 'CAMERA_EVENT_MONITOR_INVALID');
        }
        return this.cameraEventMonitor.getMotion(cameraId);
    }
}

module.exports = {
    CameraMotionService,
    cameraMotionError
};

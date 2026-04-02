const path = require('path');
const { validateCameraRtspPayload } = require('../../../rtsp-validator');
const { resolveCameraCredentials } = require('../../../camera-credentials');
const { CameraMetadataRepository } = require('../../infrastructure/repositories/camera-metadata-repository');

const DEFAULT_DATA_FILE = path.join(__dirname, '../../../data/cameras.json');
const DEFAULT_METADATA_FILE = path.join(__dirname, '../../../data/metadata/cameras.json');

function savedCamerasError(status, message, code = null, details = null) {
    const error = new Error(message || 'Saved cameras error');
    error.status = status;
    if (code) error.code = code;
    if (details !== null && details !== undefined) error.details = details;
    return error;
}

class SavedCamerasService {
    constructor({
        dataFile = DEFAULT_DATA_FILE,
        metadataFile = DEFAULT_METADATA_FILE,
        repository = null,
        validateRtsp = validateCameraRtspPayload,
        resolveCredentials = resolveCameraCredentials,
        now = () => Date.now()
    } = {}) {
        this.repository = repository || new CameraMetadataRepository({
            primaryFile: dataFile === DEFAULT_DATA_FILE ? metadataFile : dataFile,
            legacyFile: dataFile
        });
        this.validateRtsp = validateRtsp;
        this.resolveCredentials = resolveCredentials;
        this.now = now;
    }

    readCamerasOrThrow() {
        try {
            return this.repository.list();
        } catch (error) {
            throw savedCamerasError(500, 'Database read error', 'DATABASE_READ_ERROR');
        }
    }

    writeCamerasOrThrow(cameras = []) {
        try {
            this.repository.replace(cameras);
        } catch (error) {
            throw savedCamerasError(500, 'Database write error', 'DATABASE_WRITE_ERROR');
        }
    }

    listCameras() {
        return this.readCamerasOrThrow();
    }

    async createCamera(body = {}) {
        const { name, rtspUrl, ip, user, pass } = body;
        if (!rtspUrl) {
            throw savedCamerasError(400, 'rtspUrl es necesario', 'RTSP_URL_REQUIRED');
        }

        const cameras = this.readCamerasOrThrow();
        const creds = this.resolveCredentials({ user, pass });
        const type = body.type || 'single';
        const sourceLabels = Array.isArray(body.sourceLabels) ? body.sourceLabels : [];
        const payloadForValidation = {
            type,
            rtspUrl,
            allRtspUrls: Array.isArray(body.allRtspUrls) ? body.allRtspUrls : [],
            user: creds.user,
            pass: creds.pass
        };

        let validation;
        try {
            validation = await this.validateRtsp(payloadForValidation);
        } catch (error) {
            validation = {
                ok: false,
                errors: [`No se pudo validar RTSP: ${error.message || String(error)}`],
                checks: [],
                warnings: []
            };
        }

        const camera = {
            id: this.now().toString(),
            name: name || 'Cámara Sin Nombre',
            rtspUrl,
            allRtspUrls: payloadForValidation.allRtspUrls,
            sourceLabels,
            type,
            ip,
            user: creds.user,
            pass: creds.pass,
            wsPort: null,
            validation: {
                checkedAt: this.now(),
                ok: !!validation.ok,
                errors: validation.errors || [],
                checks: validation.checks,
                warnings: validation.warnings || []
            }
        };

        cameras.push(camera);
        this.writeCamerasOrThrow(cameras);

        return {
            camera,
            validation,
            acceptedWithIssues: !validation.ok
        };
    }

    deleteCamera(id) {
        const cameras = this.readCamerasOrThrow();
        const filtered = cameras.filter((camera) => camera.id !== id);
        if (filtered.length !== cameras.length) {
            this.writeCamerasOrThrow(filtered);
        }
        return { deleted: cameras.length - filtered.length };
    }

    async updateCamera(id, body = {}) {
        const data = this.readCamerasOrThrow();
        const index = data.findIndex((camera) => camera.id === id);
        if (index === -1) {
            throw savedCamerasError(404, 'Camera not found', 'CAMERA_NOT_FOUND');
        }

        const next = { ...data[index] };
        if (body.user !== undefined) next.user = body.user;
        if (body.pass !== undefined) next.pass = body.pass;
        if (body.name !== undefined) next.name = body.name;
        if (body.rtspUrl !== undefined) next.rtspUrl = body.rtspUrl;
        if (body.type !== undefined) next.type = body.type;
        if (body.allRtspUrls !== undefined) {
            next.allRtspUrls = Array.isArray(body.allRtspUrls) ? body.allRtspUrls : [];
        }
        if (body.sourceLabels !== undefined) {
            next.sourceLabels = Array.isArray(body.sourceLabels) ? body.sourceLabels : [];
        }

        const rtspShapeChanged =
            body.rtspUrl !== undefined ||
            body.type !== undefined ||
            body.allRtspUrls !== undefined;

        let validation = null;
        if (rtspShapeChanged) {
            const payloadForValidation = {
                type: next.type || 'single',
                rtspUrl: next.rtspUrl,
                allRtspUrls: Array.isArray(next.allRtspUrls) ? next.allRtspUrls : [],
                user: next.user,
                pass: next.pass
            };

            try {
                validation = await this.validateRtsp(payloadForValidation);
            } catch (error) {
                validation = {
                    ok: false,
                    errors: [`No se pudo validar RTSP: ${error.message || String(error)}`],
                    checks: [],
                    warnings: []
                };
            }

            next.validation = {
                checkedAt: this.now(),
                ok: validation.ok === undefined ? true : !!validation.ok,
                errors: validation.errors || [],
                checks: validation.checks,
                warnings: validation.warnings || []
            };
        }

        data[index] = next;
        this.writeCamerasOrThrow(data);
        return {
            camera: data[index],
            validation,
            acceptedWithIssues: !!validation && validation.ok === false
        };
    }
}

module.exports = {
    SavedCamerasService,
    savedCamerasError
};

const fs = require('fs');
const path = require('path');

const RECORDINGS_DIR = '/app/recordings';

function recordingCatalogError(status, message, code = null, details = null) {
    const error = new Error(message || 'Recording catalog error');
    error.status = status;
    if (code) error.code = code;
    if (details !== null && details !== undefined) error.details = details;
    return error;
}

function parseIso(value) {
    if (!value) return null;
    const stamp = Date.parse(value);
    if (!Number.isFinite(stamp)) return null;
    return stamp;
}

class RecordingCatalogService {
    constructor({
        repository,
        recordingsDir = RECORDINGS_DIR,
        fsModule = fs
    } = {}) {
        if (!repository) {
            throw recordingCatalogError(
                500,
                'Recording catalog repository is required',
                'RECORDING_CATALOG_REPOSITORY_REQUIRED'
            );
        }
        this.repository = repository;
        this.recordingsDir = recordingsDir;
        this.fs = fsModule;
    }

    listRecordings(query = {}) {
        const q = String(query.q || '').trim().toLowerCase();
        const cameraIdFilter = String(query.camera_id || '').trim();
        const categoryFilter = String(query.category || '').trim().toLowerCase();
        const objectFilter = String(query.object || '').trim().toLowerCase();
        const dateFrom = parseIso(query.date_from);
        const dateTo = parseIso(query.date_to);

        const entries = this.repository.list();
        const filtered = entries.filter((entry) => {
            const categories = Array.isArray(entry.categories) ? entry.categories.map((item) => String(item).toLowerCase()) : [];
            const objects = Array.isArray(entry.objects) ? entry.objects.map((item) => String(item).toLowerCase()) : [];
            const tags = Array.isArray(entry.tags) ? entry.tags.map((item) => String(item).toLowerCase()) : [];
            const eventStamp = parseIso(entry.event_time) || parseIso(entry.recording_started_at) || parseIso(entry.created_at);

            if (cameraIdFilter && String(entry.camera_id || '') !== cameraIdFilter) return false;
            if (categoryFilter && !categories.includes(categoryFilter)) return false;
            if (objectFilter && !objects.includes(objectFilter)) return false;
            if (dateFrom && (!eventStamp || eventStamp < dateFrom)) return false;
            if (dateTo && (!eventStamp || eventStamp > dateTo)) return false;

            if (q) {
                const haystack = [
                    entry.filename || '',
                    entry.camera_name || '',
                    entry.camera_id || '',
                    entry.event_type || '',
                    ...categories,
                    ...objects,
                    ...tags
                ].join(' ').toLowerCase();
                if (!haystack.includes(q)) return false;
            }
            return true;
        });

        return filtered.map((entry) => {
            const filePath = path.join(this.recordingsDir, entry.filename);
            const thumbnailName = String(entry.thumbnail || '').trim() || entry.filename.replace(/\.mp4$/i, '.jpg');
            const thumbnailPath = path.join(this.recordingsDir, thumbnailName);
            const videoExists = this.fs.existsSync(filePath);
            const videoStats = videoExists ? this.fs.statSync(filePath) : null;
            const thumbnailExists = this.fs.existsSync(thumbnailPath);
            const sizeMb = videoStats ? Number((videoStats.size / 1024 / 1024).toFixed(1)) : (entry.size_mb ?? null);
            const created = videoStats ? new Date(videoStats.ctimeMs).toISOString() : (entry.created || entry.created_at || null);

            return {
                filename: entry.filename,
                thumbnail: thumbnailExists ? thumbnailName : null,
                size_mb: sizeMb,
                created,
                camera_id: entry.camera_id || null,
                camera_name: entry.camera_name || null,
                event_type: entry.event_type || null,
                event_time: entry.event_time || null,
                categories: Array.isArray(entry.categories) ? entry.categories : [],
                objects: Array.isArray(entry.objects) ? entry.objects : [],
                tags: Array.isArray(entry.tags) ? entry.tags : [],
                metadata: entry
            };
        });
    }

    upsertRecording(metadata = {}) {
        const filename = String(metadata.filename || '').trim();
        if (!filename) {
            throw recordingCatalogError(400, 'filename is required', 'FILENAME_REQUIRED');
        }

        const nowIso = new Date().toISOString();
        const next = {
            ...metadata,
            filename,
            created_at: metadata.created_at || nowIso,
            updated_at: nowIso
        };
        return this.repository.upsert(next);
    }

    removeRecording(filename) {
        const safeFilename = String(filename || '').trim();
        if (!safeFilename || safeFilename.includes('..') || safeFilename.startsWith('/')) {
            throw recordingCatalogError(400, 'Invalid filename', 'INVALID_FILENAME');
        }

        const filePath = path.join(this.recordingsDir, safeFilename);
        const thumbPath = filePath.replace(/\.mp4$/i, '.jpg');
        const logPath = `${filePath}.log`;
        const metaPath = filePath.replace(/\.mp4$/i, '.meta.json');

        const deleted = [];
        [filePath, thumbPath, logPath, metaPath].forEach((nextPath) => {
            try {
                if (this.fs.existsSync(nextPath)) {
                    this.fs.unlinkSync(nextPath);
                    if (nextPath === filePath) deleted.push('video');
                    else if (nextPath === thumbPath) deleted.push('thumbnail');
                    else if (nextPath === logPath) deleted.push('log');
                    else deleted.push('metadata');
                }
            } catch (error) {}
        });

        const removed = this.repository.remove(safeFilename);
        if (removed && !deleted.includes('catalog')) deleted.push('catalog');
        return {
            filename: safeFilename,
            deleted,
            removedFromCatalog: removed
        };
    }
}

module.exports = {
    RecordingCatalogService,
    recordingCatalogError
};

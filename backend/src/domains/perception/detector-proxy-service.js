class DetectorProxyService {
    constructor({
        detectorUrl = process.env.DETECTOR_URL || 'http://localhost:5000',
        fetchImpl = fetch
    } = {}) {
        this.detectorUrl = String(detectorUrl || 'http://localhost:5000').replace(/\/$/, '');
        this.fetch = fetchImpl;
    }

    async readStatus() {
        try {
            const response = await this.fetch(`${this.detectorUrl}/status`);
            return await response.json();
        } catch (error) {
            return { success: false, cameras: {}, error: 'Detector service not available' };
        }
    }

    async readEvents() {
        try {
            const response = await this.fetch(`${this.detectorUrl}/events`);
            return await response.json();
        } catch (error) {
            return { success: false, events: [] };
        }
    }

    async listRecordings(query = {}) {
        try {
            const queryString = new URLSearchParams(query).toString();
            const suffix = queryString ? `?${queryString}` : '';
            const response = await this.fetch(`${this.detectorUrl}/recordings${suffix}`);
            return await response.json();
        } catch (error) {
            return { success: false, recordings: [] };
        }
    }

    async deleteRecording(filename) {
        try {
            const safeFilename = encodeURIComponent(String(filename || ''));
            const response = await this.fetch(`${this.detectorUrl}/recordings/${safeFilename}`, { method: 'DELETE' });
            return await response.json();
        } catch (error) {
            return { success: false, error: 'Detector service not available' };
        }
    }
}

module.exports = {
    DetectorProxyService
};

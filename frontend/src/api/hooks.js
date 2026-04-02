import { useEffect, useState } from 'react';
import { apiClient } from './client';

export function useRecordingsData() {
    const [recordings, setRecordings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const refresh = async () => {
        setLoading(true);
        try {
            const data = await apiClient.listRecordings();
            if (data?.success) {
                setRecordings(Array.isArray(data.recordings) ? data.recordings : []);
                setError(null);
            } else {
                setError(new Error(data?.error || 'Failed to load recordings'));
            }
        } catch (fetchError) {
            setError(fetchError);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        refresh();
    }, []);

    return {
        recordings,
        loading,
        error,
        refresh,
        setRecordings
    };
}

export function useConnectivityData({ pollMs = 5000 } = {}) {
    const [payload, setPayload] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const refresh = async () => {
        try {
            const data = await apiClient.getConnectivitySnapshot();
            setPayload(data);
            setError(null);
        } catch (fetchError) {
            setError(fetchError);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        let cancelled = false;

        const runOnce = async () => {
            if (cancelled) return;
            await refresh();
        };

        runOnce();
        const timer = setInterval(runOnce, Math.max(1000, Number(pollMs) || 5000));

        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [pollMs]);

    return {
        payload,
        setPayload,
        loading,
        error,
        refresh
    };
}

export function useSavedCamerasData() {
    const [savedCameras, setSavedCameras] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const refresh = async () => {
        setLoading(true);
        try {
            const data = await apiClient.listSavedCameras();
            if (data?.success) {
                setSavedCameras(Array.isArray(data.cameras) ? data.cameras : []);
                setError(null);
            } else {
                setError(new Error(data?.error || 'Failed to load cameras'));
            }
        } catch (fetchError) {
            setError(fetchError);
        } finally {
            setLoading(false);
        }
    };

    const removeCamera = async (cameraId) => {
        try {
            const result = await apiClient.deleteSavedCamera(cameraId);
            await refresh();
            return result;
        } catch (deleteError) {
            setError(deleteError);
            return null;
        }
    };

    useEffect(() => {
        refresh();
    }, []);

    return {
        savedCameras,
        loading,
        error,
        refresh,
        removeCamera,
        setSavedCameras
    };
}

export function useDetectorStatusData({ pollMs = 2000 } = {}) {
    const [detectorStatus, setDetectorStatus] = useState({});

    useEffect(() => {
        let cancelled = false;

        const readStatus = async () => {
            try {
                const data = await apiClient.getDetectorStatus();
                if (cancelled) return;
                if (data?.cameras) {
                    setDetectorStatus(data.cameras);
                }
            } catch (error) {}
        };

        readStatus();
        const timer = setInterval(readStatus, Math.max(1000, Number(pollMs) || 2000));
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [pollMs]);

    return {
        detectorStatus,
        setDetectorStatus
    };
}

export function useMapData({ pollMs = 1800 } = {}) {
    const [latestMap, setLatestMap] = useState(null);
    const [history, setHistory] = useState([]);
    const [activeMapId, setActiveMapId] = useState(null);
    const [savedCameras, setSavedCameras] = useState([]);
    const [savedCameraCount, setSavedCameraCount] = useState(0);
    const [job, setJob] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const refreshMapData = async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const [latestPayload, historyPayload, savedPayload] = await Promise.all([
                apiClient.getLatestMap().catch(() => null),
                apiClient.getMapHistory().catch(() => null),
                apiClient.listSavedCameras().catch(() => null)
            ]);

            if (latestPayload?.success) {
                setLatestMap(latestPayload.map || null);
            } else {
                setLatestMap(null);
            }

            if (historyPayload?.success) {
                setHistory(Array.isArray(historyPayload.maps) ? historyPayload.maps : []);
                setActiveMapId(historyPayload.activeMapId || null);
            } else {
                setHistory([]);
                setActiveMapId(null);
            }

            if (savedPayload?.success) {
                const cameras = Array.isArray(savedPayload.cameras) ? savedPayload.cameras : [];
                setSavedCameras(cameras);
                setSavedCameraCount(cameras.length);
            } else {
                setSavedCameras([]);
                setSavedCameraCount(0);
            }
        } catch (fetchError) {
            setError(fetchError?.message || 'No se pudo cargar mapa');
        } finally {
            setLoading(false);
        }
    };

    const startMapGeneration = async (body = {}) => {
        setBusy(true);
        setError('');
        try {
            const payload = await apiClient.createMapJob(body);
            if (!payload?.success) {
                throw new Error(payload?.error || 'No se pudo iniciar la generación');
            }
            setJob(payload.job || null);
            return payload.job || null;
        } catch (startError) {
            setError(startError?.message || 'No se pudo iniciar la generación');
            return null;
        } finally {
            setBusy(false);
        }
    };

    const retryMapGeneration = async (jobId, body = {}) => {
        if (!jobId) return null;
        setBusy(true);
        setError('');
        try {
            const payload = await apiClient.retryMapJob(jobId, body);
            if (!payload?.success) {
                throw new Error(payload?.error || 'No se pudo reintentar la generación');
            }
            setJob(payload.job || null);
            return payload.job || null;
        } catch (retryError) {
            setError(retryError?.message || 'No se pudo reintentar la generación');
            return null;
        } finally {
            setBusy(false);
        }
    };

    const cancelMapGeneration = async (jobId) => {
        if (!jobId) return null;
        setBusy(true);
        try {
            const payload = await apiClient.cancelMapJob(jobId);
            if (!payload?.success) {
                throw new Error(payload?.error || 'No se pudo cancelar');
            }
            setJob(payload.job || null);
            return payload.job || null;
        } catch (cancelError) {
            setError(cancelError?.message || 'No se pudo cancelar');
            return null;
        } finally {
            setBusy(false);
        }
    };

    const promoteMapVersion = async (mapId) => {
        if (!mapId) return false;
        setBusy(true);
        try {
            const payload = await apiClient.promoteMap(mapId);
            if (!payload?.success) {
                throw new Error(payload?.error || 'No se pudo promover el mapa');
            }
            await refreshMapData(true);
            return true;
        } catch (promoteError) {
            setError(promoteError?.message || 'No se pudo promover el mapa');
            return false;
        } finally {
            setBusy(false);
        }
    };

    const saveManualMapVersion = async (body = {}) => {
        setBusy(true);
        setError('');
        try {
            const payload = await apiClient.saveManualMap(body);
            if (!payload?.success) {
                throw new Error(payload?.error || 'No se pudo guardar mapa manual');
            }
            setLatestMap(payload.map || null);
            await refreshMapData(true);
            return payload.map || null;
        } catch (manualError) {
            setError(manualError?.message || 'No se pudo guardar mapa manual');
            return null;
        } finally {
            setBusy(false);
        }
    };

    useEffect(() => {
        refreshMapData(false).catch(() => {});
    }, []);

    useEffect(() => {
        if (!job || !['queued', 'running'].includes(job.status)) return undefined;

        const interval = setInterval(async () => {
            try {
                const payload = await apiClient.getMapJob(job.id);
                const nextJob = payload?.job || null;
                setJob(nextJob);
                if (!nextJob || !['queued', 'running'].includes(nextJob.status)) {
                    await refreshMapData(true);
                    if (nextJob?.status === 'failed') {
                        setError(nextJob.error || 'Fallo en generación de mapa');
                    } else if (nextJob?.status === 'cancelled') {
                        setError('Generación cancelada');
                    }
                }
            } catch (pollError) {
                setError(pollError?.message || 'Error consultando estado de generación');
            }
        }, Math.max(1200, Number(pollMs) || 1800));

        return () => clearInterval(interval);
    }, [job?.id, job?.status, pollMs]);

    return {
        latestMap,
        history,
        activeMapId,
        savedCameras,
        savedCameraCount,
        job,
        loading,
        busy,
        error,
        setError,
        refreshMapData,
        startMapGeneration,
        retryMapGeneration,
        cancelMapGeneration,
        promoteMapVersion,
        saveManualMapVersion
    };
}

export function useDiscoveryData() {
    const [cameras, setCameras] = useState([]);
    const [isScanning, setIsScanning] = useState(false);
    const [error, setError] = useState('');

    const startScan = async () => {
        setIsScanning(true);
        setError('');
        setCameras([]);
        try {
            const data = await apiClient.discoverCameras();
            if (data?.success) {
                setCameras(Array.isArray(data.devices) ? data.devices : []);
                return {
                    success: true,
                    devices: Array.isArray(data.devices) ? data.devices : []
                };
            }
            const message = data?.error || 'Error scanning cameras';
            setError(message);
            return { success: false, error: message };
        } catch (scanError) {
            const message = scanError?.message || 'Error de conexión con el backend.';
            setError(message);
            return { success: false, error: message };
        } finally {
            setIsScanning(false);
        }
    };

    return {
        cameras,
        isScanning,
        error,
        setError,
        startScan
    };
}

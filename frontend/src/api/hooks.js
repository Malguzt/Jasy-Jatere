import { useEffect, useRef, useState } from 'react';
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

    const deleteRecording = async (filename) => {
        try {
            const data = await apiClient.deleteRecording(filename);
            if (data?.success) {
                await refresh();
                return { success: true };
            }
            const nextError = data?.error || 'Error al borrar grabación';
            setError(new Error(nextError));
            return { success: false, error: nextError };
        } catch (deleteError) {
            setError(deleteError);
            return { success: false, error: 'Error de red al intentar borrar.', details: deleteError };
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
        deleteRecording,
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

    const forceProbe = async () => {
        try {
            const data = await apiClient.forceConnectivityProbe();
            setPayload(data);
            setError(null);
            return data;
        } catch (probeError) {
            setError(probeError);
            throw probeError;
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
        refresh,
        forceProbe
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

export function useCameraOnboardingData(camera) {
    const [user, setUser] = useState('');
    const [pass, setPass] = useState('');
    const [loading, setLoading] = useState(false);
    const [details, setDetails] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        setUser('');
        setPass('');
        setLoading(false);
        setDetails(null);
        setError('');
    }, [camera?.address]);

    const connect = async () => {
        setLoading(true);
        setError('');
        try {
            const data = await apiClient.connectCamera({ url: camera?.address, user, pass });
            if (data?.success) {
                setDetails(data);
                return { success: true, details: data };
            }
            const nextError = data?.error || 'Error de autenticación. Verifica las credenciales.';
            setError(nextError);
            return { success: false, error: nextError };
        } catch (connectError) {
            const nextError = 'Error de conexión con el backend.';
            setError(nextError);
            return { success: false, error: nextError, details: connectError };
        } finally {
            setLoading(false);
        }
    };

    const saveProfile = async (profile) => {
        if (!profile?.rtspUrl) {
            return { success: false, error: 'RTSP no disponible para guardar.' };
        }

        const payload = {
            name: `${camera?.name || 'Cámara'} - ${profile.name}`,
            rtspUrl: profile.rtspUrl,
            ip: camera?.address,
            user,
            pass
        };

        if (profile.token === 'combined_ai') {
            const profiles = Array.isArray(details?.profiles) ? details.profiles : [];
            const candidates = profiles
                .filter((item) => item.token !== 'combined_ai' && item.rtspUrl)
                .map((item) => ({
                    url: item.rtspUrl,
                    label: `${item.name || 'Canal'} ${item.resolution ? `(${item.resolution})` : ''}`.trim()
                }));
            payload.type = 'combined';
            payload.allRtspUrls = candidates.map((candidate) => candidate.url);
            payload.sourceLabels = candidates.map((candidate) => candidate.label);
        }

        try {
            const data = await apiClient.createSavedCamera(payload);
            if (!data?.success) {
                const validationErrors = (data?.validation?.errors || []).join(' | ');
                const detail = validationErrors ? `\nDetalle: ${validationErrors}` : '';
                return {
                    success: false,
                    error: `Error al guardar: ${data?.error || 'Error desconocido'}${detail}`
                };
            }

            if (data?.validation && data.validation.ok === false) {
                const validationErrors = (data?.validation?.errors || []).join(' | ');
                const detail = validationErrors ? `\nDiagnóstico: ${validationErrors}` : '';
                return {
                    success: true,
                    warning: `Guardada con advertencias para diagnóstico.${detail}`
                };
            }
            return { success: true, message: '¡Guardada en el Dashboard!' };
        } catch (saveError) {
            return { success: false, error: 'Error de red', details: saveError };
        }
    };

    return {
        user,
        setUser,
        pass,
        setPass,
        loading,
        details,
        error,
        connect,
        saveProfile
    };
}

export function useCameraStreamData(camera) {
    const [localCamera, setLocalCamera] = useState(camera);
    const [isPtzAction, setIsPtzAction] = useState(false);
    const [lightOn, setLightOn] = useState(false);
    const [lightLoading, setLightLoading] = useState(false);
    const capabilitiesRef = useRef(null);

    useEffect(() => {
        setLocalCamera(camera);
        setIsPtzAction(false);
        setLightOn(false);
        setLightLoading(false);
        capabilitiesRef.current = null;
    }, [camera?.id]);

    const resolveStreamTransport = async () => {
        try {
            const sessionPayload = await apiClient.getStreamSession(localCamera?.id);
            const session = sessionPayload?.success ? sessionPayload.session : null;
            if (session && typeof session === 'object') {
                const preferred = String(session.preferredTransport || '').toLowerCase();
                const selected = String(session.selectedTransport || '').toLowerCase();
                const webrtcFallbackWarning = preferred === 'webrtc' && selected === 'jsmpeg'
                    ? 'WebRTC policy selected. Falling back to JSMpeg transport in this build.'
                    : '';
                return {
                    transport: selected || null,
                    streamUrl: session?.transports?.jsmpeg?.url || null,
                    streamPath: session?.transports?.jsmpeg?.path || null,
                    jsmpegEnabled: session?.transports?.jsmpeg?.enabled === true,
                    webrtcEnabled: session?.transports?.webrtc?.enabled === true,
                    webrtcSignalingPath: session?.transports?.webrtc?.signalingPath || '/api/streams/webrtc/sessions',
                    warning: webrtcFallbackWarning
                };
            }
        } catch (error) {}

        if (!capabilitiesRef.current) {
            try {
                const payload = await apiClient.getStreamCapabilities();
                if (payload?.success && payload.capabilities) {
                    capabilitiesRef.current = payload.capabilities;
                }
            } catch (error) {}
        }

        const capabilities = capabilitiesRef.current || null;
        const preferred = String(capabilities?.defaultTransport || 'jsmpeg').toLowerCase();
        const jsmpegEnabled = capabilities?.transports?.jsmpeg?.enabled !== false;
        const webrtcFallbackWarning = preferred === 'webrtc' && jsmpegEnabled
            ? 'WebRTC policy selected. Falling back to JSMpeg transport in this build.'
            : '';

        return {
            transport: jsmpegEnabled ? 'jsmpeg' : null,
            streamUrl: null,
            streamPath: jsmpegEnabled ? `/stream/${encodeURIComponent(String(localCamera?.id || ''))}` : null,
            jsmpegEnabled,
            webrtcEnabled: false,
            webrtcSignalingPath: '/api/streams/webrtc/sessions',
            warning: webrtcFallbackWarning
        };
    };

    const updateAuthCredentials = async (credentials = {}) => {
        try {
            const data = await apiClient.patchSavedCamera(localCamera?.id, {
                user: credentials.user,
                pass: credentials.pass
            });
            if (!data?.success || !data?.camera) {
                return { success: false, error: data?.error || 'Error actualizando credenciales' };
            }
            setLocalCamera(data.camera);
            return { success: true, camera: data.camera };
        } catch (error) {
            return { success: false, error: 'Error de red al actualizar', details: error };
        }
    };

    const createWebRtcSession = async (payload = {}) => {
        return apiClient.createWebRtcSession(payload);
    };

    const submitWebRtcCandidate = async (sessionId, payload = {}) => {
        if (!sessionId) {
            return { success: false, error: 'Missing WebRTC session id' };
        }
        return apiClient.submitWebRtcCandidate(sessionId, payload);
    };

    const closeWebRtcSession = async (sessionId, payload = {}) => {
        if (!sessionId) {
            return { success: false, error: 'Missing WebRTC session id' };
        }
        return apiClient.closeWebRtcSession(sessionId, payload);
    };

    const stopPtz = async () => {
        try {
            await apiClient.stopPtz({
                url: localCamera?.ip,
                user: localCamera?.user,
                pass: localCamera?.pass || ''
            });
        } finally {
            setIsPtzAction(false);
        }
    };

    const movePtz = async (direction) => {
        if (!direction) return;
        setIsPtzAction(true);
        try {
            await apiClient.movePtz({
                url: localCamera?.ip,
                user: localCamera?.user,
                pass: localCamera?.pass || '',
                direction
            });
            setTimeout(() => {
                stopPtz().catch(() => {});
            }, 600);
        } catch (error) {
            setIsPtzAction(false);
            throw error;
        }
    };

    const takeSnapshot = async () => apiClient.takeCameraSnapshot({
        url: localCamera?.ip,
        user: localCamera?.user,
        pass: localCamera?.pass || ''
    });

    const toggleLight = async () => {
        if (!localCamera?.ip || lightLoading) {
            return { success: false, error: 'Camera does not support light control' };
        }
        setLightLoading(true);
        try {
            const nextEnabled = !lightOn;
            const data = await apiClient.toggleCameraLight({
                url: localCamera.ip,
                user: localCamera.user,
                pass: localCamera.pass || '',
                enabled: nextEnabled
            });
            if (!data?.success) {
                throw new Error(data?.error || 'No se pudo cambiar la luz');
            }
            setLightOn(nextEnabled);
            return { success: true, enabled: nextEnabled };
        } catch (error) {
            return { success: false, error: error?.message || 'No se pudo controlar la luz ONVIF en esta cámara.' };
        } finally {
            setLightLoading(false);
        }
    };

    return {
        localCamera,
        isPtzAction,
        lightOn,
        lightLoading,
        setLocalCamera,
        resolveStreamTransport,
        updateAuthCredentials,
        movePtz,
        stopPtz,
        takeSnapshot,
        toggleLight,
        createWebRtcSession,
        submitWebRtcCandidate,
        closeWebRtcSession
    };
}

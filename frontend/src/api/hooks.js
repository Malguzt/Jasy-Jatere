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

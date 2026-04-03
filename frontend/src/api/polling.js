import { useEffect } from 'react';

export function usePollingTask({
    task,
    pollMs,
    minPollMs,
    deps = []
}) {
    useEffect(() => {
        let cancelled = false;
        const runTask = async () => {
            if (cancelled) return;
            await task();
        };

        runTask();
        const timer = setInterval(runTask, Math.max(minPollMs, Number(pollMs) || minPollMs));

        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, deps);
}

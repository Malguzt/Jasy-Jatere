import React, { useMemo, useState } from 'react';
import { Activity, RefreshCw, Wifi, WifiOff, Gauge, Timer, Server, AlertTriangle } from 'lucide-react';
import { useConnectivityData } from '../api/hooks';

const POLL_MS = 5000;

function formatNumber(v, digits = 1) {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
    return Number(v).toFixed(digits);
}

function formatWhen(ts) {
    if (!ts) return 'sin datos';
    return new Date(ts).toLocaleTimeString();
}

function metricColor(value, goodWhenLower = false, warn = 60, bad = 120) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return 'var(--text-main)';
    const n = Number(value);
    if (goodWhenLower) {
        if (n <= warn) return '#63e6be';
        if (n <= bad) return '#ffd166';
        return '#ff6b6b';
    }
    if (n >= bad) return '#63e6be';
    if (n >= warn) return '#ffd166';
    return '#ff6b6b';
}

function statusBadge(last = {}) {
    const availability = last?.availability || (last?.up ? 'up' : 'down');
    if (availability === 'up') {
        return { label: 'ONLINE', color: '#63e6be', border: 'rgba(99,230,190,0.55)', bg: 'rgba(99,230,190,0.1)' };
    }
    if (availability === 'degraded') {
        return { label: 'DEGRADED', color: '#ffd166', border: 'rgba(255,209,102,0.6)', bg: 'rgba(255,209,102,0.12)' };
    }
    return { label: 'OFFLINE', color: '#ff6b6b', border: 'rgba(255,107,107,0.6)', bg: 'rgba(255,107,107,0.12)' };
}

function Sparkline({ values, color = '#66fcf1', height = 52 }) {
    const width = 280;
    const nums = values
        .map((v) => (v === null || v === undefined ? null : Number(v)))
        .filter((v) => v !== null && Number.isFinite(v));

    if (nums.length < 2) {
        return (
            <div style={{
                height,
                border: '1px dashed rgba(255,255,255,0.2)',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.72rem',
                opacity: 0.65
            }}>
                Aún sin serie suficiente
            </div>
        );
    }

    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const range = Math.max(1e-6, max - min);
    const all = values.map((v) => (v === null || v === undefined ? null : Number(v)));
    const stepX = width / Math.max(1, all.length - 1);
    const points = all
        .map((v, i) => {
            if (!Number.isFinite(v)) return null;
            const x = i * stepX;
            const y = height - ((v - min) / range) * (height - 6) - 3;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .filter(Boolean);

    return (
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
            style={{ borderRadius: '8px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <polyline fill="none" stroke={color} strokeWidth="2.2" points={points.join(' ')} />
        </svg>
    );
}

const ConnectivityMonitor = () => {
    const { payload, loading, error, refresh, forceProbe: triggerProbe } = useConnectivityData({ pollMs: POLL_MS });
    const [forcingProbe, setForcingProbe] = useState(false);

    const forceProbe = async () => {
        setForcingProbe(true);
        try {
            await triggerProbe();
        } catch (e) {
            console.error('Force probe failed', e);
        } finally {
            setForcingProbe(false);
        }
    };

    const summary = payload?.summary || {};
    const cameras = payload?.cameras || [];
    const sortedCameras = useMemo(() => {
        return [...cameras].sort((a, b) => {
            const aUp = a?.last?.up ? 1 : 0;
            const bUp = b?.last?.up ? 1 : 0;
            if (aUp !== bUp) return bUp - aUp;
            return (a?.name || '').localeCompare(b?.name || '');
        });
    }, [cameras]);

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                <RefreshCw className="spin" size={20} style={{ marginRight: '0.6rem' }} />
                Cargando monitoreo de conectividad...
            </div>
        );
    }

    return (
        <div style={{ height: '100%', overflow: 'auto', padding: '1rem 1.2rem', background: '#0b0c10' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.9rem' }}>
                <h2 style={{ color: '#fff', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Activity size={18} color="var(--accent-color)" />
                    Monitoreo de Conectividad de Cámaras
                </h2>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    {error && (
                        <span style={{ fontSize: '0.72rem', color: '#ff9f9f' }}>
                            Error de conectividad
                        </span>
                    )}
                    <span style={{ fontSize: '0.72rem', opacity: 0.7 }}>
                        Actualizado: {formatWhen(payload?.updatedAt)}
                    </span>
                    <button className="btn" style={{ padding: '0.35rem 0.7rem', fontSize: '0.78rem' }} onClick={refresh}>
                        <RefreshCw size={14} />
                        Refrescar
                    </button>
                    <button className="btn" style={{ padding: '0.35rem 0.7rem', fontSize: '0.78rem' }} onClick={forceProbe} disabled={forcingProbe}>
                        {forcingProbe ? <RefreshCw className="spin" size={14} /> : <RefreshCw size={14} />}
                        Sondear Ahora
                    </button>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.6rem', marginBottom: '0.9rem' }}>
                <KpiCard icon={<Server size={15} />} label="Cámaras" value={summary.cameras ?? 0} />
                <KpiCard icon={(summary.offline || 0) > 0 ? <WifiOff size={15} /> : <Wifi size={15} />} label="Online" value={`${summary.online ?? 0}/${summary.cameras ?? 0}`} />
                <KpiCard icon={<AlertTriangle size={15} />} label="Degradadas" value={summary.degraded ?? 0} />
                <KpiCard icon={(summary.sourcesOffline || 0) > 0 ? <WifiOff size={15} /> : <Wifi size={15} />} label="Canales Online" value={`${summary.sourcesOnline ?? 0}/${summary.sources ?? 0}`} />
                <KpiCard icon={<AlertTriangle size={15} />} label="Canales Degrad." value={summary.sourcesDegraded ?? 0} />
                <KpiCard icon={<Server size={15} />} label="Keepalive Activo" value={`${summary.keepaliveActive ?? 0}/${summary.keepaliveDesired ?? 0}`} />
                <KpiCard icon={<Timer size={15} />} label="Latencia Promedio" value={`${formatNumber(summary.avgLatencyMs, 0)} ms`} />
                <KpiCard icon={<Gauge size={15} />} label="Bitrate Entrada Prom." value={`${formatNumber(summary.avgInputKbps, 0)} kbps`} />
                <KpiCard icon={<Activity size={15} />} label="Salud Decode Prom." value={`${formatNumber(summary.avgDecodeHealth, 0)} %`} />
                <KpiCard icon={<Server size={15} />} label="Clientes WS Totales" value={summary.wsClients ?? 0} />
            </div>

            {sortedCameras.length === 0 ? (
                <div className="glass-panel" style={{ textAlign: 'center', opacity: 0.75 }}>
                    No hay cámaras guardadas para monitorear.
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(430px, 1fr))', gap: '0.8rem' }}>
                    {sortedCameras.map((cam) => {
                        const last = cam.last || {};
                        const history = cam.history || [];
                        const latencySeries = history.map((p) => p.latencyMs);
                        const bitrateSeries = history.map((p) => p.inputKbps);
                        const decodeSeries = history.map((p) => p.decodeHealth);
                        const wsSeries = history.map((p) => p.wsKbps);
                        const up = !!last.up;
                        const badge = statusBadge(last);
                        const sources = cam.sources || [];

                        return (
                            <div key={cam.id} className="glass-panel" style={{ padding: '0.8rem 0.8rem 0.7rem 0.8rem', borderColor: up ? 'rgba(102,252,241,0.35)' : 'rgba(255,107,107,0.45)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.55rem' }}>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontSize: '0.86rem', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cam.name}</div>
                                        <div style={{ fontSize: '0.7rem', opacity: 0.72 }}>
                                            {cam.type || 'single'} · transporte: {last.transport || 'n/d'} · check: {formatWhen(last.checkedAt)}
                                        </div>
                                    </div>
                                    <span style={{
                                        fontSize: '0.7rem',
                                        padding: '0.12rem 0.45rem',
                                        borderRadius: '999px',
                                        border: `1px solid ${badge.border}`,
                                        color: badge.color,
                                        background: badge.bg
                                    }}>
                                        {badge.label}
                                    </span>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '0.45rem', marginBottom: '0.65rem' }}>
                                    <MiniStat label="Latencia" value={`${formatNumber(last.latencyMs, 0)} ms`} color={metricColor(last.latencyMs, true, 180, 450)} />
                                    <MiniStat label="Input" value={`${formatNumber(last.inputKbps, 0)} kbps`} color={metricColor(last.inputKbps, false, 450, 900)} />
                                    <MiniStat label="Decode" value={`${formatNumber(last.decodeHealth, 0)} %`} color={metricColor(last.decodeHealth, false, 65, 85)} />
                                    <MiniStat label="WS Out" value={`${formatNumber(last?.ws?.outputKbps, 0)} kbps`} color={metricColor(last?.ws?.outputKbps, false, 350, 800)} />
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.55rem', marginBottom: '0.5rem' }}>
                                    <ChartBlock title="Latencia RTSP (ms)" color="#66fcf1" values={latencySeries} />
                                    <ChartBlock title="Bitrate Entrada (kbps)" color="#8ce99a" values={bitrateSeries} />
                                    <ChartBlock title="Salud Decode (%)" color="#ffd166" values={decodeSeries} />
                                    <ChartBlock title="Egreso WS (kbps)" color="#a5d8ff" values={wsSeries} />
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: '0.45rem', fontSize: '0.68rem', opacity: 0.85 }}>
                                    <div>WS clientes: <b>{last?.ws?.clients ?? 0}</b></div>
                                    <div>Restarts: <b>{last?.ws?.restarts ?? 0}</b></div>
                                    <div>Stalls: <b>{last?.ws?.stalls ?? 0}</b></div>
                                    <div>Keepalive: <b>{last?.ws?.keepalive?.active ? 'ON' : (last?.ws?.keepalive?.desired ? 'OFF' : 'N/A')}</b></div>
                                    <div>KA restarts: <b>{last?.ws?.keepalive?.restarts ?? 0}</b></div>
                                    <div>KA last byte: <b>{formatWhen(last?.ws?.keepalive?.lastByteAt)}</b></div>
                                    <div>Codec: <b>{last.codec || 'n/d'}</b></div>
                                    <div>Resolución: <b>{last.width && last.height ? `${last.width}x${last.height}` : 'n/d'}</b></div>
                                    <div>FPS: <b>{formatNumber(last.fps, 1)}</b></div>
                                </div>

                                {!up && (last.reason || last?.ws?.lastError) && (
                                    <div style={{ marginTop: '0.55rem', fontSize: '0.68rem', color: '#ffb3b3', display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                                        <AlertTriangle size={12} />
                                        {last.reason || last?.ws?.lastError}
                                    </div>
                                )}

                                {sources.length > 0 && (
                                    <div style={{ marginTop: '0.7rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.6rem' }}>
                                        <div style={{ fontSize: '0.7rem', opacity: 0.82, marginBottom: '0.45rem' }}>
                                            Calidad por canal fuente (crudo RTSP)
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))', gap: '0.45rem' }}>
                                            {sources.map((src) => {
                                                const srcLast = src.last || {};
                                                const srcUp = !!srcLast.up;
                                                const srcBadge = statusBadge(srcLast);
                                                const srcHistory = src.history || [];
                                                const srcLatency = srcHistory.map((p) => p.latencyMs);
                                                const srcInput = srcHistory.map((p) => p.inputKbps);
                                                return (
                                                    <div key={`${cam.id}-${src.id}`} style={{ border: `1px solid ${srcUp ? 'rgba(99,230,190,0.35)' : (srcBadge.label === 'DEGRADED' ? 'rgba(255,209,102,0.45)' : 'rgba(255,107,107,0.4)')}`, borderRadius: '8px', padding: '0.4rem' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.35rem', marginBottom: '0.25rem' }}>
                                                            <div style={{ fontSize: '0.66rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                                #{(src.index ?? 0) + 1} {src.name || 'Canal'}
                                                            </div>
                                                            <span style={{ fontSize: '0.62rem', color: srcBadge.color }}>
                                                                {srcBadge.label === 'ONLINE' ? 'UP' : (srcBadge.label === 'DEGRADED' ? 'DEGRADED' : 'DOWN')}
                                                            </span>
                                                        </div>
                                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.3rem', fontSize: '0.62rem', marginBottom: '0.25rem' }}>
                                                            <div>Lat: <b style={{ color: metricColor(srcLast.latencyMs, true, 180, 450) }}>{formatNumber(srcLast.latencyMs, 0)} ms</b></div>
                                                            <div>In: <b style={{ color: metricColor(srcLast.inputKbps, false, 450, 900) }}>{formatNumber(srcLast.inputKbps, 0)} kbps</b></div>
                                                            <div>Decode: <b style={{ color: metricColor(srcLast.decodeHealth, false, 65, 85) }}>{formatNumber(srcLast.decodeHealth, 0)}%</b></div>
                                                            <div>Tr: <b>{srcLast.transport || 'n/d'}</b></div>
                                                        </div>
                                                        <Sparkline values={srcLatency} color="#66fcf1" height={34} />
                                                        <div style={{ height: '0.18rem' }} />
                                                        <Sparkline values={srcInput} color="#8ce99a" height={34} />
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

const KpiCard = ({ icon, label, value }) => (
    <div className="glass-panel" style={{ padding: '0.55rem 0.65rem', borderRadius: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.68rem', opacity: 0.8 }}>{icon}{label}</div>
        <div style={{ fontSize: '1.02rem', color: '#fff', fontWeight: 600, marginTop: '0.2rem' }}>{value}</div>
    </div>
);

const MiniStat = ({ label, value, color }) => (
    <div style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', padding: '0.36rem 0.44rem' }}>
        <div style={{ fontSize: '0.62rem', opacity: 0.72 }}>{label}</div>
        <div style={{ fontSize: '0.78rem', color: color || '#fff', marginTop: '0.12rem', fontWeight: 600 }}>{value}</div>
    </div>
);

const ChartBlock = ({ title, values, color }) => (
    <div>
        <div style={{ fontSize: '0.62rem', opacity: 0.75, marginBottom: '0.2rem' }}>{title}</div>
        <Sparkline values={values} color={color} />
    </div>
);

export default ConnectivityMonitor;

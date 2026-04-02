import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, Clock3, Play, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import MapToolbar from './MapToolbar';
import { useMapData } from '../api/hooks';

const CATEGORY_COLORS = {
    vehiculo: '#4dabf7',
    electrodomestico: '#ffd43b',
    vegetacion: '#69db7c',
    persona: '#f783ac',
    animal: '#ffa94d',
    estructura: '#ced4da'
};

const CATEGORY_OPTIONS = ['estructura', 'vehiculo', 'electrodomestico', 'vegetacion', 'persona', 'animal'];

function formatDate(ts) {
    if (!ts) return '—';
    try {
        return new Date(ts).toLocaleString();
    } catch (error) {
        return '—';
    }
}

function getStatusColor(status) {
    if (status === 'done') return '#63e6be';
    if (status === 'failed') return '#ff6b6b';
    if (status === 'cancelled') return '#ffa94d';
    return '#66fcf1';
}

function toFiniteOrFallback(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function makeRowId(prefix = 'row') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildDefaultManualLayout(savedCameras = []) {
    const cameras = Array.isArray(savedCameras) ? savedCameras : [];
    const count = Math.max(1, cameras.length);
    const radius = Math.max(8, count * 3.5);

    return cameras.map((camera, index) => {
        const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
        const x = Number((radius * Math.cos(angle)).toFixed(2));
        const y = Number((radius * Math.sin(angle)).toFixed(2));
        const yawDeg = Number((((angle + Math.PI) * 180) / Math.PI).toFixed(1));
        return {
            id: String(camera.id),
            label: camera.name || `Camara ${index + 1}`,
            x,
            y,
            yawDeg
        };
    });
}

function createEmptyManualObject(defaultCameraId = '') {
    return {
        rowId: makeRowId('obj'),
        label: '',
        category: 'estructura',
        x: 0,
        y: 0,
        confidence: 0.8,
        cameraId: defaultCameraId || ''
    };
}

const MapView = () => {
    const {
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
    } = useMapData({ pollMs: 1800 });

    const [manualMode, setManualMode] = useState(false);
    const [manualCameras, setManualCameras] = useState([]);
    const [manualObjects, setManualObjects] = useState([]);
    const [selectedCameraId, setSelectedCameraId] = useState(null);
    const [selectedObjectId, setSelectedObjectId] = useState(null);

    useEffect(() => {
        if (savedCameras.length > 0 && manualCameras.length === 0) {
            setManualCameras(buildDefaultManualLayout(savedCameras));
        }
        if (savedCameras.length > 0 && manualObjects.length === 0) {
            setManualObjects([createEmptyManualObject(String(savedCameras[0].id))]);
        }
    }, [savedCameras.length]);

    const getAssistedPayload = () => {
        const objectHints = manualObjects
            .map((object) => {
                const label = String(object.label || '').trim();
                if (!label) return null;
                const x = Number(object.x);
                const y = Number(object.y);
                const confidence = Number(object.confidence);
                return {
                    label,
                    category: String(object.category || 'estructura'),
                    cameraId: object.cameraId ? String(object.cameraId) : null,
                    x: Number.isFinite(x) ? x : undefined,
                    y: Number.isFinite(y) ? y : undefined,
                    confidence: Number.isFinite(confidence) ? confidence : undefined
                };
            })
            .filter(Boolean);

        const manualCameraLayout = manualCameras
            .map((camera) => ({
                id: String(camera.id),
                label: String(camera.label || '').trim() || String(camera.id),
                x: Number(camera.x),
                y: Number(camera.y),
                yawDeg: Number(camera.yawDeg)
            }))
            .filter((camera) => Number.isFinite(camera.x) && Number.isFinite(camera.y));

        return { objectHints, manualCameraLayout };
    };

    const startGenerate = async (assisted = false) => {
        setError('');
        const assistedPayload = assisted ? getAssistedPayload() : { objectHints: [], manualCameraLayout: [] };
        await startMapGeneration({
            promote: true,
            reason: assisted ? 'assisted-manual' : 'manual-refresh',
            objectHints: assistedPayload.objectHints,
            manualCameraLayout: assistedPayload.manualCameraLayout,
            planHint: assisted ? 'C' : null
        });
    };

    const retryLastJob = async () => {
        if (!job?.id) {
            await startGenerate(manualMode);
            return;
        }

        setError('');
        const assistedPayload = manualMode ? getAssistedPayload() : { objectHints: [], manualCameraLayout: [] };
        await retryMapGeneration(job.id, {
            promote: true,
            reason: `manual-retry:${job.id}`,
            objectHints: assistedPayload.objectHints,
            manualCameraLayout: assistedPayload.manualCameraLayout,
            planHint: manualMode ? 'C' : null
        });
    };

    const cancelJob = async () => {
        if (!job?.id) return;
        await cancelMapGeneration(job.id);
    };

    const promoteMap = async (mapId) => {
        if (!mapId) return;
        await promoteMapVersion(mapId);
    };

    const saveManualMap = async () => {
        setError('');
        try {
            const cameras = manualCameras
                .map((camera) => ({
                    id: String(camera.id),
                    label: String(camera.label || '').trim() || String(camera.id),
                    x: Number(camera.x),
                    y: Number(camera.y),
                    yawDeg: Number(camera.yawDeg)
                }))
                .filter((camera) => Number.isFinite(camera.x) && Number.isFinite(camera.y));

            if (cameras.length === 0) {
                throw new Error('Debes definir al menos una camara manual con x/y validos');
            }

            const objects = manualObjects
                .map((object) => {
                    const label = String(object.label || '').trim();
                    if (!label) return null;
                    const x = Number(object.x);
                    const y = Number(object.y);
                    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
                    const confidence = Number(object.confidence);
                    return {
                        label,
                        category: String(object.category || 'estructura'),
                        x,
                        y,
                        confidence: Number.isFinite(confidence) ? confidence : 0.8,
                        cameraId: object.cameraId ? String(object.cameraId) : null
                    };
                })
                .filter(Boolean);

            const savedMap = await saveManualMapVersion({
                promote: true,
                cameras,
                objects,
                qualityScore: 0.45
            });
            if (savedMap) setManualMode(false);
        } catch (manualError) {
            setError(manualError.message || 'No se pudo guardar mapa manual');
        }
    };

    const resetManualLayout = () => {
        const defaults = buildDefaultManualLayout(savedCameras);
        setManualCameras(defaults);
        const firstCameraId = defaults[0]?.id || savedCameras[0]?.id || '';
        setManualObjects([createEmptyManualObject(String(firstCameraId || ''))]);
    };

    const updateManualCamera = (cameraId, field, value) => {
        setManualCameras((prev) => prev.map((camera) => {
            if (camera.id !== cameraId) return camera;
            if (field === 'label') {
                return { ...camera, label: value };
            }
            return { ...camera, [field]: toFiniteOrFallback(value, 0) };
        }));
    };

    const updateManualObject = (rowId, field, value) => {
        setManualObjects((prev) => prev.map((object) => {
            if (object.rowId !== rowId) return object;
            if (field === 'label' || field === 'category' || field === 'cameraId') {
                return { ...object, [field]: value };
            }
            return { ...object, [field]: toFiniteOrFallback(value, 0) };
        }));
    };

    const addManualObjectRow = () => {
        const fallbackCameraId = manualCameras[0]?.id || savedCameras[0]?.id || '';
        setManualObjects((prev) => [...prev, createEmptyManualObject(String(fallbackCameraId))]);
    };

    const removeManualObjectRow = (rowId) => {
        setManualObjects((prev) => {
            const next = prev.filter((object) => object.rowId !== rowId);
            return next.length > 0 ? next : [createEmptyManualObject(manualCameras[0]?.id || '')];
        });
    };

    const isGenerating = !!job && ['queued', 'running'].includes(job.status);
    const canRetry = !!job && ['failed', 'cancelled'].includes(job.status);
    const outdated = !!latestMap && savedCameraCount > 0 && Array.isArray(latestMap.cameras) && latestMap.cameras.length !== savedCameraCount;

    const projected = useMemo(() => {
        if (!latestMap) return null;
        const cameras = Array.isArray(latestMap.cameras) ? latestMap.cameras : [];
        const objects = Array.isArray(latestMap.objects) ? latestMap.objects : [];
        const points = [...cameras, ...objects];
        if (points.length === 0) return null;

        const minX = Math.min(...points.map((point) => Number(point.x)));
        const maxX = Math.max(...points.map((point) => Number(point.x)));
        const minY = Math.min(...points.map((point) => Number(point.y)));
        const maxY = Math.max(...points.map((point) => Number(point.y)));
        const spanX = Math.max(1, maxX - minX);
        const spanY = Math.max(1, maxY - minY);
        const width = 980;
        const height = 540;
        const pad = 48;

        const project = (x, y) => {
            const px = ((Number(x) - minX) / spanX) * (width - pad * 2) + pad;
            const py = ((Number(y) - minY) / spanY) * (height - pad * 2) + pad;
            return { x: Number(px.toFixed(2)), y: Number((height - py).toFixed(2)) };
        };

        return { width, height, project, cameras, objects };
    }, [latestMap]);

    const selectedCamera = useMemo(() => {
        if (!latestMap || !selectedCameraId) return null;
        return (Array.isArray(latestMap.cameras) ? latestMap.cameras : []).find((camera) => String(camera.id) === String(selectedCameraId)) || null;
    }, [latestMap, selectedCameraId]);

    const selectedObject = useMemo(() => {
        if (!latestMap || !selectedObjectId) return null;
        return (Array.isArray(latestMap.objects) ? latestMap.objects : []).find((object) => String(object.id) === String(selectedObjectId)) || null;
    }, [latestMap, selectedObjectId]);

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', gap: '0.6rem' }}>
                <RefreshCw className="spin" size={18} />
                Cargando estado de mapas...
            </div>
        );
    }

    return (
        <div style={{ padding: '1rem 1.2rem', height: '100%', overflow: 'auto' }}>
            <MapToolbar
                isGenerating={isGenerating}
                busy={busy}
                canRetry={canRetry}
                manualMode={manualMode}
                onToggleManual={() => setManualMode((prev) => !prev)}
                onRefresh={() => refreshMapData(true)}
                onGenerate={() => startGenerate(false)}
                onRetry={retryLastJob}
                onCancel={cancelJob}
            />

            {error && (
                <div style={{ marginBottom: '0.8rem', border: '1px solid rgba(255,107,107,0.55)', borderRadius: '10px', padding: '0.55rem 0.7rem', color: '#ffb3b3', display: 'flex', gap: '0.45rem', alignItems: 'center' }}>
                    <AlertTriangle size={14} />
                    {error}
                </div>
            )}

            {manualMode && (
                <div className="glass-panel" style={{ marginBottom: '0.9rem', padding: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.7rem', alignItems: 'center', marginBottom: '0.65rem', flexWrap: 'wrap' }}>
                        <div style={{ fontSize: '0.9rem', color: '#dff' }}>
                            Asistencia manual Plan C/D
                        </div>
                        <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                            <button className="btn" onClick={() => startGenerate(true)} disabled={busy || isGenerating}>
                                <Play size={14} /> Generar Asistido (Plan C)
                            </button>
                            <button className="btn" onClick={saveManualMap} disabled={busy || isGenerating}>
                                <Save size={14} /> Guardar Mapa Manual (Plan D)
                            </button>
                            <button className="btn" onClick={resetManualLayout} disabled={busy || isGenerating}>
                                Resetear
                            </button>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                        <div>
                            <div style={{ fontSize: '0.78rem', marginBottom: '0.4rem', color: '#fff' }}>Camaras manuales</div>
                            <div style={{ display: 'grid', gap: '0.35rem' }}>
                                {manualCameras.map((camera) => (
                                    <div key={camera.id} style={{ border: '1px solid rgba(255,255,255,0.14)', borderRadius: '8px', padding: '0.4rem' }}>
                                        <div style={{ fontSize: '0.63rem', opacity: 0.7, marginBottom: '0.25rem' }}>id: {camera.id}</div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.7fr 0.7fr 0.7fr', gap: '0.28rem' }}>
                                            <input
                                                className="stream-input"
                                                style={{ fontSize: '0.72rem' }}
                                                value={camera.label}
                                                onChange={(event) => updateManualCamera(camera.id, 'label', event.target.value)}
                                                placeholder="Label"
                                            />
                                            <input
                                                className="stream-input"
                                                style={{ fontSize: '0.72rem' }}
                                                type="number"
                                                value={camera.x}
                                                onChange={(event) => updateManualCamera(camera.id, 'x', event.target.value)}
                                                placeholder="x"
                                            />
                                            <input
                                                className="stream-input"
                                                style={{ fontSize: '0.72rem' }}
                                                type="number"
                                                value={camera.y}
                                                onChange={(event) => updateManualCamera(camera.id, 'y', event.target.value)}
                                                placeholder="y"
                                            />
                                            <input
                                                className="stream-input"
                                                style={{ fontSize: '0.72rem' }}
                                                type="number"
                                                value={camera.yawDeg}
                                                onChange={(event) => updateManualCamera(camera.id, 'yawDeg', event.target.value)}
                                                placeholder="yaw"
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                                <div style={{ fontSize: '0.78rem', color: '#fff' }}>Objetos manuales</div>
                                <button className="btn" style={{ padding: '0.18rem 0.42rem', fontSize: '0.68rem' }} onClick={addManualObjectRow} disabled={busy}>
                                    <Plus size={12} /> Agregar
                                </button>
                            </div>
                            <div style={{ display: 'grid', gap: '0.35rem', maxHeight: '320px', overflow: 'auto' }}>
                                {manualObjects.map((object) => (
                                    <div key={object.rowId} style={{ border: '1px solid rgba(255,255,255,0.14)', borderRadius: '8px', padding: '0.38rem' }}>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 0.65fr 0.65fr 0.7fr auto', gap: '0.25rem' }}>
                                            <input
                                                className="stream-input"
                                                style={{ fontSize: '0.72rem' }}
                                                value={object.label}
                                                onChange={(event) => updateManualObject(object.rowId, 'label', event.target.value)}
                                                placeholder="label"
                                            />
                                            <select
                                                className="stream-input"
                                                style={{ fontSize: '0.72rem', paddingTop: '0.44rem', paddingBottom: '0.44rem' }}
                                                value={object.category}
                                                onChange={(event) => updateManualObject(object.rowId, 'category', event.target.value)}
                                            >
                                                {CATEGORY_OPTIONS.map((option) => (
                                                    <option key={option} value={option}>{option}</option>
                                                ))}
                                            </select>
                                            <input
                                                className="stream-input"
                                                style={{ fontSize: '0.72rem' }}
                                                type="number"
                                                value={object.x}
                                                onChange={(event) => updateManualObject(object.rowId, 'x', event.target.value)}
                                                placeholder="x"
                                            />
                                            <input
                                                className="stream-input"
                                                style={{ fontSize: '0.72rem' }}
                                                type="number"
                                                value={object.y}
                                                onChange={(event) => updateManualObject(object.rowId, 'y', event.target.value)}
                                                placeholder="y"
                                            />
                                            <select
                                                className="stream-input"
                                                style={{ fontSize: '0.72rem', paddingTop: '0.44rem', paddingBottom: '0.44rem' }}
                                                value={object.cameraId}
                                                onChange={(event) => updateManualObject(object.rowId, 'cameraId', event.target.value)}
                                            >
                                                <option value="">sin camara</option>
                                                {manualCameras.map((camera) => (
                                                    <option key={camera.id} value={camera.id}>{camera.label}</option>
                                                ))}
                                            </select>
                                            <button className="btn" style={{ padding: '0.2rem 0.35rem', borderColor: 'rgba(255,107,107,0.5)', color: '#ff8f8f' }} onClick={() => removeManualObjectRow(object.rowId)}>
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {isGenerating && (
                <div style={{ marginBottom: '0.8rem', border: '1px solid rgba(102,252,241,0.35)', borderRadius: '10px', padding: '0.55rem 0.7rem', background: 'rgba(102,252,241,0.08)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.8rem', alignItems: 'center' }}>
                        <div style={{ color: '#d7fbff', fontSize: '0.86rem' }}>
                            Generando mapa: {job?.progress?.message || 'Procesando...'}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#66fcf1' }}>
                            {Math.round(Number(job?.progress?.percent || 0))}%
                        </div>
                    </div>
                    <div style={{ marginTop: '0.45rem', height: '7px', borderRadius: '999px', background: 'rgba(255,255,255,0.09)', overflow: 'hidden' }}>
                        <div style={{
                            width: `${Math.max(4, Math.min(100, Number(job?.progress?.percent || 0)))}%`,
                            height: '100%',
                            background: 'linear-gradient(90deg, #66fcf1, #45d5cb)'
                        }} />
                    </div>
                </div>
            )}

            {!latestMap && !isGenerating && (
                <div className="glass-panel" style={{ textAlign: 'center', padding: '2rem', opacity: 0.9 }}>
                    <Clock3 size={42} style={{ marginBottom: '0.8rem' }} />
                    <h3 style={{ marginTop: 0 }}>Sin mapa generado</h3>
                    <p style={{ opacity: 0.75, marginBottom: '1rem' }}>
                        Todavia no hay un croquis guardado. Inicia una generacion para crear la primera version.
                    </p>
                    <button className="btn" onClick={() => startGenerate(false)} disabled={busy}>
                        <Play size={15} /> Generar mapa inicial
                    </button>
                </div>
            )}

            {latestMap && (
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) 300px', gap: '0.9rem', alignItems: 'start' }}>
                    <div className="glass-panel" style={{ padding: '0.7rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                            <div style={{ color: '#fff', fontSize: '0.86rem' }}>
                                <CheckCircle2 size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem', color: '#63e6be' }} />
                                Mapa activo: <b>{latestMap.mapId}</b>
                            </div>
                            <div style={{ fontSize: '0.75rem', color: outdated ? '#ffd166' : '#9ef5e3' }}>
                                {outdated ? 'Desactualizado' : 'Vigente'}
                            </div>
                        </div>

                        <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', overflow: 'hidden', background: 'radial-gradient(circle at 20% 20%, rgba(102,252,241,0.08), rgba(255,255,255,0.02) 70%)' }}>
                            {projected ? (
                                <svg width="100%" viewBox={`0 0 ${projected.width} ${projected.height}`} preserveAspectRatio="xMidYMid meet">
                                    {Array.from({ length: 10 }).map((_, index) => (
                                        <line
                                            key={`gx-${index}`}
                                            x1={(projected.width / 10) * index}
                                            y1="0"
                                            x2={(projected.width / 10) * index}
                                            y2={projected.height}
                                            stroke="rgba(255,255,255,0.05)"
                                        />
                                    ))}
                                    {Array.from({ length: 8 }).map((_, index) => (
                                        <line
                                            key={`gy-${index}`}
                                            x1="0"
                                            y1={(projected.height / 8) * index}
                                            x2={projected.width}
                                            y2={(projected.height / 8) * index}
                                            stroke="rgba(255,255,255,0.05)"
                                        />
                                    ))}

                                    {projected.objects.map((object, index) => {
                                        const point = projected.project(object.x, object.y);
                                        const color = CATEGORY_COLORS[object.category] || '#ced4da';
                                        const selected = String(selectedObjectId) === String(object.id);
                                        return (
                                            <g
                                                key={`${object.id || object.label}-${index}`}
                                                style={{ cursor: 'pointer' }}
                                                onClick={() => {
                                                    setSelectedObjectId(String(object.id));
                                                    setSelectedCameraId(null);
                                                }}
                                            >
                                                <rect
                                                    x={point.x - 6}
                                                    y={point.y - 6}
                                                    width="12"
                                                    height="12"
                                                    fill={color}
                                                    stroke={selected ? '#ffffff' : 'none'}
                                                    strokeWidth={selected ? 2 : 0}
                                                />
                                                <text x={point.x + 8} y={point.y - 8} fill="#f8f9fa" fontSize="11">
                                                    {object.label}
                                                </text>
                                            </g>
                                        );
                                    })}

                                    {projected.cameras.map((camera, index) => {
                                        const point = projected.project(camera.x, camera.y);
                                        const yawDeg = Number(camera.yawDeg || 0);
                                        const yawRad = (yawDeg * Math.PI) / 180;
                                        const fx = point.x + Math.cos(yawRad) * 20;
                                        const fy = point.y - Math.sin(yawRad) * 20;
                                        const spread = (32 * Math.PI) / 180;
                                        const range = 56;
                                        const leftX = point.x + Math.cos(yawRad + spread) * range;
                                        const leftY = point.y - Math.sin(yawRad + spread) * range;
                                        const rightX = point.x + Math.cos(yawRad - spread) * range;
                                        const rightY = point.y - Math.sin(yawRad - spread) * range;
                                        const selected = String(selectedCameraId) === String(camera.id);
                                        return (
                                            <g
                                                key={`${camera.id}-${index}`}
                                                style={{ cursor: 'pointer' }}
                                                onClick={() => {
                                                    setSelectedCameraId(String(camera.id));
                                                    setSelectedObjectId(null);
                                                }}
                                            >
                                                <polygon
                                                    points={`${point.x},${point.y} ${leftX.toFixed(2)},${leftY.toFixed(2)} ${rightX.toFixed(2)},${rightY.toFixed(2)}`}
                                                    fill={selected ? 'rgba(102,252,241,0.22)' : 'rgba(102,252,241,0.12)'}
                                                    stroke={selected ? 'rgba(102,252,241,0.55)' : 'rgba(102,252,241,0.3)'}
                                                    strokeWidth={1}
                                                />
                                                <circle
                                                    cx={point.x}
                                                    cy={point.y}
                                                    r="7.5"
                                                    fill="#66fcf1"
                                                    stroke={selected ? '#fff' : 'none'}
                                                    strokeWidth={selected ? 2 : 0}
                                                />
                                                <line x1={point.x} y1={point.y} x2={fx} y2={fy} stroke="#66fcf1" strokeWidth="2" />
                                                <text x={point.x + 10} y={point.y + 16} fill="#d7fbff" fontSize="11">
                                                    {camera.label}
                                                </text>
                                            </g>
                                        );
                                    })}
                                </svg>
                            ) : (
                                <div style={{ padding: '1.5rem', textAlign: 'center', opacity: 0.7 }}>
                                    No hay elementos para representar.
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="glass-panel" style={{ padding: '0.65rem 0.7rem' }}>
                        <div style={{ fontSize: '0.82rem', color: '#fff', marginBottom: '0.45rem' }}>Resumen</div>
                        <div style={{ fontSize: '0.72rem', opacity: 0.85, display: 'grid', gap: '0.32rem', marginBottom: '0.7rem' }}>
                            <div>Creado: <b>{formatDate(latestMap.createdAt)}</b></div>
                            <div>Plan: <b>{latestMap?.quality?.planUsed || 'A'}</b></div>
                            <div>Score: <b>{latestMap?.quality?.score ?? '—'}</b></div>
                            <div><Camera size={12} style={{ verticalAlign: 'middle', marginRight: '0.25rem' }} />Camaras: <b>{latestMap?.cameras?.length || 0}</b></div>
                            <div>Objetos: <b>{latestMap?.objects?.length || 0}</b></div>
                        </div>

                        {(selectedCamera || selectedObject) && (
                            <div style={{ borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: '0.5rem', marginBottom: '0.65rem' }}>
                                <div style={{ fontSize: '0.75rem', color: '#d5f9f1', marginBottom: '0.3rem' }}>
                                    Seleccion actual
                                </div>
                                {selectedCamera && (
                                    <div style={{ fontSize: '0.7rem', display: 'grid', gap: '0.24rem', marginBottom: '0.35rem' }}>
                                        <div><b>Camara:</b> {selectedCamera.label}</div>
                                        <div><b>ID:</b> {selectedCamera.id}</div>
                                        <div><b>Posicion:</b> ({Number(selectedCamera.x).toFixed(2)}, {Number(selectedCamera.y).toFixed(2)})</div>
                                        <div><b>Yaw:</b> {Number(selectedCamera.yawDeg || 0).toFixed(1)}°</div>
                                    </div>
                                )}
                                {selectedObject && (
                                    <div style={{ fontSize: '0.7rem', display: 'grid', gap: '0.24rem' }}>
                                        <div><b>Objeto:</b> {selectedObject.label}</div>
                                        <div><b>Categoria:</b> {selectedObject.category}</div>
                                        <div><b>Posicion:</b> ({Number(selectedObject.x).toFixed(2)}, {Number(selectedObject.y).toFixed(2)})</div>
                                        <div><b>Confianza:</b> {selectedObject.confidence ?? '—'}</div>
                                    </div>
                                )}
                            </div>
                        )}

                        <div style={{ borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: '0.55rem', marginBottom: '0.45rem' }}>
                            <div style={{ fontSize: '0.75rem', marginBottom: '0.35rem', color: '#d5f9f1' }}>Versiones recientes</div>
                            <div style={{ display: 'grid', gap: '0.38rem', maxHeight: '320px', overflow: 'auto' }}>
                                {history.map((item) => (
                                    <div key={item.mapId} style={{ border: `1px solid ${item.mapId === activeMapId ? 'rgba(99,230,190,0.6)' : 'rgba(255,255,255,0.12)'}`, borderRadius: '8px', padding: '0.35rem 0.45rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.35rem' }}>
                                            <span style={{ fontSize: '0.67rem', color: '#fff' }}>{item.mapId}</span>
                                            <span style={{ fontSize: '0.62rem', color: getStatusColor(item.mapId === activeMapId ? 'done' : 'queued') }}>
                                                {item.mapId === activeMapId ? 'ACTIVO' : 'GUARDADO'}
                                            </span>
                                        </div>
                                        <div style={{ fontSize: '0.62rem', opacity: 0.72 }}>
                                            {formatDate(item.createdAt)} · objs: {item?.stats?.objects ?? 0}
                                        </div>
                                        {item.mapId !== activeMapId && (
                                            <button
                                                className="btn"
                                                style={{ marginTop: '0.35rem', width: '100%', padding: '0.2rem 0.35rem', fontSize: '0.68rem' }}
                                                onClick={() => promoteMap(item.mapId)}
                                                disabled={busy}
                                            >
                                                Promover
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
                .stream-input {
                    background: rgba(255,255,255,0.1);
                    border: 1px solid rgba(255,255,255,0.2);
                    padding: 0.4rem 0.45rem;
                    border-radius: 6px;
                    color: #fff;
                    outline: none;
                }
                .stream-input:focus {
                    border-color: var(--accent-color);
                }
                .stream-input option {
                    background: #141a22;
                    color: #fff;
                }
            `}</style>
        </div>
    );
};

export default MapView;

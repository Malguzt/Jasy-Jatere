import React from 'react';
import { Map, Play, RefreshCw, XCircle, SlidersHorizontal } from 'lucide-react';

const MapToolbar = ({
    isGenerating,
    busy,
    canRetry,
    manualMode,
    onToggleManual,
    onRefresh,
    onGenerate,
    onRetry,
    onCancel
}) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.8rem', marginBottom: '0.9rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff' }}>
            <Map size={18} color="var(--accent-color)" />
            <h2 style={{ margin: 0, fontSize: '1.08rem' }}>Mapa de Terreno (Croquis)</h2>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button className="btn" onClick={onToggleManual} disabled={busy}>
                <SlidersHorizontal size={14} /> {manualMode ? 'Cerrar Modo Manual' : 'Modo Manual'}
            </button>
            <button className="btn" onClick={onRefresh} disabled={busy}>
                <RefreshCw size={14} /> Recargar
            </button>
            {!isGenerating ? (
                <>
                    <button className="btn" onClick={onGenerate} disabled={busy}>
                        <Play size={14} /> Generar / Actualizar
                    </button>
                    {canRetry && (
                        <button className="btn" onClick={onRetry} disabled={busy}>
                            <RefreshCw size={14} /> Reintentar
                        </button>
                    )}
                </>
            ) : (
                <button className="btn" style={{ borderColor: '#ff6b6b', color: '#ff6b6b' }} onClick={onCancel} disabled={busy}>
                    <XCircle size={14} /> Cancelar
                </button>
            )}
        </div>
    </div>
);

export default MapToolbar;

import React, { useEffect, useState } from 'react';
import { Play, Trash2, Calendar, Film, Search } from 'lucide-react';

const Recordings = () => {
    const [recordings, setRecordings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedVideo, setSelectedVideo] = useState(null);
    const [confirmDelete, setConfirmDelete] = useState(null); // Track which file is in 'confirm delete' state
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        fetchRecordings();
    }, []);

    const fetchRecordings = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/detector/recordings');
            const data = await res.json();
            if (data.success) {
                setRecordings(data.recordings);
            }
        } catch (error) {
            console.error('Error fetching recordings', error);
        }
        setLoading(false);
    };

    const deleteRecording = async (filename) => {
        try {
            const res = await fetch(`/api/detector/recordings/${filename}`, {
                method: 'DELETE'
            });
            const data = await res.json();
            if (data.success) {
                // Refresh list
                fetchRecordings();
                setConfirmDelete(null);
            } else {
                alert('Error al borrar: ' + data.error);
            }
        } catch (error) {
            alert('Error de red al intentar borrar.');
        }
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--accent-color)' }}>
                <div className="spin" style={{ marginBottom: '1rem' }}><Film /></div>
                <span style={{ marginLeft: '1rem' }}>Cargando grabaciones...</span>
            </div>
        );
    }

    const normalizedSearch = searchTerm.trim().toLowerCase();
    const visibleRecordings = !normalizedSearch
        ? recordings
        : recordings.filter((rec) => {
            const haystack = [
                rec.filename || '',
                rec.camera_name || '',
                rec.camera_id || '',
                ...(rec.categories || []),
                ...(rec.objects || []),
                ...(rec.tags || []),
                rec.event_type || ''
            ].join(' ').toLowerCase();
            return haystack.includes(normalizedSearch);
        });

    return (
        <div style={{ padding: '1.5rem', animation: 'fadeIn 0.5s ease-in', height: '100%', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <h2 style={{ color: '#fff', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Film className="text-accent" /> Grabaciones por Detección
                </h2>
                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                    <div style={{ position: 'relative' }}>
                        <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', opacity: 0.7 }} />
                        <input
                            type="text"
                            placeholder="Buscar por cámara, objeto, categoría..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            style={{
                                padding: '0.45rem 0.6rem 0.45rem 2rem',
                                borderRadius: '8px',
                                border: '1px solid rgba(255,255,255,0.2)',
                                background: 'rgba(255,255,255,0.06)',
                                color: '#fff',
                                minWidth: '280px'
                            }}
                        />
                    </div>
                    <button className="btn" onClick={fetchRecordings} style={{ padding: '0.5rem 1rem', fontSize: '0.8rem' }}>
                        Actualizar
                    </button>
                </div>
            </div>

            {visibleRecordings.length === 0 ? (
                <div style={{ textAlign: 'center', marginTop: '4rem', opacity: 0.5 }}>
                    <Film size={48} style={{ marginBottom: '1rem' }} />
                    <h3>{recordings.length === 0 ? 'No hay grabaciones aún.' : 'No hay resultados para tu búsqueda.'}</h3>
                    <p>Las cámaras grabarán automáticamente cuando detecten personas, animales o vehículos.</p>
                </div>
            ) : (
                <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', 
                    gap: '1.5rem',
                    padding: '0.5rem'
                }}>
                    {visibleRecordings.map((rec) => (
                        <div 
                            key={rec.filename} 
                            className="glass-panel"
                            style={{ 
                                padding: '0', 
                                overflow: 'hidden', 
                                cursor: 'pointer',
                                display: 'flex',
                                flexDirection: 'column',
                                transition: 'all 0.3s ease'
                            }}
                            onClick={() => setSelectedVideo(rec.filename)}
                        >
                            {/* Thumbnail */}
                            <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#000' }}>
                                {rec.thumbnail ? (
                                    <img 
                                        src={`/recordings/${rec.thumbnail}`} 
                                        alt="thumbnail" 
                                        style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                                    />
                                ) : (
                                    <div style={{ 
                                        width: '100%', height: '100%', display: 'flex', 
                                        alignItems: 'center', justifyContent: 'center', opacity: 0.3 
                                    }}>
                                        <Film size={48} />
                                    </div>
                                )}
                                <div style={{ 
                                    position: 'absolute', bottom: '8px', right: '8px', 
                                    background: 'rgba(0,0,0,0.7)', padding: '2px 6px', 
                                    borderRadius: '4px', fontSize: '0.7rem', color: '#fff',
                                    backdropFilter: 'blur(4px)'
                                }}>
                                    {rec.size_mb} MB
                                </div>
                                <div style={{
                                    position: 'absolute', top: '50%', left: '50%',
                                    transform: 'translate(-50%, -50%)',
                                    background: 'rgba(102, 252, 241, 0.2)',
                                    borderRadius: '50%', padding: '10px',
                                    opacity: 0, transition: 'opacity 0.3s'
                                }} className="play-overlay">
                                    <Play size={32} color="var(--accent-color)" fill="var(--accent-color)" />
                                </div>
                            </div>

                            {/* Info */}
                            <div style={{ padding: '1rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <div style={{ 
                                    fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-light)',
                                    marginBottom: '0.25rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                                }}>
                                    {rec.filename.split('_').slice(0, -2).join(' ')}
                                </div>
                                {rec.camera_name && (
                                    <div style={{ fontSize: '0.72rem', opacity: 0.85 }}>
                                        Cámara: {rec.camera_name}
                                    </div>
                                )}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-main)', fontSize: '0.7rem', opacity: 0.8 }}>
                                    <Calendar size={14} className="text-accent" />
                                    {new Date(rec.created).toLocaleString()}
                                </div>
                                {((rec.categories && rec.categories.length > 0) || (rec.objects && rec.objects.length > 0)) && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.35rem' }}>
                                        {(rec.categories || []).slice(0, 3).map((cat) => (
                                            <span key={`cat-${rec.filename}-${cat}`} style={{
                                                fontSize: '0.65rem',
                                                padding: '2px 6px',
                                                borderRadius: '999px',
                                                background: 'rgba(102,252,241,0.18)',
                                                border: '1px solid rgba(102,252,241,0.35)'
                                            }}>
                                                {cat}
                                            </span>
                                        ))}
                                        {(rec.objects || []).slice(0, 3).map((obj) => (
                                            <span key={`obj-${rec.filename}-${obj}`} style={{
                                                fontSize: '0.65rem',
                                                padding: '2px 6px',
                                                borderRadius: '999px',
                                                background: 'rgba(255,255,255,0.12)',
                                                border: '1px solid rgba(255,255,255,0.2)'
                                            }}>
                                                {obj}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                
                                <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto', paddingTop: '0.5rem' }}>
                                    {confirmDelete === rec.filename ? (
                                        <>
                                            <button 
                                                className="btn" 
                                                style={{ flex: 1, background: '#ff6b6b', color: '#fff', border: 'none', fontSize: '0.7rem' }}
                                                onClick={(e) => { e.stopPropagation(); deleteRecording(rec.filename); }}
                                            >
                                                Confirmar Borrado
                                            </button>
                                            <button 
                                                className="btn" 
                                                style={{ padding: '0.4rem', fontSize: '0.7rem' }}
                                                onClick={(e) => { e.stopPropagation(); setConfirmDelete(null); }}
                                            >
                                                X
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <button className="btn" style={{ flex: 1, padding: '0.4rem', fontSize: '0.7rem' }}>
                                                <Play size={14} /> Reproducir
                                            </button>
                                            <button 
                                                className="btn" 
                                                style={{ padding: '0.4rem', borderColor: '#ff6b6b', color: '#ff6b6b' }}
                                                onClick={(e) => { e.stopPropagation(); setConfirmDelete(rec.filename); }}
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Video Modal Player */}
            {selectedVideo && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
                    background: 'rgba(0,0,0,0.9)', zIndex: 1000, display: 'flex',
                    flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
                    padding: '2rem'
                }} onClick={() => setSelectedVideo(null)}>
                    <div style={{ width: '100%', maxWidth: '1000px', position: 'relative' }} onClick={e => e.stopPropagation()}>
                        <video 
                            src={`/recordings/${selectedVideo}`} 
                            controls 
                            autoPlay 
                            style={{ width: '100%', borderRadius: '8px', boxShadow: '0 0 40px rgba(0,0,0,0.5)' }}
                        />
                        <div style={{ color: '#fff', marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>{selectedVideo}</span>
                            <button className="btn" onClick={() => setSelectedVideo(null)}>Cerrar</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Recordings;

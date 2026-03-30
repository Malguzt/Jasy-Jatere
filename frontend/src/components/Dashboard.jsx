import React, { useEffect, useState } from 'react';
import CameraStream from './CameraStream';
import { Trash2, ShieldAlert, Star } from 'lucide-react';

const Dashboard = () => {
    const [savedCameras, setSavedCameras] = useState([]);
    const [featuredIds, setFeaturedIds] = useState([]);

    useEffect(() => { fetchCameras(); }, []);

    const markActivity = (camId) => {
        setFeaturedIds(prev => {
            const next = [camId, ...prev.filter(id => id !== camId)];
            return next.slice(0, 2);
        });
    };

    const fetchCameras = async () => {
        try {
            const res = await fetch('http://localhost:4000/api/saved-cameras');
            const data = await res.json();
            if (data.success) {
                setSavedCameras(data.cameras);
                if (data.cameras.length >= 2 && featuredIds.length === 0) {
                    setFeaturedIds([data.cameras[0].id, data.cameras[1].id]);
                } else if (data.cameras.length === 1 && featuredIds.length === 0) {
                    setFeaturedIds([data.cameras[0].id]);
                }
            }
        } catch (error) {
            console.error('Error fetching cameras', error);
        }
    };

    const deleteCamera = async (id) => {
        try {
            await fetch(`http://localhost:4000/api/saved-cameras/${id}`, { method: 'DELETE' });
            setFeaturedIds(prev => prev.filter(fid => fid !== id));
            fetchCameras();
        } catch (error) {
            console.error('Error deleting', error);
        }
    };

    const toggleFeatured = (camId) => {
        if (featuredIds.includes(camId)) {
            setFeaturedIds(prev => prev.filter(id => id !== camId));
        } else {
            setFeaturedIds(prev => {
                const next = [...prev, camId];
                if (next.length > 2) next.shift();
                return next;
            });
        }
    };

    if (savedCameras.length === 0) {
        return (
            <div style={{ textAlign: 'center', marginTop: '4rem', opacity: 0.5 }}>
                <ShieldAlert size={48} style={{ marginBottom: '1rem' }} />
                <h2>No hay cámaras guardadas.</h2>
                <p>Ve a "Explorar Radar" y añade tus cámaras al dashboard.</p>
            </div>
        );
    }

    const featured = savedCameras.filter(c => featuredIds.includes(c.id));
    const secondary = savedCameras.filter(c => !featuredIds.includes(c.id));

    const TileBar = ({ cam, isFeatured }) => (
        <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '2px 6px',
            background: isFeatured ? 'rgba(102, 252, 241, 0.15)' : 'rgba(255,255,255,0.05)',
            borderBottom: '1px solid rgba(102, 252, 241, 0.2)',
            fontSize: '0.72rem',
            color: isFeatured ? 'var(--accent-color)' : 'var(--text-main)',
            fontWeight: 500,
            lineHeight: 1.4
        }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {cam.name}
            </span>
            <div style={{ display: 'flex', gap: '2px', flexShrink: 0, marginLeft: '4px' }}>
                <button
                    onClick={(e) => { e.stopPropagation(); toggleFeatured(cam.id); }}
                    style={{
                        background: 'none', border: 'none', cursor: 'pointer', padding: '1px 3px',
                        color: isFeatured ? 'var(--accent-color)' : 'rgba(255,255,255,0.3)',
                        display: 'flex', alignItems: 'center'
                    }}
                    title={isFeatured ? 'Quitar de destacados' : 'Destacar'}
                >
                    <Star size={11} fill={isFeatured ? 'var(--accent-color)' : 'none'} />
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); deleteCamera(cam.id); }}
                    style={{
                        background: 'none', border: 'none', cursor: 'pointer', padding: '1px 3px',
                        color: '#ff6b6b', display: 'flex', alignItems: 'center'
                    }}
                >
                    <Trash2 size={11} />
                </button>
            </div>
        </div>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '1px', background: 'rgba(102, 252, 241, 0.15)' }}>

            {/* Featured — top tiles */}
            {featured.length > 0 && (
                <div style={{ flex: secondary.length > 0 ? '1 1 60%' : '1 1 100%', display: 'flex', gap: '1px', minHeight: 0 }}>
                    {featured.map(cam => (
                        <div key={cam.id} style={{ flex: '1 1 0', display: 'flex', flexDirection: 'column', background: '#0b0c10', minWidth: 0 }} onClick={() => markActivity(cam.id)}>
                            <TileBar cam={cam} isFeatured={true} />
                            <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
                                <CameraStream camera={cam} />
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Secondary — bottom tiles */}
            {secondary.length > 0 && (
                <div style={{
                    flex: featured.length > 0 ? '1 1 40%' : '1 1 100%',
                    display: 'flex', gap: '1px', minHeight: 0, overflow: 'hidden'
                }}>
                    {secondary.map(cam => (
                        <div key={cam.id} style={{ flex: '1 1 0', display: 'flex', flexDirection: 'column', background: '#0b0c10', minWidth: 0 }} onClick={() => markActivity(cam.id)}>
                            <TileBar cam={cam} isFeatured={false} />
                            <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
                                <CameraStream camera={cam} />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default Dashboard;

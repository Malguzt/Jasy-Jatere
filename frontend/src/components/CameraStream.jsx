import React, { useEffect, useRef, useState } from 'react';
import { Loader, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Plus, Minus, Camera as CameraIcon, RefreshCw, Lock, Save, X } from 'lucide-react';

const CameraStream = ({ camera }) => {
    const canvasRef = useRef(null);
    const [status, setStatus] = useState('Inicializando stream...');
    const [wsPort, setWsPort] = useState(null);
    const [showControls, setShowControls] = useState(false);
    const [isPtzAction, setIsPtzAction] = useState(false);
    const [isEditingAuth, setIsEditingAuth] = useState(false);
    const [tempUser, setTempUser] = useState(camera.user || '');
    const [tempPass, setTempPass] = useState(camera.pass || '');
    const [localCamera, setLocalCamera] = useState(camera);

    let playerRef = useRef(null);

    const startStream = async () => {
        setStatus('Conectando video en vivo...');
        setWsPort(null);
        if (playerRef.current) playerRef.current.destroy();

        try {
            const res = await fetch('http://localhost:4000/api/stream/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    rtspUrl: localCamera.rtspUrl, 
                    id: localCamera.id,
                    user: localCamera.user,
                    pass: localCamera.pass
                })
            });
            const data = await res.json();
            
            if (data.success) {
                setWsPort(data.wsPort);
            } else {
                setStatus(data.error || 'Error al iniciar stream');
            }
        } catch (error) {
            setStatus('Error de conectividad Backend.');
        }
    };

    const updateAuth = async (e) => {
        e.preventDefault();
        try {
            const res = await fetch(`http://localhost:4000/api/saved-cameras/${localCamera.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user: tempUser, pass: tempPass })
            });
            const data = await res.json();
            if (data.success) {
                setLocalCamera(data.camera);
                setIsEditingAuth(false);
                // El useEffect de localCamera volverá a disparar startStream
            } else {
                alert('Error actualizando credenciales');
            }
        } catch (e) {
            alert('Error de red al actualizar');
        }
    };

    useEffect(() => {
        let isMounted = true;
        startStream();

        return () => {
            isMounted = false;
            if (playerRef.current) playerRef.current.destroy();
            fetch('http://localhost:4000/api/stream/stop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: localCamera.id })
            }).catch(e => console.error(e));
        };
    }, [localCamera.id, localCamera.rtspUrl, localCamera.user, localCamera.pass]);

    useEffect(() => {
        if (wsPort && canvasRef.current) {
            const url = `ws://localhost:${wsPort}`;
            if (window.JSMpeg) {
                playerRef.current = new window.JSMpeg.Player(url, {
                    canvas: canvasRef.current,
                    videoBufferSize: 1024 * 1024,
                    onVideoDecode: () => {
                        setStatus(''); 
                    }
                });
            } else {
                setStatus('JSMpeg player library not found.');
            }
        }
    }, [wsPort]);

    const handlePtz = async (direction) => {
        setIsPtzAction(true);
        try {
            await fetch('http://localhost:4000/api/ptz/move', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    url: localCamera.ip, 
                    user: localCamera.user, 
                    pass: localCamera.pass || '', 
                    direction 
                })
            });
            setTimeout(() => stopPtz(), 600);
        } catch (e) {
            console.error('PTZ error', e);
        }
    };

    const stopPtz = async () => {
        try {
            await fetch('http://localhost:4000/api/ptz/stop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: localCamera.ip, user: localCamera.user, pass: localCamera.pass || '' })
            });
        } finally {
            setIsPtzAction(false);
        }
    };

    const takeSnapshot = async () => {
        try {
            const res = await fetch('http://localhost:4000/api/snapshot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: localCamera.ip, user: localCamera.user, pass: localCamera.pass || '' })
            });
            if (!res.ok) throw new Error('Failed');
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `snapshot_${localCamera.name}.jpg`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
        } catch (e) {
            alert('Error capturando snapshot. Asegúrate de que las credenciales son correctas.');
        }
    };

    const isAuthError = status.toLowerCase().includes('401') || status.toLowerCase().includes('unauthorized');

    return (
        <div 
            style={{ position: 'relative', width: '100%', height: '100%', background: '#000', overflow: 'hidden' }}
            onMouseEnter={() => setShowControls(true)}
            onMouseLeave={() => setShowControls(false)}
        >
            {(status || isEditingAuth) && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff', gap: '0.5rem', zIndex: 10, padding: '1rem', textAlign: 'center', background: 'rgba(0,0,0,0.85)' }}>
                    
                    {!isEditingAuth ? (
                        <>
                            <Loader className="spin" size={24} />
                            <span style={{ fontSize: '0.9rem', maxWidth: '80%' }}>{status}</span>
                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                                <button className="btn" style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }} onClick={startStream}>
                                    <RefreshCw size={14} /> Reintentar
                                </button>
                                {(isAuthError || true) && ( 
                                    <button className="btn" style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', borderColor: '#fca311', color: '#fca311' }} onClick={() => setIsEditingAuth(true)}>
                                        <Lock size={14} /> Corregir Password
                                    </button>
                                )}
                            </div>
                        </>
                    ) : (
                        <form onSubmit={updateAuth} className="fadeIn" style={{ width: '100%', maxWidth: '280px', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                             <h4 style={{ marginBottom: '0.5rem' }}>Actualizar Credenciales</h4>
                             <input className="stream-input" type="text" placeholder="Usuario (Yoosee: usa 'admin')" value={tempUser} onChange={e => setTempUser(e.target.value)} />
                             <input className="stream-input" type="password" placeholder="Contraseña RTSP" value={tempPass} onChange={e => setTempPass(e.target.value)} />
                             <p style={{ fontSize: '0.65rem', opacity: 0.5, margin: 0 }}>{'💡 Yoosee/Genéricas: usuario '}  <b>admin</b>{' + contraseña de "Conectar grabador NVR"'}</p>
                             <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                                 <button type="submit" className="btn btn-full" style={{ padding: '0.5rem' }}>
                                     <Save size={16} /> Guardar y Reintentar
                                 </button>
                                 <button type="button" className="btn" style={{ padding: '0.5rem', borderColor: 'transparent' }} onClick={() => setIsEditingAuth(false)}>
                                     <X size={16} />
                                 </button>
                             </div>
                        </form>
                    )}
                </div>
            )}
            
            <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }}></canvas>

            {/* Controls Overlay */}
            {showControls && !isEditingAuth && (
                <div className="ptz-overlay fadeIn" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}>
                    <div style={{ position: 'absolute', bottom: '1rem', right: '1rem', pointerEvents: 'auto', display: 'grid', gridTemplateColumns: 'repeat(3, 40px)', gap: '5px' }}>
                        <div></div>
                        <button className="ptz-btn" onClick={() => handlePtz('up')}><ChevronUp size={20}/></button>
                        <div></div>
                        <button className="ptz-btn" onClick={() => handlePtz('left')}><ChevronLeft size={20}/></button>
                        <div style={{ width: '40px', height: '40px' }}></div>
                        <button className="ptz-btn" onClick={() => handlePtz('right')}><ChevronRight size={20}/></button>
                        <div></div>
                        <button className="ptz-btn" onClick={() => handlePtz('down')}><ChevronDown size={20}/></button>
                        <div></div>
                    </div>

                    <div style={{ position: 'absolute', bottom: '1rem', left: '1rem', pointerEvents: 'auto', display: 'flex', gap: '5px' }}>
                        <button className="ptz-btn" onClick={() => handlePtz('zoom-in')}><Plus size={20}/></button>
                        <button className="ptz-btn" onClick={() => handlePtz('zoom-out')}><Minus size={20}/></button>
                    </div>

                    <div style={{ position: 'absolute', top: '1rem', right: '1rem', pointerEvents: 'auto' }}>
                        <button className="ptz-btn" onClick={takeSnapshot} title="Capture Snapshot">
                            <CameraIcon size={20}/>
                        </button>
                    </div>
                </div>
            )}

            {isPtzAction && (
                <div style={{ position: 'absolute', top: '1rem', left: '1rem', background: 'rgba(102, 252, 241, 0.8)', color: '#000', padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600, zIndex: 20 }}>
                    MOVIENDO...
                </div>
            )}

            <style>{`
                .stream-input {
                    background: rgba(255,255,255,0.1);
                    border: 1px solid rgba(255,255,255,0.2);
                    padding: 0.6rem;
                    border-radius: 6px;
                    color: #fff;
                    outline: none;
                }
                .stream-input:focus {
                    border-color: var(--accent-color);
                }
                .ptz-btn {
                    width: 40px; height: 40px;
                    border-radius: 50%;
                    background: rgba(31, 40, 51, 0.85);
                    border: 1px solid rgba(102, 252, 241, 0.4);
                    color: #fff;
                    display: flex; align-items: center; justify-content: center;
                    cursor: pointer;
                    transition: all 0.2s;
                    pointer-events: auto;
                }
                .ptz-btn:hover {
                    background: var(--accent-color);
                    color: #0b0c10;
                    box-shadow: 0 0 15px var(--accent-color);
                    transform: scale(1.1);
                }
            `}</style>
        </div>
    );
};

export default CameraStream;

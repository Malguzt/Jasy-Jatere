import React, { useEffect, useRef, useState } from 'react';
import { Loader, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Plus, Minus, Camera as CameraIcon, RefreshCw, Lock, Save, X, Lightbulb, LightbulbOff } from 'lucide-react';
import { useCameraStreamData } from '../api/hooks';

const CameraStream = ({ camera }) => {
    const canvasRef = useRef(null);
    const videoRef = useRef(null);
    const peerConnectionRef = useRef(null);
    const [status, setStatus] = useState('Conectando video...');
    const [activeTransport, setActiveTransport] = useState('jsmpeg');
    const [isEditingAuth, setIsEditingAuth] = useState(false);
    const [tempUser, setTempUser] = useState('');
    const [tempPass, setTempPass] = useState('');
    const [showControls, setShowControls] = useState(false);
    const [retryCount, setRetryCount] = useState(0);
    const [error, setError] = useState(null);
    let playerRef = useRef(null);
    const {
        localCamera,
        isPtzAction,
        lightOn,
        lightLoading,
        resolveStreamTransport,
        updateAuthCredentials,
        movePtz,
        takeSnapshot: requestSnapshot,
        toggleLight: toggleLightState,
        createWebRtcSession
    } = useCameraStreamData(camera);

    const resolveSelectedTransport = async () => {
        const resolved = await resolveStreamTransport();
        if (resolved.warning) {
            setStatus(resolved.warning);
        }
        return resolved;
    };

    const startJsmpegStream = ({ streamUrl = null, streamPath = null } = {}) => {
        if (peerConnectionRef.current) {
            try {
                peerConnectionRef.current.close();
            } catch (error) {}
            peerConnectionRef.current = null;
        }
        if (playerRef.current) playerRef.current.destroy();

        let url = String(streamUrl || '').trim();
        if (!url) {
            const configuredBase = (import.meta.env.VITE_STREAM_BASE_URL || '').trim();
            const normalizedConfiguredBase = configuredBase
                ? configuredBase.replace(/\/+$/, '').replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:')
                : '';
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const defaultBase = `${protocol}//${window.location.host}`;
            const streamBase = normalizedConfiguredBase || defaultBase;
            const normalizedPath = String(streamPath || '').trim() || `/stream/${localCamera.id}`;
            const safePath = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
            url = `${streamBase}${safePath}`;
        }
        
        console.log(`[JSMP] Conectando a ${url} (Intento ${retryCount + 1})`);
        
        if (window.JSMpeg && canvasRef.current) {
            playerRef.current = new window.JSMpeg.Player(url, {
                canvas: canvasRef.current,
                videoBufferSize: 1024 * 1024,
                audio: false,
                onSourceEstablished: () => {
                    setActiveTransport('jsmpeg');
                    setStatus('');
                    setRetryCount(0);
                    setError(null);
                },
                onSourceCompleted: () => {
                    handleRetry();
                },
                onVideoDecode: () => {
                    setStatus(''); 
                }
            });
        } else {
            setStatus('Error: JSMpeg no disponible.');
        }
    };

    const startWebRtcStream = async ({ cameraId }) => {
        if (!window.RTCPeerConnection) {
            throw new Error('WebRTC is not supported by this browser');
        }
        if (!cameraId) {
            throw new Error('Camera id is required for WebRTC session');
        }

        if (playerRef.current) {
            playerRef.current.destroy();
            playerRef.current = null;
        }
        if (peerConnectionRef.current) {
            try {
                peerConnectionRef.current.close();
            } catch (error) {}
            peerConnectionRef.current = null;
        }

        const pc = new window.RTCPeerConnection();
        peerConnectionRef.current = pc;

        const mediaStream = new window.MediaStream();
        if (videoRef.current) {
            videoRef.current.srcObject = mediaStream;
        }
        pc.ontrack = (event) => {
            const track = event?.track;
            if (track) {
                mediaStream.addTrack(track);
            }
            setActiveTransport('webrtc');
            setStatus('');
            setError(null);
            setRetryCount(0);
        };

        const offer = await pc.createOffer({
            offerToReceiveVideo: true,
            offerToReceiveAudio: false
        });
        await pc.setLocalDescription(offer);

        const payload = await createWebRtcSession({
            cameraId,
            offer: {
                type: offer.type,
                sdp: offer.sdp
            }
        });
        const answer = payload?.session?.answer || null;
        const answerSdp = String(answer?.sdp || '').trim();
        const answerType = String(answer?.type || 'answer').trim().toLowerCase();
        if (!answerSdp || answerType !== 'answer') {
            throw new Error('Invalid WebRTC answer from server');
        }

        await pc.setRemoteDescription({
            type: 'answer',
            sdp: answerSdp
        });
        setActiveTransport('webrtc');
    };

    const startStream = async () => {
        const resolved = await resolveSelectedTransport();
        if (resolved.transport === 'webrtc' && resolved.webrtcEnabled) {
            try {
                setStatus('Conectando WebRTC...');
                await startWebRtcStream({ cameraId: localCamera.id });
                return;
            } catch (webrtcError) {
                console.error('WebRTC stream failed, falling back to JSMpeg:', webrtcError);
                if (!resolved.jsmpegEnabled) {
                    setError('No stream transport available for this client.');
                    setStatus('Error de transporte de streaming.');
                    return;
                }
                setStatus('WebRTC no disponible, usando JSMpeg...');
            }
        }

        if (!resolved.jsmpegEnabled) {
            setError('No stream transport available for this client.');
            setStatus('Error de transporte de streaming.');
            return;
        }
        startJsmpegStream({
            streamUrl: resolved.streamUrl,
            streamPath: resolved.streamPath
        });
    };

    const handleRetry = () => {
        if (retryCount < 10) {
            const delay = Math.min(Math.pow(2, retryCount) * 1000, 15000);
            setStatus(`Reconectando en ${Math.round(delay/1000)}s... (${retryCount + 1})`);
            setTimeout(() => setRetryCount(prev => prev + 1), delay);
        } else {
            setError('Error de conexión persistente.');
            setStatus('Error de conexión.');
        }
    };

    const updateAuth = async (e) => {
        e.preventDefault();
        const result = await updateAuthCredentials({ user: tempUser, pass: tempPass });
        if (result?.success) {
            setIsEditingAuth(false);
            setRetryCount(0);
            return;
        }
        alert(result?.error || 'Error actualizando credenciales');
    };

    useEffect(() => {
        setTempUser(localCamera?.user || '');
        setTempPass(localCamera?.pass || '');
    }, [localCamera?.id, localCamera?.user, localCamera?.pass]);

    useEffect(() => {
        startStream();

        return () => {
            if (playerRef.current) playerRef.current.destroy();
            if (peerConnectionRef.current) {
                try {
                    peerConnectionRef.current.close();
                } catch (error) {}
                peerConnectionRef.current = null;
            }
            if (videoRef.current && videoRef.current.srcObject) {
                const tracks = videoRef.current.srcObject.getTracks?.() || [];
                tracks.forEach((track) => {
                    try {
                        track.stop();
                    } catch (error) {}
                });
                videoRef.current.srcObject = null;
            }
        };
    }, [localCamera.id, localCamera.rtspUrl, localCamera.user, localCamera.pass, retryCount]);


    const handlePtz = async (direction) => {
        try {
            await movePtz(direction);
        } catch (e) {
            console.error('PTZ error', e);
        }
    };

    const takeSnapshot = async () => {
        try {
            const blob = await requestSnapshot();
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

    const toggleLight = async () => {
        const result = await toggleLightState();
        if (!result?.success) {
            alert('No se pudo controlar la luz ONVIF en esta cámara.');
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
            
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{
                    width: '100%',
                    height: '100%',
                    display: activeTransport === 'webrtc' ? 'block' : 'none',
                    objectFit: 'contain',
                    background: '#000'
                }}
            />
            <canvas
                ref={canvasRef}
                style={{
                    width: '100%',
                    height: '100%',
                    display: activeTransport === 'webrtc' ? 'none' : 'block',
                    objectFit: 'contain'
                }}
            ></canvas>

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

                    <div style={{ position: 'absolute', top: '1rem', right: '1rem', pointerEvents: 'auto', display: 'flex', gap: '6px' }}>
                        <button className="ptz-btn" onClick={toggleLight} title={lightOn ? 'Apagar luz' : 'Encender luz'}>
                            {lightLoading ? <Loader className="spin" size={18} /> : (lightOn ? <LightbulbOff size={20}/> : <Lightbulb size={20}/>)}
                        </button>
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

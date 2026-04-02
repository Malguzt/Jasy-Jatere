import React, { useState } from 'react';
import './CameraDetailsModal.css';
import { X, Lock, Unlock, Loader, Video, Settings, Play, Save } from 'lucide-react';
import { apiClient } from '../api/client';

const CameraDetailsModal = ({ camera, onClose }) => {
    const [user, setUser] = useState('');
    const [pass, setPass] = useState('');
    const [loading, setLoading] = useState(false);
    const [details, setDetails] = useState(null);
    const [error, setError] = useState('');

    const handleConnect = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
           const data = await apiClient.connectCamera({ url: camera.address, user, pass });
           if(data.success) {
               setDetails(data);
           } else {
               setError(data.error || 'Error de autenticación. Verifica las credenciales.');
           }
        } catch (err) {
            setError('Error de conexión con el backend.');
            console.error(err);
        }
        setLoading(false);
    };

    const handleSave = async (profile) => {
        if (!profile.rtspUrl) return alert("RTSP no disponible para guardar.");
        
        const payload = { 
            name: `${camera.name || 'Cámara'} - ${profile.name}`, 
            rtspUrl: profile.rtspUrl, 
            ip: camera.address,
            user,
            pass
        };

        // If it's the combined profile, include ALL rtspUrls
        if (profile.token === 'combined_ai') {
            const candidates = details.profiles
                .filter(p => p.token !== 'combined_ai' && p.rtspUrl)
                .map((p) => ({
                    url: p.rtspUrl,
                    label: `${p.name || 'Canal'} ${p.resolution ? `(${p.resolution})` : ''}`.trim()
                }));
            payload.type = 'combined';
            payload.allRtspUrls = candidates.map((c) => c.url);
            payload.sourceLabels = candidates.map((c) => c.label);
        }

        try {
            const data = await apiClient.createSavedCamera(payload);
            if (data.success) {
                if (data.validation && data.validation.ok === false) {
                    const validationErrors = (data?.validation?.errors || []).join(' | ');
                    const detail = validationErrors ? `\nDiagnóstico: ${validationErrors}` : '';
                    alert('Guardada con advertencias para diagnóstico.' + detail);
                } else {
                    alert('¡Guardada en el Dashboard!');
                }
                onClose();
            } else {
                const validationErrors = (data?.validation?.errors || []).join(' | ');
                const detail = validationErrors ? `\nDetalle: ${validationErrors}` : '';
                alert('Error al guardar: ' + (data.error || 'Error desconocido') + detail);
            }
        } catch (e) {
            alert('Error de red');
        }
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content glass-panel popup">
                <button className="close-btn" onClick={onClose}><X size={24} /></button>
                <div className="modal-header">
                    <h2>{camera.name || 'Cámara ONVIF'}</h2>
                    <p className="ip-address">{camera.address}</p>
                </div>

                {!details ? (
                    <form onSubmit={handleConnect} className="auth-form">
                        <p className="auth-instruction">Ingresa credenciales para extraer los perfiles de streaming (deja vacío si no requiere o son default)</p>
                        <div className="input-group">
                            <Lock size={18} className="input-icon" />
                            <input type="text" placeholder="Usuario (Yoosee: usa 'admin')" value={user} onChange={e => setUser(e.target.value)} />
                        </div>
                        <div className="input-group">
                            <Lock size={18} className="input-icon" />
                            <input type="password" placeholder="Contraseña" value={pass} onChange={e => setPass(e.target.value)} />
                        </div>
                        {error && <p className="error-text">{error}</p>}
                        <button type="submit" className="btn btn-full" disabled={loading}>
                            {loading ? <Loader className="spin" size={20} /> : <Unlock size={20} />}
                            {loading ? 'Conectando...' : 'Conectar y Extraer RTSP'}
                        </button>
                    </form>
                ) : (
                    <div className="details-view">
                         <div className="info-block success">
                            <Settings size={18} />
                            <span>Conexión Exitosa. PTZ: {details.ptz ? 'Soportado' : 'No soportado'}</span>
                         </div>
                         
                         <h3 className="section-title"><Video size={20} /> Perfiles de Streaming ({details.profiles?.length})</h3>
                         <div className="profiles-list">
                             {details.profiles && details.profiles.length > 0 ? (
                                 details.profiles.map((prof, i) => (
                                     <div key={prof.token} className="profile-card">
                                        <div className="profile-header">
                                            <strong>{prof.name}</strong>
                                            <span className="badge">{prof.resolution} - {prof.codec}</span>
                                        </div>
                                        <div className="rtsp-url-box">
                                            <Play size={14} />
                                            <input readOnly value={prof.rtspUrl || 'No disponible'} onClick={(e) => e.target.select()} />
                                            <button className="btn" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => handleSave(prof)}>
                                                <Save size={14} /> Guardar
                                            </button>
                                        </div>
                                     </div>
                                 ))
                             ) : (
                                 <p>No se encontraron perfiles de video.</p>
                             )}
                         </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default CameraDetailsModal;

import React, { useState } from 'react';
import './CameraDetailsModal.css';
import { X, Lock, Unlock, Loader, Video, Settings, Play, Save } from 'lucide-react';
import { useCameraOnboardingData } from '../api/hooks';

const CameraDetailsModal = ({ camera, onClose }) => {
    const {
        user,
        setUser,
        pass,
        setPass,
        loading,
        details,
        error,
        connect,
        saveProfile
    } = useCameraOnboardingData(camera);
    const [savingToken, setSavingToken] = useState('');

    const handleConnect = async (e) => {
        e.preventDefault();
        await connect();
    };

    const handleSave = async (profile) => {
        if (!profile?.rtspUrl) {
            alert('RTSP no disponible para guardar.');
            return;
        }
        setSavingToken(profile.token || profile.name || 'unknown');
        const result = await saveProfile(profile);
        setSavingToken('');
        if (result?.success) {
            alert(result.warning || result.message || '¡Guardada en el Dashboard!');
            onClose();
            return;
        }
        alert(result?.error || 'Error de red');
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
                                            <button
                                                className="btn"
                                                style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                                                onClick={() => handleSave(prof)}
                                                disabled={savingToken === (prof.token || prof.name || 'unknown')}
                                            >
                                                {savingToken === (prof.token || prof.name || 'unknown')
                                                    ? <Loader className="spin" size={14} />
                                                    : <Save size={14} />}
                                                {savingToken === (prof.token || prof.name || 'unknown') ? 'Guardando...' : 'Guardar'}
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

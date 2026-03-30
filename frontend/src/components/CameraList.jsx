import React from 'react';
import './CameraList.css';
import { Camera, ShieldCheck, Cpu } from 'lucide-react';

const CameraList = ({ cameras, onSelect }) => {
    return (
        <div className="camera-grid">
            {cameras.map((cam, index) => (
                <div key={index} className="glass-panel camera-card fadeIn" style={{ animationDelay: `${index * 0.1}s` }}>
                    <div className="card-header">
                        <Camera size={28} className="camera-icon" />
                        <h3 className="camera-name">{cam.name || 'Cámara Dectectada'}</h3>
                    </div>
                    <div className="card-body">
                        <p><ShieldCheck size={16}/> <strong>IP / URL:</strong> {cam.address}</p>
                        <p><Cpu size={16}/> <strong>Hardware:</strong> {cam.hardware}</p>
                        <small className="urn-text" title={cam.urn}>URN: {cam.urn}</small>
                    </div>
                    <button className="btn btn-full" onClick={() => onSelect(cam)}>
                        Detalles / Conectar
                    </button>
                </div>
            ))}
        </div>
    );
};

export default CameraList;

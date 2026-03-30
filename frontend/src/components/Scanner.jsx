import React from 'react';
import './Scanner.css';
import { Radar } from 'lucide-react';

const Scanner = () => {
    return (
        <div className="scanner-container glass-panel">
            <div className="radar-animation">
                <Radar size={64} className="radar-icon" />
                <div className="pulse-ring"></div>
                <div className="pulse-ring delay-1"></div>
            </div>
            <h3 className="scanner-text">Sondeando la red local (WS-Discovery)...</h3>
            <p className="scanner-subtext">Por favor espera, esto tomará unos segundos.</p>
        </div>
    );
}

export default Scanner;

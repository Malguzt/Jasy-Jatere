import React from 'react';
import { Circle, Video, Clock } from 'lucide-react';

const STATUS_CONFIG = {
    monitoring: { color: '#4ade80', label: 'MON', icon: '👁', bg: 'rgba(74,222,128,0.15)' },
    recording:  { color: '#ef4444', label: 'REC', icon: '🔴', bg: 'rgba(239,68,68,0.2)' },
    cooldown:   { color: '#facc15', label: 'CDN', icon: '⏳', bg: 'rgba(250,204,21,0.15)' },
    error:      { color: '#6b7280', label: 'ERR', icon: '⚠', bg: 'rgba(107,114,128,0.15)' },
    offline:    { color: '#374151', label: 'OFF', icon: '—', bg: 'rgba(55,65,81,0.15)' }
};

const CATEGORY_ICONS = {
    persona: '🚶',
    vehiculo: '🚗',
    animal: '🐕'
};

const DetectionBadge = ({ detectorState }) => {
    if (!detectorState) {
        return (
            <div style={badgeStyle('rgba(55,65,81,0.6)', '#6b7280')}>
                <span style={{ fontSize: '0.6rem' }}>AI OFF</span>
            </div>
        );
    }

    const { status, detected_objects, recording_remaining, cooldown_remaining } = detectorState;
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.offline;

    const objects = detected_objects || [];
    const categories = [...new Set(objects.map(o => o.category))];

    return (
        <div style={{ position: 'absolute', top: '4px', left: '4px', zIndex: 20, display: 'flex', gap: '3px', alignItems: 'center' }}>
            {/* Main status badge */}
            <div style={badgeStyle(config.bg, config.color)}>
                <span>{config.icon}</span>
                <span style={{ fontWeight: 700 }}>{config.label}</span>
                {status === 'recording' && recording_remaining > 0 && (
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{recording_remaining}s</span>
                )}
                {status === 'cooldown' && cooldown_remaining > 0 && (
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{cooldown_remaining}s</span>
                )}
            </div>

            {/* Detection category icons */}
            {categories.map(cat => (
                <div key={cat} style={badgeStyle('rgba(102,252,241,0.2)', 'var(--accent-color)')}>
                    <span>{CATEGORY_ICONS[cat] || '?'}</span>
                </div>
            ))}
        </div>
    );
};

function badgeStyle(bg, color) {
    return {
        background: bg,
        color: color,
        border: `1px solid ${color}`,
        borderRadius: '3px',
        padding: '1px 5px',
        fontSize: '0.65rem',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        backdropFilter: 'blur(4px)',
        lineHeight: 1.4
    };
}

export default DetectionBadge;

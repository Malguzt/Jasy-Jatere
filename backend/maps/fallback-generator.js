const CATEGORY_RULES = [
    { match: /(auto|coche|camion|camión|bus|moto|vehiculo|vehículo)/i, category: 'vehiculo' },
    { match: /(lavadora|heladera|nevera|microondas|horno|electrodomestico|electrodoméstico)/i, category: 'electrodomestico' },
    { match: /(arbol|árbol|planta|vegetacion|vegetación|cesped|césped)/i, category: 'vegetacion' },
    { match: /(persona|hombre|mujer|niño|niña)/i, category: 'persona' },
    { match: /(perro|gato|animal|caballo|vaca|oveja|ave)/i, category: 'animal' }
];

function makeMapId() {
    const now = new Date();
    const stamp = now.toISOString().replace(/\D/g, '').slice(0, 14);
    const suffix = Math.random().toString(36).slice(2, 6);
    return `map_${stamp}_${suffix}`;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function hashUnit(input) {
    let hash = 0;
    const text = String(input || '');
    for (let index = 0; index < text.length; index += 1) {
        hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
    }
    const abs = Math.abs(hash);
    return (abs % 1000) / 1000;
}

function resolveCategory(label) {
    const text = String(label || '').trim();
    if (!text) return 'estructura';
    const rule = CATEGORY_RULES.find((entry) => entry.match.test(text));
    return rule ? rule.category : 'estructura';
}

function toNumberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function normalizeManualLayout(layout = []) {
    if (!Array.isArray(layout)) return [];
    const out = [];
    const seen = new Set();

    layout.forEach((item, index) => {
        if (!item || typeof item !== 'object') return;
        const rawId = item.id ?? item.cameraId ?? `manual-${index + 1}`;
        const id = String(rawId);
        if (seen.has(id)) return;

        const x = toNumberOrNull(item.x);
        const y = toNumberOrNull(item.y);
        if (x === null || y === null) return;

        const yawDeg = toNumberOrNull(item.yawDeg);
        const label = String(item.label || item.name || `Camara ${index + 1}`).trim();
        seen.add(id);
        out.push({
            id,
            label: label || `Camara ${index + 1}`,
            x: Number(x.toFixed(2)),
            y: Number(y.toFixed(2)),
            yawDeg: Number((yawDeg ?? 0).toFixed(1))
        });
    });

    return out;
}

function normalizeLabel(label) {
    return String(label || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9\-_]/g, '')
        .slice(0, 42);
}

function buildCameraLayout(cameras = [], manualCameraLayout = []) {
    const safeCameras = Array.isArray(cameras) ? cameras : [];
    const manual = normalizeManualLayout(manualCameraLayout);
    const manualById = new Map(manual.map((camera) => [camera.id, camera]));
    if (safeCameras.length === 0 && manual.length > 0) {
        return manual;
    }
    const count = Math.max(1, safeCameras.length);
    const radius = Math.max(8, count * 3.5);
    const originX = 0;
    const originY = 0;

    return safeCameras.map((camera, index) => {
        const manualOverride = manualById.get(String(camera.id));
        if (manualOverride) {
            return {
                id: String(camera.id),
                label: camera.name || manualOverride.label,
                x: Number(manualOverride.x),
                y: Number(manualOverride.y),
                yawDeg: Number(manualOverride.yawDeg ?? 0)
            };
        }

        const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
        const x = Number((originX + radius * Math.cos(angle)).toFixed(2));
        const y = Number((originY + radius * Math.sin(angle)).toFixed(2));
        const yawDeg = Number((((angle + Math.PI) * 180) / Math.PI).toFixed(1));
        return {
            id: String(camera.id),
            label: camera.name || `Camara ${index + 1}`,
            x,
            y,
            yawDeg
        };
    });
}

function toObjectFromEvent(cameraById, event, objectLabel, index) {
    const camId = event?.camera_id ? String(event.camera_id) : null;
    const anchorCamera = camId && cameraById.has(camId) ? cameraById.get(camId) : null;
    const anchorX = anchorCamera ? Number(anchorCamera.x) : 0;
    const anchorY = anchorCamera ? Number(anchorCamera.y) : 0;
    const unitA = hashUnit(`${event?.timestamp || Date.now()}-${objectLabel}-${index}`);
    const unitB = hashUnit(`${event?.camera || ''}-${objectLabel}-${index}-b`);
    const angle = unitA * Math.PI * 2;
    const distance = 1.5 + unitB * 2.5;
    const x = Number((anchorX + Math.cos(angle) * distance).toFixed(2));
    const y = Number((anchorY + Math.sin(angle) * distance).toFixed(2));
    const label = String(objectLabel || '').trim() || 'objeto-no-clasificado';
    const safeLabel = normalizeLabel(label) || `obj-${index + 1}`;

    return {
        id: `obj_${safeLabel}_${index + 1}`,
        label,
        category: resolveCategory(label),
        x,
        y,
        confidence: Number(clamp(0.55 + unitB * 0.35, 0.3, 0.95).toFixed(2)),
        sources: camId ? [camId] : []
    };
}

function mapHintsToObjects(hints = [], cameraById = new Map()) {
    if (!Array.isArray(hints)) return [];
    const objects = [];
    hints.forEach((hint, index) => {
        if (!hint || typeof hint !== 'object') return;
        const label = String(hint.label || '').trim();
        if (!label) return;
        const cameraRef = hint.cameraId ? cameraById.get(String(hint.cameraId)) : null;
        const x = Number.isFinite(Number(hint.x)) ? Number(hint.x) : Number((cameraRef?.x || 0) + ((index % 3) - 1) * 1.2);
        const y = Number.isFinite(Number(hint.y)) ? Number(hint.y) : Number((cameraRef?.y || 0) + ((index % 2) - 0.5) * 1.4);
        objects.push({
            id: `hint_${normalizeLabel(label) || `obj-${index + 1}`}_${index + 1}`,
            label,
            category: String(hint.category || resolveCategory(label)),
            x: Number(x.toFixed(2)),
            y: Number(y.toFixed(2)),
            confidence: Number(clamp(Number(hint.confidence) || 0.7, 0.05, 0.99).toFixed(2)),
            sources: hint.cameraId ? [String(hint.cameraId)] : []
        });
    });
    return objects;
}

function buildObjectsFromEvents(recentEvents = [], cameraById = new Map()) {
    const events = Array.isArray(recentEvents) ? recentEvents : [];
    const dedupe = new Set();
    const out = [];

    events.slice(-60).forEach((event, eventIndex) => {
        const objects = Array.isArray(event?.objects) ? event.objects : [];
        objects.forEach((objectLabel, objectIndex) => {
            const safeLabel = normalizeLabel(objectLabel) || 'objeto';
            const camKey = event?.camera_id ? String(event.camera_id) : 'unknown-cam';
            const key = `${camKey}:${safeLabel}`;
            if (dedupe.has(key)) return;
            dedupe.add(key);
            out.push(toObjectFromEvent(cameraById, event, objectLabel, eventIndex * 10 + objectIndex));
        });
    });

    return out;
}

function buildFallbackCroquis({
    jobId,
    cameras = [],
    recentEvents = [],
    objectHints = [],
    manualCameraLayout = [],
    planUsed = 'B'
}) {
    const cameraLayout = buildCameraLayout(cameras, manualCameraLayout);
    const cameraById = new Map(cameraLayout.map((camera) => [camera.id, camera]));
    const eventObjects = buildObjectsFromEvents(recentEvents, cameraById);
    const hintObjects = mapHintsToObjects(objectHints, cameraById);
    const objects = [...eventObjects, ...hintObjects];

    return {
        schemaVersion: '1.0',
        mapId: makeMapId(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sourceJobId: jobId || null,
        quality: {
            mode: 'croquis',
            score: planUsed === 'B' ? 0.62 : 0.51,
            planUsed,
            warnings: [
                'Mapa generado con fallback heuristico.',
                'La escala es aproximada y puede requerir ajuste manual.'
            ]
        },
        cameras: cameraLayout,
        objects,
        metadata: {
            generatedBy: 'backend-fallback',
            planUsed,
            cameraCount: cameraLayout.length,
            objectCount: objects.length
        }
    };
}

module.exports = {
    buildFallbackCroquis,
    makeMapId,
    resolveCategory,
    normalizeManualLayout
};

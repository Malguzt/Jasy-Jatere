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

function resolveCategory(label) {
    const text = String(label || '').trim();
    if (!text) return 'estructura';
    const rule = CATEGORY_RULES.find((entry) => entry.match.test(text));
    return rule ? rule.category : 'estructura';
}

function toNumberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
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

module.exports = {
    makeMapId,
    resolveCategory,
    normalizeManualLayout
};

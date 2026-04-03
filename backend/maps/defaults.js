const DEFAULT_INDEX = {
    schemaVersion: '1.0',
    activeMapId: null,
    maps: []
};

const DEFAULT_CORRECTIONS = {
    schemaVersion: '1.0',
    updatedAt: null,
    lastManualMapId: null,
    manualCameraLayout: [],
    objectHints: [],
    history: []
};

module.exports = {
    DEFAULT_INDEX,
    DEFAULT_CORRECTIONS
};

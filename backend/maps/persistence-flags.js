function resolveMapPersistenceFlags(env = process.env) {
    const metadataDriver = String(env.METADATA_STORE_DRIVER || 'sqlite').toLowerCase();
    return {
        metadataDriver,
        exportCompatJson: false
    };
}

module.exports = {
    resolveMapPersistenceFlags
};

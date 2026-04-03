const { MetadataSqliteStore } = require('../infrastructure/sqlite/metadata-sqlite-store');

function createMetadataContext({
    metadataDriver = String(process.env.METADATA_STORE_DRIVER || 'sqlite').toLowerCase(),
    sqliteStoreFactory = () => new MetadataSqliteStore()
} = {}) {
    const driver = String(metadataDriver || 'sqlite').toLowerCase();
    const sqliteStore = driver === 'sqlite' ? sqliteStoreFactory() : null;
    if (driver === 'sqlite' && sqliteStore && typeof sqliteStore.migrate === 'function') {
        sqliteStore.migrate();
    }
    return {
        metadataDriver: driver,
        sqliteStore
    };
}

module.exports = {
    createMetadataContext
};

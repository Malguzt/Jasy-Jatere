const { MetadataSqliteStore } = require('../infrastructure/sqlite/metadata-sqlite-store');

function createMetadataContext({
    metadataDriver = 'sqlite',
    metadataSqlitePath = '',
    sqliteStoreFactory = ({ metadataSqlitePath: sqlitePath = '' } = {}) => new MetadataSqliteStore({
        dbPath: sqlitePath || undefined
    })
} = {}) {
    const driver = String(metadataDriver || 'sqlite').toLowerCase();
    const sqliteStore = driver === 'sqlite'
        ? sqliteStoreFactory({ metadataSqlitePath: metadataSqlitePath || '' })
        : null;
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

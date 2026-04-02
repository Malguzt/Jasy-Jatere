const { MetadataSqliteStore, DEFAULT_DB_PATH } = require('../src/infrastructure/sqlite/metadata-sqlite-store');

function run() {
    const store = new MetadataSqliteStore();
    store.migrate();
    // eslint-disable-next-line no-console
    console.log(`metadata-db: migrations applied (${DEFAULT_DB_PATH})`);
}

try {
    run();
} catch (error) {
    // eslint-disable-next-line no-console
    console.error(`metadata-db migrate failed: ${error?.message || error}`);
    process.exit(1);
}

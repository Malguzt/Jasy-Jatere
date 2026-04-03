const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DEFAULT_DB_PATH = path.join(__dirname, '..', '..', '..', 'data', 'metadata', 'metadata.db');

class MetadataSqliteStore {
    constructor({ dbPath = DEFAULT_DB_PATH } = {}) {
        this.dbPath = dbPath;
        this.db = null;
    }

    connect() {
        if (this.db) return this.db;
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        this.db = new Database(this.dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        return this.db;
    }

    migrate() {
        const db = this.connect();

        db.exec(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version TEXT PRIMARY KEY,
                applied_at INTEGER NOT NULL
            );
        `);

        const applied = new Set(
            db.prepare('SELECT version FROM schema_migrations').all().map((row) => String(row.version))
        );

        const migrations = [
            {
                version: '001_core_metadata',
                sql: `
                    CREATE TABLE IF NOT EXISTS cameras (
                        id TEXT PRIMARY KEY,
                        payload_json TEXT NOT NULL,
                        updated_at INTEGER NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS recordings_catalog (
                        filename TEXT PRIMARY KEY,
                        event_ts INTEGER NOT NULL,
                        payload_json TEXT NOT NULL,
                        updated_at INTEGER NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS observation_events (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        event_ts INTEGER NOT NULL,
                        payload_json TEXT NOT NULL,
                        created_at INTEGER NOT NULL
                    );

                    CREATE INDEX IF NOT EXISTS idx_observation_events_event_ts
                    ON observation_events(event_ts DESC);

                    CREATE TABLE IF NOT EXISTS health_snapshots (
                        camera_id TEXT PRIMARY KEY,
                        payload_json TEXT NOT NULL,
                        updated_at INTEGER NOT NULL
                    );
                `
            },
            {
                version: '002_maps_and_jobs_metadata',
                sql: `
                    CREATE TABLE IF NOT EXISTS control_plane_state (
                        state_key TEXT PRIMARY KEY,
                        value_json TEXT NOT NULL,
                        updated_at INTEGER NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS map_versions (
                        map_id TEXT PRIMARY KEY,
                        created_at INTEGER NOT NULL,
                        updated_at INTEGER NOT NULL,
                        payload_json TEXT NOT NULL
                    );

                    CREATE INDEX IF NOT EXISTS idx_map_versions_created_at
                    ON map_versions(created_at DESC);

                    CREATE TABLE IF NOT EXISTS map_jobs (
                        job_id TEXT PRIMARY KEY,
                        requested_at INTEGER NOT NULL,
                        updated_at INTEGER NOT NULL,
                        payload_json TEXT NOT NULL
                    );

                    CREATE INDEX IF NOT EXISTS idx_map_jobs_requested_at
                    ON map_jobs(requested_at DESC);

                    CREATE TABLE IF NOT EXISTS map_manual_corrections (
                        id INTEGER PRIMARY KEY CHECK (id = 1),
                        updated_at INTEGER NOT NULL,
                        payload_json TEXT NOT NULL
                    );
                `
            }
        ];

        const insertMigration = db.prepare(
            'INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)'
        );

        const runMigration = db.transaction((migration) => {
            db.exec(migration.sql);
            insertMigration.run(migration.version, Date.now());
        });

        migrations.forEach((migration) => {
            if (applied.has(migration.version)) return;
            runMigration(migration);
        });
    }

    getDb() {
        this.migrate();
        return this.db;
    }
}

module.exports = {
    MetadataSqliteStore,
    DEFAULT_DB_PATH
};

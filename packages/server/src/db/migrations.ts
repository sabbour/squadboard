/**
 * migrations.ts — Wave 28 I9: Migration safety with rollback hooks, dry-run, snapshots
 *
 * Orchestrates applying SQL migrations from packages/server/src/db/migrations/*.sql,
 * tracking applied migrations in _migration_log, and supporting:
 * - Dry-run mode (print without applying)
 * - Schema snapshots before each migration
 * - Rollback to a target version
 * - Bootstrap DDL skip flag for production environments
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { PoolLike } from './pglite.js';

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface MigrationFile {
  version: number;
  filename: string;
  upSql: string;
  downSql?: string;
}

export interface MigrationLogEntry {
  version: number;
  filename: string;
  appliedAt: Date;
  checksum: string;
}

/**
 * Compute a simple checksum of SQL content to detect file changes.
 */
function computeChecksum(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16);
}

/**
 * Load all migration files from the migrations directory.
 * Returns list sorted by version (ascending).
 */
async function loadMigrationFiles(): Promise<MigrationFile[]> {
  const migrationDir = path.join(__dirname, 'migrations');
  const files = await fs.readdir(migrationDir);

  const migrations: MigrationFile[] = [];

  for (const filename of files) {
    const match = filename.match(/^(\d+)_.*\.sql$/);
    if (!match) continue;

    const version = parseInt(match[1], 10);
    const filePath = path.join(migrationDir, filename);
    const upSql = await fs.readFile(filePath, 'utf-8');

    // Check for corresponding .rollback.sql file
    const rollbackFilename = `${match[1]}_${filename.split('_').slice(1).join('_').replace('.sql', '')}.rollback.sql`;
    const rollbackPath = path.join(migrationDir, rollbackFilename);
    let downSql: string | undefined;

    try {
      downSql = await fs.readFile(rollbackPath, 'utf-8');
    } catch {
      // No rollback file; downSql remains undefined
    }

    migrations.push({
      version,
      filename,
      upSql,
      downSql,
    });
  }

  return migrations.sort((a, b) => a.version - b.version);
}

/**
 * Get all applied migrations from _migration_log table.
 */
async function getAppliedMigrations(pool: PoolLike): Promise<MigrationLogEntry[]> {
  try {
    const result = await pool.query(
      `SELECT version, filename, applied_at AS "appliedAt", checksum FROM _migration_log ORDER BY version ASC`,
    );
    return (result.rows as unknown as MigrationLogEntry[]);
  } catch {
    // Table doesn't exist yet (first run), return empty list
    return [];
  }
}

/**
 * Record a migration as applied in _migration_log.
 */
async function recordMigrationApplied(
  pool: PoolLike,
  version: number,
  filename: string,
  checksum: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO _migration_log (version, filename, checksum, applied_at) VALUES ($1, $2, $3, NOW())
     ON CONFLICT (version) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = NOW()`,
    [version, filename, checksum],
  );
}

/**
 * Capture schema snapshot (all tables + columns) and write to .squad/db-snapshots/.
 */
async function captureSchemaSnapshot(pool: PoolLike, timestamp: string): Promise<void> {
  const snapshotDir = path.join(process.cwd(), '.squad', 'db-snapshots');

  // Ensure directory exists
  await fs.mkdir(snapshotDir, { recursive: true });

  // Query all tables and their columns
  const result = await pool.query(`
    SELECT
      t.table_schema,
      t.table_name,
      c.column_name,
      c.data_type,
      c.is_nullable
    FROM information_schema.tables t
    JOIN information_schema.columns c ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY t.table_name, c.ordinal_position
  `);

  const snapshot = {
    timestamp,
    tables: {} as Record<string, Array<{ column: string; type: string; nullable: boolean }>>,
  };

  for (const row of result.rows as any[]) {
    const tableName = row.table_name;
    if (!snapshot.tables[tableName]) {
      snapshot.tables[tableName] = [];
    }
    snapshot.tables[tableName].push({
      column: row.column_name,
      type: row.data_type,
      nullable: (row.is_nullable as string) === 'YES',
    });
  }

  const snapshotFile = path.join(snapshotDir, `${timestamp}-pre-migration.json`);
  await fs.writeFile(snapshotFile, JSON.stringify(snapshot, null, 2), 'utf-8');
}

/**
 * Apply pending migrations up to an optional target version.
 * Respects MIGRATIONS_DRY_RUN and captures schema snapshots.
 */
export async function applyMigrations(
  pool: PoolLike,
  options?: {
    dryRun?: boolean;
    upToVersion?: number;
  },
): Promise<void> {
  const dryRun = options?.dryRun ?? process.env.MIGRATIONS_DRY_RUN === '1';
  const upToVersion = options?.upToVersion;

  const allMigrations = await loadMigrationFiles();
  const appliedMigrations = await getAppliedMigrations(pool);
  const appliedVersions = new Set(appliedMigrations.map((m) => m.version));

  const pendingMigrations = allMigrations.filter((m) => {
    if (appliedVersions.has(m.version)) return false;
    if (upToVersion !== undefined && m.version > upToVersion) return false;
    return true;
  });

  if (pendingMigrations.length === 0) {
    console.log('[migrations] All migrations up to date');
    return;
  }

  for (const migration of pendingMigrations) {
    const checksum = computeChecksum(migration.upSql);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    if (dryRun) {
      console.log(`[migrations:dry-run] Would apply ${migration.version}: ${migration.filename}`);
      console.log(`[migrations:dry-run] Checksum: ${checksum}`);
      console.log(`[migrations:dry-run] SQL:\n${migration.upSql}`);
      continue;
    }

    console.log(`[migrations] Applying ${migration.version}: ${migration.filename}`);

    // Capture schema snapshot before migration
    try {
      await captureSchemaSnapshot(pool, timestamp);
      console.log(`[migrations] Captured schema snapshot: .squad/db-snapshots/${timestamp}-pre-migration.json`);
    } catch (err) {
      console.warn(`[migrations] Failed to capture schema snapshot: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Apply the migration
    try {
      await pool.query(migration.upSql);
      await recordMigrationApplied(pool, migration.version, migration.filename, checksum);
      console.log(`[migrations] ✓ Applied ${migration.version}: ${migration.filename}`);
    } catch (err) {
      console.error(`[migrations] ✗ Failed to apply ${migration.version}: ${migration.filename}`);
      console.error(err);
      throw err;
    }
  }
}

/**
 * Rollback migrations down to a target version.
 * Requires rollback SQL files to exist.
 */
export async function rollbackMigrations(pool: PoolLike, targetVersion: number): Promise<void> {
  const allMigrations = await loadMigrationFiles();
  const appliedMigrations = await getAppliedMigrations(pool);

  // Migrations to rollback: those applied and with version > targetVersion, in reverse order
  const toRollback = appliedMigrations
    .filter((m) => m.version > targetVersion)
    .sort((a, b) => b.version - a.version);

  if (toRollback.length === 0) {
    console.log(`[migrations] Already at or before version ${targetVersion}`);
    return;
  }

  for (const appliedMig of toRollback) {
    const migrationDef = allMigrations.find((m) => m.version === appliedMig.version);

    if (!migrationDef?.downSql) {
      throw new Error(
        `[migrations] Cannot rollback version ${appliedMig.version}: no rollback SQL file found. ` +
          `Create ${appliedMig.version}_*.rollback.sql to enable rollback.`,
      );
    }

    console.log(`[migrations] Rolling back ${appliedMig.version}: ${appliedMig.filename}`);

    try {
      await pool.query(migrationDef.downSql);
      // Remove from migration log
      await pool.query(`DELETE FROM _migration_log WHERE version = $1`, [appliedMig.version]);
      console.log(`[migrations] ✓ Rolled back ${appliedMig.version}`);
    } catch (err) {
      console.error(`[migrations] ✗ Failed to rollback ${appliedMig.version}`);
      console.error(err);
      throw err;
    }
  }
}

/**
 * Initialize the _migration_log table if it doesn't exist.
 * This is called before applying migrations.
 */
export async function initMigrationLog(pool: PoolLike): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migration_log (
      version     INTEGER PRIMARY KEY,
      filename    TEXT NOT NULL,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

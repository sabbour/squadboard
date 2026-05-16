#!/usr/bin/env node
/**
 * packages/server/src/cli/migrate.ts
 *
 * CLI surface for the one-time legacy-PG → PGlite migration.
 *
 * Commands:
 *   squadboard migrate             — run migration (no-op if marker present)
 *   squadboard migrate --force     — re-run even if marker present (prompts)
 *   squadboard migrate --force --yes  — re-run without prompt
 *   squadboard migrate --dry-run   — report row counts, no writes
 *
 * Environment:
 *   SQUADBOARD_AUTO_MIGRATE=false  — opt out of auto-migration on server boot
 *
 * Invoked via: node dist/cli/migrate.js [flags]
 * Or during development: tsx src/cli/migrate.ts [flags]
 *
 * ─── Migration UX ────────────────────────────────────────────────────────────
 *
 * First boot after Wave 13 upgrade:
 *   [migrate] Detected legacy cluster at ~/.squadboard/data/ — starting one-time
 *             migration to PGlite
 *   [migrate]   projects: 4 rows migrated
 *   [migrate]   issues: 166 rows migrated
 *   …
 *   [migrate] ✅ Migration complete. 166 issues + 4 projects + N issue_runs migrated.
 *             Marker written. Legacy cluster will not be touched again — safe to
 *             delete ~/.squadboard/data/ manually after verifying.
 *
 * Subsequent boots:
 *   [migrate] Skipped: Migration marker present — already migrated
 *
 * Force re-run:
 *   $ squadboard migrate --force --yes
 *   [migrate] --force set: overwriting existing PGlite data
 *   …
 */

import { fileURLToPath } from 'node:url';
import { runMigration } from '../scripts/migrate-from-legacy-pg.js';
import { runVerify } from '../scripts/verify-migration.js';

const args = process.argv.slice(2);
const force = args.includes('--force');
const dryRun = args.includes('--dry-run');
const yes = args.includes('--yes');
const verify = args.includes('--verify');
const verbose = args.includes('--verbose') || args.includes('-v');

async function main(): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  // --verify: read marker + compare live PGlite counts, then exit
  if (verify) {
    const ok = await runVerify({ verbose });
    process.exit(ok ? 0 : 1);
    return;
  }

  try {
    const result = await runMigration({ force, dryRun, yes, verbose });
    if (result.skipped) {
      console.log(`[migrate] Skipped: ${result.reason}`);
    } else if (result.snapshotPath) {
      // Migration created a dumpDataDir snapshot — restore from it so the data
      // survives the next PGlite restart (NodeFS-to-MEMFS round-trip via loadDataDir).
      console.log(`[migrate] Restoring snapshot into PGlite data dir via loadDataDir…`);
      const { runRestore } = await import('../scripts/restore.js');
      const restoreResult = await runRestore(result.snapshotPath, { force: true });
      if (restoreResult.ok) {
        console.log(`[migrate] ✅ Snapshot restore complete — PGlite data dir is live.`);
      } else {
        console.error(`[migrate] ❌ Snapshot restore failed: ${restoreResult.message}`);
        process.exit(1);
        return;
      }
    }
    process.exit(0);
  } catch (err: unknown) {
    console.error('[migrate] ❌ Migration failed:', err);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
squadboard migrate — One-time legacy PostgreSQL → PGlite data migration

USAGE
  squadboard migrate [options]

OPTIONS
  --verify      Verify the migration by comparing marker source counts against
                live PGlite destination counts. Exits 0 if all match, 1 if any deltas.
  --force       Re-run even if the migration marker exists. Overwrites PGlite data.
  --yes         Skip confirmation prompt (required with --force in non-TTY contexts).
  --dry-run     Report row counts from the legacy cluster without writing to PGlite.
  --verbose     Extra diagnostic output (show zero-count tables in --verify mode).
  --help        Show this help.

ENVIRONMENT
  DATABASE_URL          When set, migration is skipped (hosted/cloud mode).
  SQUADBOARD_AUTO_MIGRATE=false
                        Disables auto-migration on server boot.

NOTES
  Migration is idempotent: running it again after success is a no-op.
  The legacy data directory is never modified or deleted.
  After verifying the migration, you may safely remove ~/.squadboard/data/
  (but keep ~/.squadboard/data/pglite/ — that's your live database).
`);
}

// Run when invoked directly
const thisFile = fileURLToPath(import.meta.url);
const argv1 = process.argv[1] ?? '';
if (argv1 === thisFile || argv1.endsWith('/migrate.js') || argv1.endsWith('/migrate.ts')) {
  main();
}

export { main as migrateCommand };

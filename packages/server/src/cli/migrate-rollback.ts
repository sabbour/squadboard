#!/usr/bin/env node
/**
 * packages/server/src/cli/migrate-rollback.ts
 *
 * CLI for rolling back migrations to a target version.
 *
 * Commands:
 *   pnpm run migrate:rollback -- --to=0001    — rollback to version 0001
 *   pnpm run migrate:rollback -- --help       — show help
 *
 * Environment:
 *   Uses the same database connection as the server.
 */

import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { initDb, getPool } from '../db/index.js';
import { rollbackMigrations } from '../db/migrations.js';

const args = process.argv.slice(2);

async function main(): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  try {
    const parsed = parseArgs({
      options: {
        to: { type: 'string' },
      },
      args,
      allowPositionals: false,
    });

    const targetVersionStr = parsed.values.to;
    if (!targetVersionStr) {
      console.error('[migrate:rollback] Error: --to is required (e.g., --to=0001)');
      printHelp();
      process.exit(1);
    }

    const targetVersion = parseInt(targetVersionStr.padStart(4, '0'), 10);
    if (isNaN(targetVersion)) {
      console.error(`[migrate:rollback] Error: invalid target version "${targetVersionStr}"`);
      process.exit(1);
    }

    // Initialize DB (uses PGLITE_SENTINEL by default)
    await initDb(process.env.DATABASE_URL || 'pglite://');

    // Perform rollback
    const pool = getPool();
    await rollbackMigrations(pool, targetVersion);

    console.log(`[migrate:rollback] ✓ Rollback to version ${targetVersionStr} complete`);
    process.exit(0);
  } catch (err: unknown) {
    console.error('[migrate:rollback] ✗ Rollback failed:', err);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
migrate:rollback — Rollback migrations to a target version

USAGE
  pnpm run migrate:rollback -- --to=<VERSION>

EXAMPLES
  pnpm run migrate:rollback -- --to=0001    Rollback to version 0001
  pnpm run migrate:rollback -- --to=0000    Rollback all migrations

NOTES
  - Each migration must have a corresponding .rollback.sql file.
  - Rollback is applied in reverse order (highest version first).
  - Migration log entry is deleted upon successful rollback.
`);
}

// Run when invoked directly
const thisFile = fileURLToPath(import.meta.url);
const argv1 = process.argv[1] ?? '';
if (
  argv1 === thisFile ||
  argv1.endsWith('/migrate-rollback.js') ||
  argv1.endsWith('/migrate-rollback.ts')
) {
  main();
}

export { main as migrateRollbackCommand };

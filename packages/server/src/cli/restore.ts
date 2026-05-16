#!/usr/bin/env node
/**
 * packages/server/src/cli/restore.ts
 *
 * CLI surface for `squadboard restore <backup-file>`.
 *
 * Usage:
 *   squadboard restore ~/.squadboard/backups/squadboard-2026-05-15T22-00-00.tar.gz
 *   squadboard restore /path/to/backup.tar.gz --force   (skip daemon check — tests only)
 *
 * Exit codes: 0 success, 1 error or verify failure.
 */

import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { runRestore } from '../scripts/restore.js';

const HOME = homedir();
const DEFAULT_BACKUP_DIR = join(HOME, '.squadboard', 'backups');

const args = process.argv.slice(2);

async function main(): Promise<void> {
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    printHelp();
    process.exit(args.length === 0 ? 1 : 0);
  }

  if (args[0] === 'list') {
    listBackups();
    process.exit(0);
  }

  const backupPath = args[0]!;
  const force = args.includes('--force');

  if (!backupPath.startsWith('/') && !backupPath.startsWith('~') && !backupPath.startsWith('.')) {
    console.error(`[restore] Backup path must be absolute or relative. Got: ${backupPath}`);
    process.exit(1);
  }

  // Expand ~ in path
  const resolvedPath = backupPath.startsWith('~/')
    ? join(HOME, backupPath.slice(2))
    : backupPath;

  if (!existsSync(resolvedPath)) {
    console.error(`[restore] File not found: ${resolvedPath}`);
    console.error('[restore] Run `squadboard restore list` to see available backups.');
    process.exit(1);
  }

  console.log('[restore] ⚠️  WARNING: This will replace the current PGlite cluster.');
  console.log('[restore]    The current cluster will be preserved as a rollback copy.');
  console.log('');

  const result = await runRestore(resolvedPath, { force });

  if (!result.ok) {
    console.error(`[restore] ❌ ${result.message}`);
    process.exit(1);
  }

  if (!result.verifyOk) {
    console.warn(`[restore] ⚠️  ${result.message}`);
    process.exit(1);
  }

  // Message already printed by runRestore. Just exit.
  process.exit(0);
}

function listBackups(): void {
  if (!existsSync(DEFAULT_BACKUP_DIR)) {
    console.log('[restore] No backups directory found at', DEFAULT_BACKUP_DIR);
    return;
  }

  const files = readdirSync(DEFAULT_BACKUP_DIR)
    .filter((f) => f.startsWith('squadboard-') && (f.endsWith('.tar.gz') || f.endsWith('.tar')))
    .map((f) => {
      const p = join(DEFAULT_BACKUP_DIR, f);
      const stat = statSync(p);
      return { name: f, path: p, size: stat.size, mtime: stat.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) {
    console.log('[restore] No backups found in', DEFAULT_BACKUP_DIR);
    return;
  }

  console.log(`Available backups (${files.length}):`);
  for (const f of files) {
    const sizeMB = (f.size / 1024 / 1024).toFixed(2);
    const date = new Date(f.mtime).toISOString();
    console.log(`  ${f.name}  ${sizeMB} MB  ${date}`);
  }
}

function printHelp(): void {
  console.log(`
squadboard restore — Restore PGlite database from a backup file

USAGE
  squadboard restore <backup-file>   — restore from backup
  squadboard restore list            — list available backups

OPTIONS
  --force        Skip daemon-running check (for tests; NOT for production use)
  --help         Show this help

SAFETY
  • The server daemon must NOT be running (checked via ~/.squadboard/daemon.pid).
    Stop it first: squadboard daemon stop
  • The current PGlite cluster is moved to ~/.squadboard/data/pglite.pre-restore-{timestamp}/
    before the restore begins. This is your rollback copy.
  • After restore, row counts are verified. Exit 0 = success, 1 = failure.
  • On failure, the original cluster is automatically rolled back.

ROLLBACK
  If you need to undo a restore:
    mv ~/.squadboard/data/pglite ~/.squadboard/data/pglite.bad
    mv ~/.squadboard/data/pglite.pre-restore-<timestamp> ~/.squadboard/data/pglite

NOTES
  Backups are produced by 'squadboard backup' using PGlite's dumpDataDir() API.
  Cross-machine restore requires the same PGlite version (@electric-sql/pglite@0.4.5).
`);
}

const thisFile = fileURLToPath(import.meta.url);
const argv1 = process.argv[1] ?? '';
if (argv1 === thisFile || argv1.endsWith('/restore.js') || argv1.endsWith('/restore.ts')) {
  main();
}

export { main as restoreCommand };

/**
 * backup.ts
 *
 * Core backup logic for the PGlite cluster.
 *
 * Format: PGlite-native dumpDataDir() → gzipped tarball (.tar.gz).
 * This is Format A (PGlite API): self-contained, version-tagged, and
 * restoreable via PGlite({ loadDataDir: blob }). It is NOT a plain
 * filesystem tar of the data directory — it's produced by PGlite's WASM
 * checkpoint + tar routine, so it's safe to create while PGlite is live.
 *
 * Default output: ~/.squadboard/backups/squadboard-{ISO8601}.tar.gz
 *
 * Retention: after each backup, prune to retainCount most-recent files in
 * the backups dir. Config via ~/.squadboard/config.json { backup: { intervalMs, retainCount } }.
 *
 * Exported:
 *   runBackup(opts?) → Promise<BackupResult>
 *   pruneBackups(dir, retainCount) → Promise<string[]>  (returns pruned paths)
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const DEFAULT_BACKUP_DIR = join(HOME, '.squadboard', 'backups');
const DEFAULT_RETAIN_COUNT = 7;

export interface BackupOptions {
  /** Override output path. Defaults to ~/.squadboard/backups/squadboard-{ts}.tar.gz */
  outPath?: string;
  /** Prune backups dir to this many files after writing. Defaults to config or 7. */
  retainCount?: number;
  /** Suppress console output. */
  quiet?: boolean;
}

export interface BackupResult {
  path: string;
  sizeBytes: number;
  pruned: string[];
  durationMs: number;
}

/** Resolve backup config from ~/.squadboard/config.json */
function readBackupConfig(): { intervalMs: number; retainCount: number } {
  const configPath = join(HOME, '.squadboard', 'config.json');
  try {
    if (!existsSync(configPath)) return { intervalMs: 24 * 3600_000, retainCount: DEFAULT_RETAIN_COUNT };
    const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
    return {
      intervalMs: raw?.backup?.intervalMs ?? 24 * 3600_000,
      retainCount: raw?.backup?.retainCount ?? DEFAULT_RETAIN_COUNT,
    };
  } catch {
    return { intervalMs: 24 * 3600_000, retainCount: DEFAULT_RETAIN_COUNT };
  }
}

/**
 * Prune oldest backup files in dir, keeping only retainCount most-recent.
 * Files are identified by their mtime. Returns paths that were deleted.
 */
export function pruneBackups(dir: string, retainCount: number): string[] {
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir)
    .filter((f) => f.startsWith('squadboard-') && (f.endsWith('.tar.gz') || f.endsWith('.tar')))
    .map((f) => ({ name: f, path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime); // newest first

  if (files.length <= retainCount) return [];

  const toDelete = files.slice(retainCount);
  const pruned: string[] = [];
  for (const f of toDelete) {
    try {
      unlinkSync(f.path);
      pruned.push(f.path);
    } catch (err) {
      console.warn(`[backup] Failed to prune ${f.path}: ${(err as Error).message}`);
    }
  }
  return pruned;
}

/**
 * Run a backup of the live PGlite cluster.
 * Uses PGlite's dumpDataDir('gzip') to produce a .tar.gz.
 * Caller must ensure PGlite is already initialized (startPglite() has been called).
 */
export async function runBackup(opts: BackupOptions = {}): Promise<BackupResult> {
  const t0 = Date.now();
  const config = readBackupConfig();

  const retainCount = opts.retainCount ?? config.retainCount;
  const backupDir = opts.outPath ? join(opts.outPath, '..') : DEFAULT_BACKUP_DIR;
  const log = opts.quiet ? () => {} : console.log.bind(console);

  // ── Ensure backup directory ───────────────────────────────────────────────
  if (!existsSync(DEFAULT_BACKUP_DIR)) {
    mkdirSync(DEFAULT_BACKUP_DIR, { recursive: true });
    log(`[backup] Created backup directory: ${DEFAULT_BACKUP_DIR}`);
  }

  // ── Compute output path ───────────────────────────────────────────────────
  const ts = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
  const outPath = opts.outPath ?? join(DEFAULT_BACKUP_DIR, `squadboard-${ts}.tar.gz`);

  log(`[backup] Starting PGlite dumpDataDir → ${outPath}`);

  // ── Acquire PGlite instance ───────────────────────────────────────────────
  const { getPglite, startPglite } = await import('../db/pglite.js');
  let pglite = getPglite();
  if (!pglite) {
    // Caller didn't pre-boot; boot it ourselves (e.g. standalone CLI invocation)
    const connStr = await startPglite();
    if (connStr !== 'pglite://local') {
      throw new Error('[backup] DATABASE_URL is set — PGlite backup not applicable in hosted mode');
    }
    const { initDb } = await import('../db/index.js');
    await initDb(connStr);
    pglite = getPglite();
    if (!pglite) throw new Error('[backup] PGlite instance null after start');
  }

  // ── Dump ──────────────────────────────────────────────────────────────────
  // dumpDataDir('gzip') returns a Blob containing a .tar.gz of PGDATA.
  // PGlite flushes to disk, checkpoints, then tars the nodefs data dir.
  const blob = await pglite.dumpDataDir('gzip');
  const arrayBuf = await blob.arrayBuffer();
  const bytes = Buffer.from(arrayBuf);

  writeFileSync(outPath, bytes);
  const sizeBytes = bytes.length;
  log(`[backup] Written ${(sizeBytes / 1024 / 1024).toFixed(2)} MB → ${outPath}`);

  // ── Prune old backups ─────────────────────────────────────────────────────
  const pruned = pruneBackups(DEFAULT_BACKUP_DIR, retainCount);
  if (pruned.length > 0) {
    log(`[backup] Pruned ${pruned.length} old backup(s): ${pruned.join(', ')}`);
  }

  const durationMs = Date.now() - t0;
  log(`[backup] ✅ Done in ${durationMs}ms. Retaining ${retainCount} backups.`);

  return { path: outPath, sizeBytes, pruned, durationMs };
}

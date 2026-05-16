#!/usr/bin/env node
/**
 * packages/server/src/cli/backup.ts
 *
 * CLI surface for `squadboard backup`.
 *
 * When the squadboard server is running (detected via GET /api/health):
 *   → calls POST /api/system/backup (safe — uses the in-process PGlite)
 *
 * When the server is NOT running:
 *   → calls runBackup() directly (boots PGlite from the data directory)
 *
 * Usage:
 *   squadboard backup                      — backup to default path
 *   squadboard backup --out /path/file.tar.gz
 *   squadboard backup --retain 14          — keep 14 backups
 *
 * Config:
 *   ~/.squadboard/config.json { "backup": { "intervalMs": 86400000, "retainCount": 7 } }
 *
 * Exit codes: 0 success, 1 error.
 */
import { fileURLToPath } from 'node:url';
import http from 'node:http';
const SERVER_BASE = 'http://localhost:3000';
const args = process.argv.slice(2);
function getArgValue(flag) {
    const idx = args.indexOf(flag);
    if (idx !== -1 && idx + 1 < args.length)
        return args[idx + 1];
    return undefined;
}
async function isServerRunning() {
    return new Promise((resolve) => {
        const req = http.get(`${SERVER_BASE}/api/health`, { timeout: 1500 }, (res) => {
            resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
    });
}
async function backupViaHttp() {
    return new Promise((resolve, reject) => {
        const req = http.request(`${SERVER_BASE}/api/system/backup`, { method: 'POST', headers: { 'Content-Length': '0' } }, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    if (parsed.ok)
                        resolve(parsed);
                    else
                        reject(new Error(`Server backup failed: ${body}`));
                }
                catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}
async function main() {
    if (args.includes('--help') || args.includes('-h')) {
        printHelp();
        process.exit(0);
    }
    const outPath = getArgValue('--out') ?? getArgValue('-o');
    const retainStr = getArgValue('--retain') ?? getArgValue('-r');
    const retainCount = retainStr ? parseInt(retainStr, 10) : undefined;
    if (retainCount !== undefined && (isNaN(retainCount) || retainCount < 1)) {
        console.error('[backup] --retain must be a positive integer');
        process.exit(1);
    }
    try {
        const serverLive = await isServerRunning();
        if (serverLive && !outPath) {
            // Server is running — delegate to its in-process PGlite (safe)
            console.log(`[backup] Server detected at ${SERVER_BASE} — triggering backup via HTTP`);
            const result = await backupViaHttp();
            console.log(`[backup] Path: ${result.path}`);
            console.log(`[backup] Size: ${result.sizeMB} MB`);
            console.log(`[backup] Duration: ${result.durationMs}ms`);
            if (result.pruned?.length > 0) {
                console.log(`[backup] Pruned: ${result.pruned.length} old backup(s)`);
            }
        }
        else {
            // Server not running (or --out specified) — boot PGlite directly
            if (serverLive && outPath) {
                console.warn('[backup] ⚠️ Server is running but --out is specified — booting PGlite directly.');
                console.warn('[backup]    This is safe only if you know what you are doing.');
            }
            const { runBackup } = await import('../scripts/backup.js');
            const result = await runBackup({ outPath, retainCount });
            console.log(`[backup] Path: ${result.path}`);
            console.log(`[backup] Size: ${(result.sizeBytes / 1024 / 1024).toFixed(2)} MB`);
            console.log(`[backup] Duration: ${result.durationMs}ms`);
            if (result.pruned.length > 0) {
                console.log(`[backup] Pruned: ${result.pruned.length} old backup(s)`);
            }
        }
        process.exit(0);
    }
    catch (err) {
        console.error('[backup] ❌ Backup failed:', err.message);
        process.exit(1);
    }
}
function printHelp() {
    console.log(`
squadboard backup — Backup the live PGlite database cluster

USAGE
  squadboard backup [options]

OPTIONS
  --out PATH     Output file path (default: ~/.squadboard/backups/squadboard-{timestamp}.tar.gz)
  -o PATH        Alias for --out
  --retain N     Keep N most-recent backups in the backup dir (default: config or 7)
  -r N           Alias for --retain
  --help         Show this help

FORMAT
  Uses PGlite's native dumpDataDir('gzip') — produces a portable .tar.gz of the
  PGDATA directory. Restorable via PGlite({ loadDataDir: blob }) or 'squadboard restore'.

  If the server is running, the backup is triggered via POST /api/system/backup
  to avoid opening a second PGlite instance.

CONFIG
  ~/.squadboard/config.json:
    {
      "backup": {
        "intervalMs": 86400000,   // 24h (auto-backup daemon interval)
        "retainCount": 7           // keep 7 daily backups
      }
    }

NOTES
  Backup is safe to run while the server is running — triggered through the server's
  own PGlite instance, which checkpoints and dumps safely.
  The backup file is self-contained and portable.
  Cross-machine restore requires the same PGlite version (@electric-sql/pglite@0.4.5).
`);
}
const thisFile = fileURLToPath(import.meta.url);
const argv1 = process.argv[1] ?? '';
if (argv1 === thisFile || argv1.endsWith('/backup.js') || argv1.endsWith('/backup.ts')) {
    main();
}
export { main as backupCommand };
//# sourceMappingURL=backup.js.map
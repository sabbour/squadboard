/**
 * packages/server/src/daemon/index.ts
 *
 * Main entrypoint for the standalone coordinator daemon.
 *
 * Responsibilities:
 *   - PID file management (one daemon per machine)
 *   - Guard evaluation on every tick (re-checks env, coord.lock, hosted PG, user config)
 *   - Ceremony invocation via invoker.ts (blocks re-entry with isCeremonyRunning flag)
 *   - Optional git push via git-push.ts
 *   - Structured logging to ~/.squadboard/daemon.log (rotated at 10 MB)
 *
 * Exports:
 *   - startDaemon(opts?) — initialize and begin the tick loop
 *   - stopDaemon()       — graceful shutdown
 *   - testTick()         — synchronously fire one tick (for Kujan's tests)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync, unlinkSync, } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { shouldRun, readConfig } from './guards.js';
import { Scheduler } from './scheduler.js';
import { invokeCeremony } from './invoker.js';
import { gitPush } from './git-push.js';
// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const SQUADBOARD_DIR = join(homedir(), '.squadboard');
const PID_FILE = join(SQUADBOARD_DIR, 'daemon.pid');
const LOG_FILE = join(SQUADBOARD_DIR, 'daemon.log');
const LOG_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const DEFAULT_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
// ---------------------------------------------------------------------------
// Daemon state
// ---------------------------------------------------------------------------
let scheduler = null;
let isCeremonyRunning = false;
let lastTickAt = null;
let lastCeremonyResult = null;
let lastGuardResult = null;
let lastBackupAt = null;
let nextBackupAt = new Date(Date.now() + DEFAULT_BACKUP_INTERVAL_MS);
// ---------------------------------------------------------------------------
// PID file helpers
// ---------------------------------------------------------------------------
function ensureSquadboardDir() {
    if (!existsSync(SQUADBOARD_DIR)) {
        mkdirSync(SQUADBOARD_DIR, { recursive: true });
    }
}
function writePidFile() {
    ensureSquadboardDir();
    writeFileSync(PID_FILE, String(process.pid), 'utf-8');
}
function removePidFile() {
    if (existsSync(PID_FILE)) {
        try {
            unlinkSync(PID_FILE);
        }
        catch {
            // best-effort
        }
    }
}
/** Returns the PID in the file, or null if file missing / unreadable. */
function readPidFile() {
    if (!existsSync(PID_FILE))
        return null;
    try {
        const raw = readFileSync(PID_FILE, 'utf-8').trim();
        const pid = parseInt(raw, 10);
        return isNaN(pid) ? null : pid;
    }
    catch {
        return null;
    }
}
/** Returns true if a process with the given PID is alive. */
function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
/** Returns true if a live daemon is already running. */
function isLiveDaemonRunning() {
    const pid = readPidFile();
    if (pid === null)
        return false;
    if (pid === process.pid)
        return false; // we ARE the daemon
    return isProcessAlive(pid);
}
// ---------------------------------------------------------------------------
// Logging (append to ~/.squadboard/daemon.log, rotate at 10 MB)
// ---------------------------------------------------------------------------
function rotateLockIfNeeded() {
    if (!existsSync(LOG_FILE))
        return;
    try {
        const { size } = statSync(LOG_FILE);
        if (size >= LOG_MAX_BYTES) {
            const rotated = `${LOG_FILE}.${Date.now()}.bak`;
            // Rename by overwriting a new file — simple rotation, keep one backup
            const content = readFileSync(LOG_FILE);
            writeFileSync(rotated, content);
            writeFileSync(LOG_FILE, ''); // truncate
            console.log(`[daemon] log rotated → ${rotated}`);
        }
    }
    catch {
        // rotation failure is non-fatal
    }
}
function writeLog(entry) {
    ensureSquadboardDir();
    rotateLockIfNeeded();
    try {
        appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf-8');
    }
    catch {
        // log write failure is non-fatal
    }
}
// ---------------------------------------------------------------------------
// Backup tick — fires when nextBackupAt is past
// ---------------------------------------------------------------------------
async function maybeRunBackup(tickAt) {
    if (tickAt < nextBackupAt)
        return;
    const config = readConfig();
    const intervalMs = config.backup?.intervalMs ?? DEFAULT_BACKUP_INTERVAL_MS;
    const retainCount = config.backup?.retainCount ?? 7;
    console.log('[daemon] backup tick — running scheduled backup');
    try {
        const { runBackup } = await import('../scripts/backup.js');
        const result = await runBackup({ quiet: true, retainCount });
        lastBackupAt = tickAt;
        nextBackupAt = new Date(tickAt.getTime() + intervalMs);
        const logEntry = {
            level: 'info',
            type: 'daemon.backup',
            tick: tickAt.toISOString(),
            path: result.path,
            sizeBytes: result.sizeBytes,
            durationMs: result.durationMs,
            pruned: result.pruned,
            nextBackupAt: nextBackupAt.toISOString(),
        };
        console.log(`[daemon] backup ✅ ${result.path} (${(result.sizeBytes / 1024 / 1024).toFixed(2)} MB)`);
        writeLog(logEntry);
    }
    catch (err) {
        const errMsg = err.message;
        console.error('[daemon] backup ❌', errMsg);
        // Still advance nextBackupAt so we retry next interval rather than every tick
        nextBackupAt = new Date(tickAt.getTime() + intervalMs);
        writeLog({ level: 'error', type: 'daemon.backup', tick: tickAt.toISOString(), error: errMsg });
    }
}
// ---------------------------------------------------------------------------
// Single tick execution
// ---------------------------------------------------------------------------
async function executeTick() {
    const tickAt = new Date();
    lastTickAt = tickAt;
    // Re-evaluate guards on every tick
    const guardResult = shouldRun();
    lastGuardResult = guardResult;
    if (!guardResult.allowed) {
        const logEntry = {
            level: 'info',
            type: 'daemon.idle',
            tick: tickAt.toISOString(),
            reason: guardResult.reason,
            guards: guardResult.guards,
        };
        console.log(`[daemon] tick at ${tickAt.toISOString()} — idle: ${guardResult.reason}`);
        writeLog(logEntry);
        return;
    }
    // Concurrency guard — don't fire a second ceremony while one is running
    if (isCeremonyRunning) {
        const logEntry = {
            level: 'warn',
            type: 'daemon.skipped',
            tick: tickAt.toISOString(),
            reason: 'previous ceremony still running',
        };
        console.warn('[daemon] tick skipped — ceremony already in progress');
        writeLog(logEntry);
        return;
    }
    isCeremonyRunning = true;
    let ceremonyResult = null;
    let pushResult = null;
    try {
        console.log(`[daemon] tick at ${tickAt.toISOString()} — running ceremony scribe-close-out`);
        ceremonyResult = await invokeCeremony();
        lastCeremonyResult = ceremonyResult;
        pushResult = await gitPush();
    }
    finally {
        isCeremonyRunning = false;
    }
    const logEntry = {
        level: ceremonyResult?.error ? 'error' : 'info',
        type: 'daemon.tick',
        tick: tickAt.toISOString(),
        guards: guardResult.guards,
        ceremony: {
            id: ceremonyResult?.ceremonyId ?? 'scribe-close-out',
            result: ceremonyResult?.result,
            durationMs: ceremonyResult?.durationMs,
            error: ceremonyResult?.error,
        },
        push: pushResult
            ? {
                attempted: pushResult.attempted,
                success: pushResult.success,
                skippedReason: pushResult.skippedReason,
                error: pushResult.error,
            }
            : null,
    };
    console.log(`[daemon] tick at ${tickAt.toISOString()}, guards: ${JSON.stringify(guardResult.guards)}, ` +
        `ceremony: { id: 'scribe-close-out', result: ${JSON.stringify(ceremonyResult?.result)} }`);
    writeLog(logEntry);
    // ── Backup tick (independent of ceremony result) ──────────────────────────
    await maybeRunBackup(tickAt);
}
export function getDaemonStatus() {
    return {
        pid: process.pid,
        lastTickAt: lastTickAt?.toISOString() ?? null,
        nextTickAt: scheduler?.nextTickAt?.toISOString() ?? null,
        lastCeremonyResult,
        guards: lastGuardResult,
        backup: {
            lastBackupAt: lastBackupAt?.toISOString() ?? null,
            nextBackupAt: nextBackupAt.toISOString(),
        },
    };
}
export function startDaemon(opts = {}) {
    // Guard: refuse if a live daemon is already running
    if (isLiveDaemonRunning()) {
        const pid = readPidFile();
        console.error(`[daemon] refusing to start — a daemon is already running (PID ${pid}). ` +
            `Run 'squadboard daemon stop' first.`);
        process.exit(1);
    }
    // Check guards before starting (advisory — daemon will also check on each tick)
    const initial = shouldRun();
    if (!initial.allowed) {
        console.log(`[daemon] starting in idle mode — ${initial.reason}`);
    }
    else {
        console.log('[daemon] starting — all guards passed');
    }
    writePidFile();
    console.log(`[daemon] PID ${process.pid} written to ${PID_FILE}`);
    scheduler = new Scheduler();
    scheduler.on('tick', () => {
        executeTick().catch((err) => {
            console.error('[daemon] unhandled tick error:', err);
            isCeremonyRunning = false;
        });
    });
    scheduler.start();
    if (opts.tickImmediately) {
        executeTick().catch((err) => {
            console.error('[daemon] unhandled immediate tick error:', err);
            isCeremonyRunning = false;
        });
    }
    // Register cleanup on exit
    process.on('exit', () => removePidFile());
    process.on('SIGINT', () => { stopDaemon(); process.exit(0); });
    process.on('SIGTERM', () => { stopDaemon(); process.exit(0); });
}
export function stopDaemon() {
    if (scheduler) {
        scheduler.stop();
        scheduler = null;
    }
    removePidFile();
    console.log('[daemon] stopped');
}
// ---------------------------------------------------------------------------
// testTick — synchronous hook for Kujan's test suite
// ---------------------------------------------------------------------------
/**
 * Fire one tick synchronously (awaited) without waiting for the real timer.
 * The scheduler need not be running. Guards are still evaluated.
 * isCeremonyRunning is still respected to mirror production behaviour.
 */
export async function testTick() {
    await executeTick();
}
//# sourceMappingURL=index.js.map
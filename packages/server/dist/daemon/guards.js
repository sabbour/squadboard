/**
 * packages/server/src/daemon/guards.ts
 *
 * Detection guards for the standalone coordinator daemon.
 * Each guard returns { allowed: boolean, reason?: string }.
 * shouldRun() composes all guards — daemon ticks only when all pass.
 *
 * Guards are re-evaluated on every tick, not just at startup. A CLI session
 * that starts mid-daemon will cause the daemon to go idle gracefully.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const SQUADBOARD_DIR = join(homedir(), '.squadboard');
const COORD_LOCK = join(SQUADBOARD_DIR, 'coord.lock');
const CONFIG_FILE = join(SQUADBOARD_DIR, 'config.json');
const CLI_HEARTBEAT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
export function readConfig() {
    try {
        if (!existsSync(CONFIG_FILE))
            return {};
        const raw = readFileSync(CONFIG_FILE, 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
}
// ---------------------------------------------------------------------------
// Guard: SQUADBOARD_COORDINATOR=cli env var
// ---------------------------------------------------------------------------
export function guardEnvCli() {
    if (process.env.SQUADBOARD_COORDINATOR === 'cli') {
        return {
            allowed: false,
            reason: 'CLI coordinator mode detected via env; daemon idle',
        };
    }
    return { allowed: true };
}
// ---------------------------------------------------------------------------
// Guard: CLI coordinator heartbeat — coord.lock modified within 5 minutes
// ---------------------------------------------------------------------------
export function guardCoordLock() {
    if (!existsSync(COORD_LOCK))
        return { allowed: true };
    try {
        const stat = statSync(COORD_LOCK);
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs < CLI_HEARTBEAT_WINDOW_MS) {
            return {
                allowed: false,
                reason: `CLI coordinator heartbeat detected (coord.lock modified ${Math.round(ageMs / 1000)}s ago); daemon idle`,
            };
        }
    }
    catch {
        // If stat fails, treat lock as stale — allow daemon to run
    }
    return { allowed: true };
}
// ---------------------------------------------------------------------------
// Guard: DATABASE_URL points to hosted (non-local) PG
// ---------------------------------------------------------------------------
const LOCAL_PG_PREFIXES = [
    'postgresql://localhost',
    'postgres://localhost',
    'postgresql://127.0.0.1',
    'postgres://127.0.0.1',
];
export function guardHostedPg() {
    const url = process.env.DATABASE_URL;
    if (!url)
        return { allowed: true }; // no URL → PGlite, definitely local
    if (url.includes('pglite'))
        return { allowed: true };
    const isLocal = LOCAL_PG_PREFIXES.some((prefix) => url.startsWith(prefix));
    if (!isLocal) {
        return {
            allowed: false,
            reason: 'Hosted PG mode detected via DATABASE_URL; daemon idle',
        };
    }
    return { allowed: true };
}
// ---------------------------------------------------------------------------
// Guard: User disabled the daemon via config
// ---------------------------------------------------------------------------
export function guardUserEnabled() {
    const config = readConfig();
    if (config.daemon?.enabled === false) {
        return {
            allowed: false,
            reason: 'Daemon disabled by user config (~/.squadboard/config.json); daemon idle',
        };
    }
    return { allowed: true };
}
export function shouldRun() {
    const envCli = guardEnvCli();
    const coordLock = guardCoordLock();
    const hostedPg = guardHostedPg();
    const userEnabled = guardUserEnabled();
    const guards = { envCli, coordLock, hostedPg, userEnabled };
    const blocking = [envCli, coordLock, hostedPg, userEnabled].find((g) => !g.allowed);
    return {
        allowed: !blocking,
        guards,
        reason: blocking?.reason,
    };
}
//# sourceMappingURL=guards.js.map
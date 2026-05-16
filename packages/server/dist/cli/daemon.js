#!/usr/bin/env node
/**
 * packages/server/src/cli/daemon.ts
 *
 * CLI commands for managing the standalone coordinator daemon.
 *
 * Commands:
 *   squadboard daemon start      — spawn daemon (detached), write PID
 *   squadboard daemon stop       — kill daemon by PID file
 *   squadboard daemon status     — report PID, last tick, next tick, guard state
 *   squadboard daemon disable    — write config flag; daemon exits on next tick
 *   squadboard daemon enable     — undo disable
 *   squadboard daemon run-once   — fire ceremony immediately (no scheduling)
 *
 * Invoked via: node dist/cli/daemon.js <subcommand>
 * Or during development: tsx src/cli/daemon.ts <subcommand>
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { shouldRun } from '../daemon/guards.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const SQUADBOARD_DIR = join(homedir(), '.squadboard');
const PID_FILE = join(SQUADBOARD_DIR, 'daemon.pid');
const LOG_FILE = join(SQUADBOARD_DIR, 'daemon.log');
const CONFIG_FILE = join(SQUADBOARD_DIR, 'config.json');
function ensureDir() {
    if (!existsSync(SQUADBOARD_DIR))
        mkdirSync(SQUADBOARD_DIR, { recursive: true });
}
// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------
function readConfigRaw() {
    if (!existsSync(CONFIG_FILE))
        return {};
    try {
        return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
    }
    catch {
        return {};
    }
}
function writeConfigRaw(cfg) {
    ensureDir();
    writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
}
function mergeConfig(patch) {
    const current = readConfigRaw();
    const merged = deepMerge(current, patch);
    writeConfigRaw(merged);
}
function deepMerge(target, source) {
    const out = { ...target };
    for (const [k, v] of Object.entries(source)) {
        if (v !== null &&
            typeof v === 'object' &&
            !Array.isArray(v) &&
            typeof out[k] === 'object' &&
            out[k] !== null &&
            !Array.isArray(out[k])) {
            out[k] = deepMerge(out[k], v);
        }
        else {
            out[k] = v;
        }
    }
    return out;
}
// ---------------------------------------------------------------------------
// PID helpers
// ---------------------------------------------------------------------------
function readPid() {
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
function isAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
// ---------------------------------------------------------------------------
// Command: start
// ---------------------------------------------------------------------------
async function cmdStart() {
    const pid = readPid();
    if (pid !== null && isAlive(pid)) {
        console.log(`[daemon] already running (PID ${pid})`);
        return;
    }
    const guards = shouldRun();
    if (!guards.allowed) {
        console.log(`[daemon] guards prevent daemon from running: ${guards.reason}`);
        console.log('[daemon] daemon will start but remain idle until guards clear');
    }
    // Resolve the daemon entry point — works for both dist/ (production) and
    // src/ (tsx dev) layouts.
    const daemonEntry = join(__dirname, '..', 'daemon', 'process.js');
    const daemonEntrySrc = join(__dirname, '..', 'daemon', 'process.ts');
    const isTsx = process.argv[0]?.includes('tsx') || process.execArgv.some((a) => a.includes('tsx'));
    const entryPath = isTsx ? daemonEntrySrc : daemonEntry;
    const cmd = isTsx ? 'tsx' : process.execPath;
    const args = isTsx ? [entryPath] : [entryPath];
    ensureDir();
    const child = spawn(cmd, args, {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
        env: { ...process.env },
    });
    child.unref();
    // The child will write its own PID file. Give it a moment then verify.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const newPid = readPid();
    if (newPid && isAlive(newPid)) {
        console.log(`[daemon] started — PID ${newPid}`);
    }
    else {
        console.log(`[daemon] spawned (PID file not yet written — daemon may still be initializing)`);
    }
}
// ---------------------------------------------------------------------------
// Command: stop
// ---------------------------------------------------------------------------
function cmdStop() {
    const pid = readPid();
    if (pid === null) {
        console.log('[daemon] no daemon PID file found — nothing to stop');
        return;
    }
    if (!isAlive(pid)) {
        console.log(`[daemon] PID ${pid} is not running — cleaning up stale PID file`);
        try {
            unlinkSync(PID_FILE);
        }
        catch { /* best-effort */ }
        return;
    }
    try {
        process.kill(pid, 'SIGTERM');
        console.log(`[daemon] sent SIGTERM to PID ${pid}`);
    }
    catch (err) {
        console.error(`[daemon] failed to send SIGTERM to PID ${pid}:`, err);
    }
}
// ---------------------------------------------------------------------------
// Command: status
// ---------------------------------------------------------------------------
function cmdStatus() {
    const pid = readPid();
    const running = pid !== null && isAlive(pid);
    const guards = shouldRun();
    console.log('[daemon] status:');
    console.log(`  running:     ${running}`);
    console.log(`  pid:         ${pid ?? 'none'}`);
    console.log(`  log:         ${LOG_FILE}`);
    console.log(`  guards:`);
    console.log(`    envCli:    ${JSON.stringify(guards.guards.envCli)}`);
    console.log(`    coordLock: ${JSON.stringify(guards.guards.coordLock)}`);
    console.log(`    hostedPg:  ${JSON.stringify(guards.guards.hostedPg)}`);
    console.log(`    userEnabled: ${JSON.stringify(guards.guards.userEnabled)}`);
    console.log(`  would run:   ${guards.allowed}`);
    if (!guards.allowed) {
        console.log(`  idle reason: ${guards.reason}`);
    }
}
// ---------------------------------------------------------------------------
// Command: disable
// ---------------------------------------------------------------------------
function cmdDisable() {
    mergeConfig({ daemon: { enabled: false } });
    console.log('[daemon] disabled — running daemon will pick this up on its next tick and exit');
    console.log(`[daemon] config written to ${CONFIG_FILE}`);
}
// ---------------------------------------------------------------------------
// Command: enable
// ---------------------------------------------------------------------------
function cmdEnable() {
    mergeConfig({ daemon: { enabled: true } });
    console.log('[daemon] enabled — run "squadboard daemon start" to start the daemon');
    console.log(`[daemon] config written to ${CONFIG_FILE}`);
}
// ---------------------------------------------------------------------------
// Command: run-once
// ---------------------------------------------------------------------------
async function cmdRunOnce() {
    const guards = shouldRun();
    if (!guards.allowed) {
        console.log(`[daemon] guards active: ${guards.reason}`);
        console.log('[daemon] run-once bypasses scheduling but NOT guards. Use --force to override (not recommended).');
        // Intentionally still block — the guard semantics should be respected even
        // for manual invocations, unless the user explicitly wants to override.
        // A future --force flag can be added here.
        process.exit(1);
    }
    console.log('[daemon] run-once — invoking ceremony scribe-close-out immediately');
    const { testTick } = await import('../daemon/index.js');
    await testTick();
    console.log('[daemon] run-once complete');
}
// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------
const subcommand = process.argv[2];
switch (subcommand) {
    case 'start':
        await cmdStart();
        break;
    case 'stop':
        cmdStop();
        break;
    case 'status':
        cmdStatus();
        break;
    case 'disable':
        cmdDisable();
        break;
    case 'enable':
        cmdEnable();
        break;
    case 'run-once':
        await cmdRunOnce();
        break;
    default:
        console.log(`Usage: squadboard daemon <subcommand>

Subcommands:
  start      Spawn the daemon process (detached). Writes PID to ~/.squadboard/daemon.pid
  stop       Kill the daemon by reading the PID file
  status     Report PID, guard state, last tick, next tick
  disable    Write config flag; running daemon will exit on next tick
  enable     Undo disable
  run-once   Fire the ceremony immediately without scheduling (manual override)
`);
        process.exit(1);
}
//# sourceMappingURL=daemon.js.map
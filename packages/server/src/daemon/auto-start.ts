/**
 * packages/server/src/daemon/auto-start.ts
 *
 * Called from server/src/index.ts at startup.
 * Forks the daemon as a detached subprocess when:
 *   - No live daemon PID is present
 *   - All detection guards pass (shouldRun() returns allowed)
 *   - ~/.squadboard/config.json does NOT have { daemon: { autoStart: false } }
 *
 * Non-blocking by design — server startup is not gated on the daemon.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { shouldRun, readConfig } from './guards.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SQUADBOARD_DIR = join(homedir(), '.squadboard');
const PID_FILE = join(SQUADBOARD_DIR, 'daemon.pid');

function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  try {
    const raw = readFileSync(PID_FILE, 'utf-8').trim();
    const pid = parseInt(raw, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isAutoStartDisabled(): boolean {
  const config = readConfig();
  return config.daemon?.autoStart === false;
}

export function maybeAutoStartDaemon(): void {
  // Check config gate first — cheapest check
  if (isAutoStartDisabled()) {
    console.log('[squadboard:daemon] auto-start skipped — autoStart:false in config');
    return;
  }

  // Check for live daemon
  const pid = readPid();
  if (pid !== null && isAlive(pid)) {
    console.log(`[squadboard:daemon] daemon already running (PID ${pid}) — skipping auto-start`);
    return;
  }

  // Evaluate guards
  const guards = shouldRun();
  if (!guards.allowed) {
    console.log(`[squadboard:daemon] auto-start skipped — ${guards.reason}`);
    return;
  }

  // Fork the daemon process entry point
  const processEntry = join(__dirname, 'process.js');
  const processEntrySrc = join(__dirname, 'process.ts');

  // Detect tsx dev mode vs compiled JS
  const isTsx =
    process.argv[1]?.includes('tsx') ||
    process.execArgv.some((a) => a.includes('tsx')) ||
    !existsSync(processEntry);

  const cmd = isTsx ? 'tsx' : process.execPath;
  const args = isTsx ? [processEntrySrc] : [processEntry];

  try {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'],
      env: { ...process.env },
    });
    child.unref();
    console.log('[squadboard:daemon] auto-started coordinator daemon (detached)');
  } catch (err) {
    // Auto-start failure is non-fatal — server continues
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[squadboard:daemon] auto-start failed (non-fatal):', msg);
  }
}

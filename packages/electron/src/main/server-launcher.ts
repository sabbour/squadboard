/**
 * Server launcher — OUT-OF-PROCESS design.
 *
 * ## Decision: Out-of-process (not in-process)
 *
 * The squadboard server (`packages/server/src/index.ts`) is NOT designed for
 * in-process embedding:
 *   - Its `main()` function registers its own `process.on('SIGINT/SIGTERM')`
 *     handlers that call `process.exit()`, which would terminate Electron.
 *   - It starts PGlite (file-system state), Express, and WebSockets — all
 *     tightly coupled to a single Node.js process lifetime.
 *
 * **Out-of-process** (chosen for L2):
 *   ✅ Clean crash isolation: server crash doesn't kill the UI
 *   ✅ No signal-handler conflicts
 *   ✅ Natural fit for L4 (bundled PG) — just swap the binary
 *   ✅ MCP child processes (L5) naturally extend this pattern
 *   ⚠️  Slightly more startup overhead (~100 ms on cold start)
 *   ⚠️  Needs IPC or HTTP to communicate (we already use HTTP/WS)
 *
 * **In-process** (rejected for L2):
 *   ✅ Simpler bundling
 *   ❌ process.exit() calls from server kill Electron
 *   ❌ Signal handler conflicts
 *   ❌ Harder to isolate crashes
 *
 * L4/L5/L6 may revisit once embedded PG is in place. The interface here
 * (start/stop functions returning a Promise) is stable regardless of choice.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let serverProcess: ChildProcess | null = null;
let startResolve: (() => void) | null = null;

/** Port the embedded server listens on. */
export const SERVER_PORT = 3000;

/** Read the MCP config written by `mcp.setDefaultProject` IPC handler. */
function readElectronMcpConfig(): { defaultProjectId?: string } {
  try {
    const configPath = join(app.getPath('userData'), 'squadboard-mcp-config.json');
    const raw = readFileSync(configPath, 'utf8');
    return JSON.parse(raw) as { defaultProjectId?: string };
  } catch {
    return {};
  }
}

function resolveServerPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'server', 'dist', 'index.js');
  }

  const repoRoot = join(__dirname, '..', '..', '..', '..');
  return join(repoRoot, 'packages', 'server', 'dist', 'index.js');
}

function spawnServerProcess(
  serverPath: string,
  resolve: () => void,
  reject: (err: Error) => void,
): void {
  if (!existsSync(serverPath)) {
    console.warn(
      `[server-launcher] server not built at ${serverPath} — skipping launch.\n` +
        `Run: pnpm --filter @sabbour/squadboard build`,
    );
    resolve();
    return;
  }

  console.log(`[server-launcher] spawning server → ${serverPath}`);

  const mcpConfig = readElectronMcpConfig();

  serverProcess = spawn(process.execPath, [serverPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: app.isPackaged ? 'production' : 'development',
      PORT: String(SERVER_PORT),
      ...(mcpConfig.defaultProjectId
        ? { SQUADBOARD_DEFAULT_PROJECT_ID: mcpConfig.defaultProjectId }
        : {}),
    },
    detached: false,
  });

  startResolve = resolve;

  serverProcess.stdout?.on('data', (chunk: Buffer) => {
    const line = chunk.toString();
    process.stdout.write(`[server] ${line}`);
    if (startResolve && line.includes('ready in')) {
      startResolve();
      startResolve = null;
    }
  });

  serverProcess.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[server:err] ${chunk.toString()}`);
  });

  serverProcess.on('error', (err) => {
    console.error('[server-launcher] spawn error:', err);
    reject(err);
  });

  serverProcess.on('exit', (code, signal) => {
    console.log(`[server-launcher] server exited code=${code} signal=${signal}`);
    serverProcess = null;
    if (startResolve) {
      startResolve = null;
      reject(new Error(`server exited before ready: code=${code}`));
    }
  });

  setTimeout(() => {
    if (startResolve) {
      console.warn('[server-launcher] ready timeout — proceeding anyway');
      startResolve();
      startResolve = null;
    }
  }, 10_000);
}

function startDevServer(resolve: () => void, reject: (err: Error) => void): void {
  const repoRoot = join(__dirname, '..', '..', '..', '..');
  const serverPath = join(repoRoot, 'packages', 'server', 'dist', 'index.js');

  if (!existsSync(serverPath)) {
    console.warn(
      `[server-launcher] dev: server not built at ${serverPath} — UI will try connecting anyway.\n` +
        `Run: pnpm --filter @sabbour/squadboard build`,
    );
    resolve();
    return;
  }

  spawnServerProcess(serverPath, resolve, reject);
}

function tryConnectOrStart(): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ port: SERVER_PORT, host: 'localhost' });
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      callback();
    };

    socket.setTimeout(1_000, () => {
      finish(() => {
        console.log('[server-launcher] dev: server probe timed out, starting it...');
        startDevServer(resolve, reject);
      });
    });

    socket.once('connect', () => {
      finish(() => {
        console.log('[server-launcher] dev: server already running on port', SERVER_PORT);
        resolve();
      });
    });

    socket.once('error', () => {
      finish(() => {
        console.log('[server-launcher] dev: server not found, starting it...');
        startDevServer(resolve, reject);
      });
    });
  });
}

export function startServer(): Promise<void> {
  if (!app.isPackaged) {
    return tryConnectOrStart();
  }

  return new Promise((resolve, reject) => {
    const serverPath = resolveServerPath();
    spawnServerProcess(serverPath, resolve, reject);
  });
}

/**
 * Stop the server child process gracefully.
 *
 * Sends SIGTERM and waits up to 5 s for clean exit before SIGKILL.
 */
export function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!serverProcess) {
      resolve();
      return;
    }

    const proc = serverProcess;
    serverProcess = null;

    const forceKill = setTimeout(() => {
      console.warn('[server-launcher] force-killing server after timeout');
      proc.kill('SIGKILL');
    }, 5_000);

    proc.on('exit', () => {
      clearTimeout(forceKill);
      resolve();
    });

    proc.kill('SIGTERM');
  });
}

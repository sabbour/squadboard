#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface CliOptions {
  printMcpConfig: boolean;
  noElectron: boolean;
  squadStorageProvider?: string;
}

interface WriteResult {
  path: string;
  status: 'created' | 'updated';
}

interface AgentHintsResult {
  path: string;
  status: 'updated' | 'already_present' | 'missing_file';
}

interface DiagnosticRow {
  label: string;
  ok: boolean;
  value: string;
}

const HINT_LINE = '- `squadboard_*` → Squadboard (ceremonies, workflows, issues, agents, durable state)';
const CEREMONY_DELEGATION = `
#### Squadboard Ceremony Delegation

When \`.squad/ceremonies.md\` lists a ceremony with a Squadboard workflow hint, prefer delegation over local execution:

1. **Squadboard MCP available + ceremony has a workflow slug** → call \`squadboard_run_agent("<slug>")\` — Squadboard owns the run (tracked in DB, visible in UI, resumable).
2. **No Squadboard MCP or no slug** → spawn a local facilitator agent as normal (Squad CLI native fallback).

Never run a ceremony both locally AND via \`squadboard_run_agent\` for the same trigger event. The delegation check is the gate — at most one executor.
`.trim();

function buildMcpServerConfig(squadStorageProvider = 'postgresql'): Record<string, unknown> {
  return {
    command: 'squadboard',
    args: ['mcp'],
    env: {
      SQUADBOARD_SQUAD_STORAGE_PROVIDER: squadStorageProvider,
    },
  };
}

function buildMcpConfig(squadStorageProvider = 'postgresql'): string {
  return JSON.stringify({
    mcpServers: {
      squadboard: buildMcpServerConfig(squadStorageProvider),
    },
  }, null, 2);
}

const USAGE = `
Squadboard CLI v0.1.0

Usage:
  squadboard init     [--squad-storage postgresql|fs] [--print-mcp-config] [--no-electron]
                      Start the Squadboard server and open the UI
  squadboard mcp      [--squad-storage postgresql|fs] [--print-mcp-config]
                      Start the MCP server (stdio) for Copilot CLI / VS Code
  squadboard connect  [--squad-storage postgresql|fs]
                      Merge .mcp.json and inject squad.agent.md hints
  squadboard diagnose
                      Check local server, MCP config, agent hints, and Electron setup

Storage:
  postgresql        Default. Store Squad state in Squadboard's PostgreSQL DB
                    (local PGlite unless DATABASE_URL points to PostgreSQL).
  fs                Fallback. Store Squad state in repository .squad/ files.

Config:
  --print-mcp-config  Print a Copilot CLI MCP config block and exit.
  --no-electron       Force browser launch for \`squadboard init\`.

MCP setup:
  Run \`squadboard connect\` to configure .mcp.json and squad.agent.md hints.
`.trim();

const [, , command, ...args] = process.argv;
const VALID_COMMANDS = new Set(['init', 'mcp', 'connect', 'diagnose']);

if (!command || command === '--help' || command === '-h') {
  console.log(USAGE);
  process.exit(command ? 0 : 1);
}

if (!VALID_COMMANDS.has(command)) {
  console.error(`Unknown command: ${command}`);
  console.error('Run `squadboard --help` for usage.');
  process.exit(1);
}

function parseOptions(rawArgs: string[]): CliOptions {
  const options: CliOptions = { printMcpConfig: false, noElectron: false };

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];

    if (arg === '--print-mcp-config') {
      options.printMcpConfig = true;
      continue;
    }

    if (arg === '--no-electron') {
      options.noElectron = true;
      continue;
    }

    if (arg.startsWith('--squad-storage=')) {
      options.squadStorageProvider = arg.slice('--squad-storage='.length);
      continue;
    }

    if (arg === '--squad-storage') {
      const value = rawArgs[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --squad-storage. Use "postgresql" or "fs".');
      }
      options.squadStorageProvider = value;
      i++;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function normalizeSquadStorageProvider(value: string | undefined): string {
  const provider = value?.trim().toLowerCase();
  if (!provider) return 'postgresql';
  if (provider === 'postgresql' || provider === 'fs') return provider;
  throw new Error(`Unsupported Squad storage provider "${provider}". Use "postgresql" or "fs".`);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function writeMcpConfigFile(squadStorageProvider: string): Promise<WriteResult> {
  const configPath = join(process.cwd(), '.mcp.json');
  const status: WriteResult['status'] = existsSync(configPath) ? 'updated' : 'created';
  let config: Record<string, unknown> = {};

  if (existsSync(configPath)) {
    const parsed = JSON.parse(await readFile(configPath, 'utf8')) as unknown;
    if (!isJsonObject(parsed)) {
      throw new Error(`${configPath} must contain a JSON object.`);
    }
    config = parsed;
  }

  const existingServers = config.mcpServers;
  const mcpServers = isJsonObject(existingServers) ? existingServers : {};
  config.mcpServers = {
    ...mcpServers,
    squadboard: buildMcpServerConfig(squadStorageProvider),
  };

  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return { path: configPath, status };
}

async function injectSquadAgentHints(): Promise<AgentHintsResult> {
  const agentPath = join(process.cwd(), '.github', 'agents', 'squad.agent.md');

  let content: string;
  try {
    content = await readFile(agentPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { path: agentPath, status: 'missing_file' };
    }
    throw err;
  }

  if (content.includes('squadboard_*')) {
    return { path: agentPath, status: 'already_present' };
  }

  const githubMcpLine = '- `github-mcp-server-*`';
  const detectionHeading = '#### Detection';
  let patched: string;

  if (content.includes(githubMcpLine)) {
    patched = content.replace(githubMcpLine, `${HINT_LINE}\n${githubMcpLine}`);
  } else if (content.includes(detectionHeading)) {
    patched = content.replace(detectionHeading, `${detectionHeading}\n\n${HINT_LINE}`);
  } else {
    patched = `${content.trimEnd()}\n\n#### Squadboard MCP\n\n${HINT_LINE}\n\n${CEREMONY_DELEGATION}\n`;
  }

  if (!patched.includes('squadboard_run_agent') && !patched.includes('Squadboard Ceremony Delegation')) {
    patched = `${patched.trimEnd()}\n\n${CEREMONY_DELEGATION}\n`;
  }

  await writeFile(agentPath, patched, 'utf8');
  return { path: agentPath, status: 'updated' };
}

function findMonorepoRoot(startDir: string): string | null {
  let current = startDir;

  while (true) {
    const packageJsonPath = join(current, 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: string };
        if (parsed.name?.includes('squadboard-monorepo')) {
          return current;
        }
      } catch {
        // Ignore parse failures and keep walking upward.
      }
    }

    if (existsSync(join(current, 'packages', 'electron', 'dist', 'main', 'index.js'))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function findElectronMainPath(repoRoot: string): string | null {
  const candidate = join(repoRoot, 'packages', 'electron', 'dist', 'main', 'index.js');
  return existsSync(candidate) ? candidate : null;
}

function hasElectronBinary(repoRoot: string): boolean {
  const localElectron = join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
  if (existsSync(localElectron)) {
    return true;
  }

  const locator = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(locator, ['electron'], { stdio: 'ignore' }).status === 0;
}

function launchElectronApp(): { launched: boolean; reason?: string; electronMainPath?: string } {
  if (process.env.SQUADBOARD_NO_ELECTRON) {
    return { launched: false, reason: 'disabled by SQUADBOARD_NO_ELECTRON' };
  }

  const repoRoot = findMonorepoRoot(__dirname);
  if (!repoRoot) {
    return { launched: false, reason: 'repo root not found from CLI install' };
  }

  const electronMainPath = findElectronMainPath(repoRoot);
  if (!electronMainPath) {
    return { launched: false, reason: 'packages/electron/dist/main/index.js not found' };
  }

  if (!hasElectronBinary(repoRoot)) {
    return { launched: false, reason: 'electron binary not found' };
  }

  try {
    const child = spawn('npx', ['electron', electronMainPath], {
      cwd: repoRoot,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: process.env,
    });
    child.unref();
    return { launched: true, electronMainPath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { launched: false, reason: `spawn failed: ${message}` };
  }
}

function checkPortListening(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: 'localhost' });
    let settled = false;

    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function findElectronAppFromCwd(): string | null {
  const repoRoot = findMonorepoRoot(process.cwd());
  const devBuild = repoRoot ? findElectronMainPath(repoRoot) : null;
  if (devBuild) {
    return devBuild;
  }

  const home = homedir();
  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/Squadboard.app',
        join(home, 'Applications', 'Squadboard.app'),
      ]
    : process.platform === 'win32'
      ? [
          join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Squadboard', 'Squadboard.exe'),
          'C:\\Program Files\\Squadboard\\Squadboard.exe',
          'C:\\Program Files (x86)\\Squadboard\\Squadboard.exe',
        ]
      : [
          join(home, 'Applications', 'Squadboard.AppImage'),
          '/opt/Squadboard/squadboard',
          '/usr/local/bin/squadboard',
        ];

  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;
}

function formatDiagnosticsTable(rows: DiagnosticRow[]): void {
  const labelWidth = Math.max(...rows.map((row) => row.label.length), 24);
  console.log('Squadboard Diagnostics');
  console.log('─────────────────────────────────────────');
  for (const row of rows) {
    const icon = row.ok ? '✓' : '✗';
    console.log(`  ${row.label.padEnd(labelWidth)} ${icon} ${row.value}`);
  }
  console.log('─────────────────────────────────────────');
  console.log('Run `squadboard connect` to set up MCP and agent hints.');
}

function readDbStatus(payload: Record<string, unknown>): string {
  const direct = payload.dbStatus;
  if (typeof direct === 'string' && direct.trim()) {
    return direct;
  }

  const database = payload.database;
  if (isJsonObject(database) && typeof database.status === 'string' && database.status.trim()) {
    return database.status;
  }

  return 'unknown';
}

async function getServerDiagnosticRow(): Promise<DiagnosticRow> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_500);

  try {
    const response = await fetch(`${URL}/api/health`, { signal: controller.signal });
    const payload = (await response.json()) as unknown;
    if (!isJsonObject(payload)) {
      return {
        label: `Server (localhost:${PORT})`,
        ok: false,
        value: `unexpected response (HTTP ${response.status})`,
      };
    }

    const version = typeof payload.version === 'string' ? `v${payload.version}` : 'unknown version';
    const status = typeof payload.status === 'string' ? payload.status : 'unknown';
    const dbStatus = readDbStatus(payload);
    const recoveryWarning = typeof payload.recoveryWarning === 'string' && payload.recoveryWarning.trim()
      ? `, recovery ${payload.recoveryWarning.trim()}`
      : '';

    return {
      label: `Server (localhost:${PORT})`,
      ok: response.ok,
      value: response.ok
        ? `running (${version}, status ${status}, db ${dbStatus}${recoveryWarning})`
        : `unhealthy (HTTP ${response.status}, status ${status}, db ${dbStatus}${recoveryWarning})`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      label: `Server (localhost:${PORT})`,
      ok: false,
      value: `unreachable — ${message}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function getMcpConfigDiagnosticRow(): Promise<DiagnosticRow> {
  const configPath = join(process.cwd(), '.mcp.json');
  if (!existsSync(configPath)) {
    return { label: 'MCP config (.mcp.json)', ok: false, value: 'missing' };
  }

  try {
    const parsed = JSON.parse(await readFile(configPath, 'utf8')) as unknown;
    const configured = isJsonObject(parsed)
      && isJsonObject(parsed.mcpServers)
      && isJsonObject(parsed.mcpServers.squadboard);
    return {
      label: 'MCP config (.mcp.json)',
      ok: configured,
      value: configured ? 'configured' : 'missing squadboard entry',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { label: 'MCP config (.mcp.json)', ok: false, value: `invalid JSON — ${message}` };
  }
}

async function getAgentHintsDiagnosticRow(): Promise<DiagnosticRow> {
  const agentPath = join(process.cwd(), '.github', 'agents', 'squad.agent.md');
  if (!existsSync(agentPath)) {
    return { label: 'squad.agent.md hints', ok: false, value: 'missing file' };
  }

  const content = await readFile(agentPath, 'utf8');
  return content.includes('squadboard_*')
    ? { label: 'squad.agent.md hints', ok: true, value: 'injected' }
    : { label: 'squad.agent.md hints', ok: false, value: 'not injected — run: squadboard connect' };
}

function getElectronDiagnosticRow(): DiagnosticRow {
  const electronAppPath = findElectronAppFromCwd();
  return electronAppPath
    ? { label: 'Electron app', ok: true, value: `found at ${electronAppPath}` }
    : { label: 'Electron app', ok: false, value: 'not found in dev build or common install paths' };
}

async function getPortDiagnosticRow(): Promise<DiagnosticRow> {
  const listening = await checkPortListening(PORT, 750);
  return {
    label: `Port ${PORT}`,
    ok: listening,
    value: listening ? 'listening' : 'not listening',
  };
}

const SERVER_ENTRY = join(__dirname, '..', '..', 'server', 'dist', 'index.js');
const MCP_ENTRY = join(__dirname, '..', '..', 'server', 'dist', 'mcp', 'index.js');
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const URL = `http://localhost:${PORT}`;

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  return new Promise<void>((resolve, reject) => {
    const attempt = () => {
      const socket = createConnection({ port, host: 'localhost' });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() < deadline) {
          setTimeout(attempt, 250);
        } else {
          reject(new Error(`Server did not become ready within ${timeoutMs}ms`));
        }
      });
    };
    attempt();
  });
}

async function openBrowser(url: string): Promise<void> {
  const { default: open } = await import('open');
  await open(url);
}

async function runMcp(squadStorageProvider: string): Promise<void> {
  console.error('[squadboard] MCP server config (paste into your MCP host):');
  console.error(buildMcpConfig(squadStorageProvider));
  console.error('');
  console.error('[squadboard] Starting MCP server on stdio…');

  const mcpProcess = spawn('node', [MCP_ENTRY], {
    stdio: 'inherit',
    env: {
      ...process.env,
      SQUADBOARD_SQUAD_STORAGE_PROVIDER: squadStorageProvider,
    },
  });

  mcpProcess.on('error', (err: Error) => {
    console.error('[cli] failed to start MCP server:', err.message);
    console.error(
      '  Make sure you have built the server first: cd packages/server && pnpm build',
    );
    process.exit(1);
  });

  mcpProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      process.exit(code);
    }
  });

  process.on('SIGINT', () => {
    mcpProcess.kill('SIGINT');
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    mcpProcess.kill('SIGTERM');
    process.exit(0);
  });
}

async function runConnect(squadStorageProvider: string): Promise<void> {
  const mcpResult = await writeMcpConfigFile(squadStorageProvider);
  const agentResult = await injectSquadAgentHints();

  console.log('✅ Squadboard connect complete');
  console.log(`  ${mcpResult.status === 'created' ? 'Wrote' : 'Updated'} ${mcpResult.path}`);

  if (agentResult.status === 'updated') {
    console.log(`  Updated ${agentResult.path} with Squadboard MCP hints`);
  } else if (agentResult.status === 'already_present') {
    console.log(`  Skipped ${agentResult.path} (Squadboard hints already present)`);
  } else {
    console.log(`  Skipped ${agentResult.path} (file not found)`);
  }

  console.log('');
  console.log('Next steps:');
  console.log('  1. Restart Copilot CLI or reload MCP tools if they are already running.');
  console.log('  2. Run `squadboard diagnose` to verify the local setup.');
}

async function runDiagnose(): Promise<void> {
  const rows = await Promise.all([
    getServerDiagnosticRow(),
    getMcpConfigDiagnosticRow(),
    getAgentHintsDiagnosticRow(),
    Promise.resolve(getElectronDiagnosticRow()),
    getPortDiagnosticRow(),
  ]);

  formatDiagnosticsTable(rows);
}

async function main(): Promise<void> {
  const options = parseOptions(args);
  const squadStorageProvider = normalizeSquadStorageProvider(options.squadStorageProvider);

  if (options.printMcpConfig) {
    console.log(buildMcpConfig(squadStorageProvider));
    return;
  }

  if (command === 'connect') {
    await runConnect(squadStorageProvider);
    return;
  }

  if (command === 'diagnose') {
    await runDiagnose();
    return;
  }

  if (command === 'mcp') {
    await runMcp(squadStorageProvider);
    return;
  }

  console.log('🎯 Starting Squadboard…');
  console.log(`[cli] Squad storage provider: ${squadStorageProvider}`);

  const server = spawn('node', [SERVER_ENTRY], {
    stdio: 'inherit',
    env: {
      ...process.env,
      SQUADBOARD_SQUAD_STORAGE_PROVIDER: squadStorageProvider,
    },
  });

  server.on('error', (err: Error) => {
    console.error('[cli] failed to start server:', err.message);
    console.error(
      '  Make sure you have built the server first: cd packages/server && pnpm build',
    );
    process.exit(1);
  });

  server.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[cli] server exited with code ${code}`);
      process.exit(code);
    }
  });

  console.log(`[cli] waiting for server on port ${PORT}…`);

  try {
    await waitForPort(PORT, 15_000);
  } catch {
    console.error('[cli] server did not start in time. Check the output above for errors.');
    server.kill('SIGTERM');
    process.exit(1);
  }

  console.log(`🚀 Squadboard is ready → ${URL}`);

  if (options.noElectron || process.env.SQUADBOARD_NO_ELECTRON) {
    console.log('[cli] Electron launch skipped — opening browser.');
    await openBrowser(URL);
  } else {
    const electronLaunch = launchElectronApp();
    if (electronLaunch.launched) {
      console.log(`[cli] opened Electron via ${electronLaunch.electronMainPath}`);
    } else {
      console.log(`[cli] Electron unavailable (${electronLaunch.reason}) — opening browser.`);
      await openBrowser(URL);
    }
  }

  process.on('SIGINT', () => {
    console.log('\n[cli] shutting down…');
    server.kill('SIGINT');
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    server.kill('SIGTERM');
    process.exit(0);
  });
}

main().catch((err: unknown) => {
  console.error('[cli] fatal:', err);
  process.exit(1);
});

#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface CliOptions {
  printMcpConfig: boolean;
  writeMcpConfig: boolean;
  squadStorageProvider?: string;
}

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
  squadboard init [--squad-storage postgresql|fs] [--print-mcp-config] [--write-mcp-config]
                    Start the Squadboard server and open the UI
  squadboard mcp  [--squad-storage postgresql|fs] [--print-mcp-config] [--write-mcp-config]
                    Start the MCP server (stdio) for Copilot CLI / VS Code

Storage:
  postgresql        Default. Store Squad state in Squadboard's PostgreSQL DB
                    (local PGlite unless DATABASE_URL points to PostgreSQL).
  fs                Fallback. Store Squad state in repository .squad/ files.

Config:
  --print-mcp-config  Print a Copilot CLI MCP config block and exit.
  --write-mcp-config  Merge a squadboard entry into .copilot/mcp-config.json.

`.trim();

const [, , command, ...args] = process.argv;

if (!command || command === '--help' || command === '-h') {
  console.log(USAGE);
  process.exit(command ? 0 : 1);
}

if (command !== 'init' && command !== 'mcp') {
  console.error(`Unknown command: ${command}`);
  console.error('Run `squadboard --help` for usage.');
  process.exit(1);
}

function parseOptions(rawArgs: string[]): CliOptions {
  const options: CliOptions = { printMcpConfig: false, writeMcpConfig: false };

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];

    if (arg === '--print-mcp-config') {
      options.printMcpConfig = true;
      continue;
    }

    if (arg === '--write-mcp-config') {
      options.writeMcpConfig = true;
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

async function writeMcpConfigFile(squadStorageProvider: string): Promise<void> {
  const configDir = join(process.cwd(), '.copilot');
  const configPath = join(configDir, 'mcp-config.json');
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

  await mkdir(configDir, { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  console.log(`[cli] wrote ${configPath}`);
}

// packages/cli/dist/index.js → up 2 → packages/ → server/dist/index.js
const SERVER_ENTRY = join(__dirname, '..', '..', 'server', 'dist', 'index.js');
const MCP_ENTRY = join(__dirname, '..', '..', 'server', 'dist', 'mcp', 'index.js');
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const URL = `http://localhost:${PORT}`;

/**
 * Poll the given TCP port until it accepts connections or the timeout elapses.
 */
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
  // Dynamic import keeps the CLI startup fast and avoids bundling issues.
  const { default: open } = await import('open');
  await open(url);
}

/**
 * `squadboard mcp` — print the MCP server config JSON then spawn the server.
 * The MCP server (stdio) is consumed by Claude Desktop, Cursor, etc.
 */
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

async function main(): Promise<void> {
  const options = parseOptions(args);
  const squadStorageProvider = normalizeSquadStorageProvider(options.squadStorageProvider);

  if (options.writeMcpConfig) {
    await writeMcpConfigFile(squadStorageProvider);
  }

  if (options.printMcpConfig) {
    console.log(buildMcpConfig(squadStorageProvider));
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
      `  Make sure you have built the server first: cd packages/server && pnpm build`,
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
  await openBrowser(URL);

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

#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MCP_CONFIG = JSON.stringify(
  {
    mcpServers: {
      squadboard: {
        command: 'squadboard',
        args: ['mcp'],
      },
    },
  },
  null,
  2,
);

const USAGE = `
Squadboard CLI v0.1.0

Usage:
  squadboard init   Start the Squadboard server and open the UI
  squadboard mcp    Start the MCP server (stdio) for Claude Desktop / Cursor

`.trim();

const [, , command] = process.argv;

if (!command || command === '--help' || command === '-h') {
  console.log(USAGE);
  process.exit(command ? 0 : 1);
}

if (command !== 'init' && command !== 'mcp') {
  console.error(`Unknown command: ${command}`);
  console.error('Run `squadboard --help` for usage.');
  process.exit(1);
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
async function runMcp(): Promise<void> {
  console.error('[squadboard] MCP server config (paste into your MCP host):');
  console.error(MCP_CONFIG);
  console.error('');
  console.error('[squadboard] Starting MCP server on stdio…');

  const mcpProcess = spawn('node', [MCP_ENTRY], {
    stdio: 'inherit',
    env: process.env,
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
  if (command === 'mcp') {
    await runMcp();
    return;
  }

  console.log('🎯 Starting Squadboard…');

  const server = spawn('node', [SERVER_ENTRY], {
    stdio: 'inherit',
    env: process.env,
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

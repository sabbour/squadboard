#!/usr/bin/env node
/**
 * packages/server/src/cli/index.ts
 *
 * Squadboard CLI entry point.
 *
 * Commands:
 *   squadboard mcp       Start the MCP stdio server (for Claude Desktop, Cursor, etc.)
 *   squadboard start     Start the HTTP dashboard server
 *   squadboard --version Print version
 *   squadboard --help    Show this help
 */

import { applyStartOptions, parseStartArgs, type StartOptions } from './start-options.js';

const [, , cmd, ...args] = process.argv;

function printHelp(): void {
  console.log(
    [
      'Squadboard — local-first kanban + workflow board for Squad agents',
      '',
      'Usage:',
      '  squadboard mcp       Start the MCP stdio server (add to Claude Desktop / Cursor config)',
      '  squadboard start     Start the HTTP dashboard server',
      '  squadboard --version Show version',
      '  squadboard --help    Show this help',
      '',
      'Examples:',
      '  # Add to Claude Desktop mcpServers config:',
      '  # { "command": "squadboard", "args": ["mcp"] }',
      '',
      '  # Start the web dashboard:',
      '  SQUADBOARD_DEFAULT_PROJECT_ID=my-project squadboard start',
      '',
      '  # Start with filesystem-backed Squad state instead of default PostgreSQL:',
      '  squadboard start --squad-storage fs',
    ].join('\n'),
  );
}

function printStartHelp(): void {
  console.log(
    [
      'Usage:',
      '  squadboard start [--squad-storage postgresql|fs]',
      '  squadboard start [--postgresql-storage]',
      '',
      'Storage:',
      '  --squad-storage postgresql  Use PostgreSQLStorageProvider for Squad state (default)',
      '  --postgresql-storage        Alias for --squad-storage postgresql',
      '  --squad-storage fs          Use filesystem-backed .squad/ state',
      '',
      'Unset storage uses the canonical "postgresql" provider.',
      'Only the canonical value "postgresql" selects database-backed Squad state; non-canonical values fall back to filesystem.',
      'The local database runtime is PGlite unless DATABASE_URL points to standalone PostgreSQL.',
    ].join('\n'),
  );
}

switch (cmd) {
  case 'mcp':
    await import('../mcp/index.js');
    break;

  case 'start': {
    let options: StartOptions;
    try {
      options = parseStartArgs(args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[squadboard] ${message}`);
      console.error('Run `squadboard start --help` for usage.');
      process.exit(1);
    }
    if (options.help) {
      printStartHelp();
      break;
    }
    applyStartOptions(options);
    await import('../index.js');
    break;
  }

  case '--version':
  case '-v': {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pkg = req('../../package.json') as { version: string };
    console.log(pkg.version);
    break;
  }

  case '--help':
  case '-h':
  case undefined:
  default:
    printHelp();
    break;
}

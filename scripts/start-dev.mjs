#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const START_DEV_ARGS = Object.freeze([
  '--parallel',
  '--filter',
  '@sabbour/squadboard',
  '--filter',
  '@sabbour/squadboard-client',
  '--filter',
  '@sabbour/squadboard-docs',
  'run',
  'dev',
]);

export function buildStartDevArgs() {
  return [...START_DEV_ARGS];
}

export function normalizeStartArgs(argv) {
  const unsupported = [];

  for (const arg of argv) {
    if (arg === 'dev' || arg === '--') continue;
    unsupported.push(arg);
  }

  if (unsupported.length > 0) {
    return {
      ok: false,
      unsupported,
      message: `Unsupported argument(s) for pnpm start: ${unsupported.join(' ')}`,
    };
  }

  return {
    ok: true,
    args: buildStartDevArgs(),
  };
}

export function formatStartCommand(args = buildStartDevArgs()) {
  return ['pnpm', ...args].join(' ');
}

export function runStart(argv = process.argv.slice(2), env = process.env) {
  const normalized = normalizeStartArgs(argv);

  if (!normalized.ok) {
    console.error(normalized.message);
    console.error('Use "pnpm start" or the compatibility form "pnpm start dev".');
    process.exitCode = 1;
    return;
  }

  if (env.SQUADBOARD_START_PRINT_COMMAND === '1') {
    console.log(formatStartCommand(normalized.args));
    return;
  }

  const child = spawn('pnpm', normalized.args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  const forwardSignal = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.once('SIGINT', forwardSignal);
  process.once('SIGTERM', forwardSignal);

  child.on('error', (error) => {
    console.error(`Failed to start Squadboard dev processes: ${error.message}`);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      console.error(`Squadboard dev processes exited from signal ${signal}`);
      process.exit(1);
    }
    process.exit(code ?? 0);
  });
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  runStart();
}

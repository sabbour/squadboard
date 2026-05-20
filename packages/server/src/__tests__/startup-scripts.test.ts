import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SCRATCH_ROOT = path.join(REPO_ROOT, 'packages/server/.test-artifacts/start-dev-regression');

interface PackageJson {
  scripts?: Record<string, string>;
}

interface ScriptRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  pnpmInvocations: string[][];
}

async function readPackageJson(relativePath: string): Promise<PackageJson> {
  return JSON.parse(await readFile(path.join(REPO_ROOT, relativePath), 'utf8')) as PackageJson;
}

async function runRootScriptWithFakePnpm(script: string, extraArg: string): Promise<ScriptRunResult> {
  await rm(SCRATCH_ROOT, { recursive: true, force: true });

  const binDir = path.join(SCRATCH_ROOT, 'bin');
  const logPath = path.join(SCRATCH_ROOT, 'pnpm-argv.jsonl');
  const probePath = path.join(SCRATCH_ROOT, 'pnpm-probe.cjs');
  await mkdir(binDir, { recursive: true });

  await writeFile(
    probePath,
    [
      'const fs = require("node:fs");',
      'fs.appendFileSync(',
      '  process.env.SQUADBOARD_PNPM_ARGV_LOG,',
      '  JSON.stringify(process.argv.slice(2)) + "\\n",',
      ');',
      '',
    ].join('\n'),
    'utf8',
  );

  const fakePnpmPath = path.join(binDir, 'pnpm');
  await writeFile(
    fakePnpmPath,
    [
      '#!/usr/bin/env sh',
      'exec node "$SQUADBOARD_PNPM_PROBE" "$@"',
      '',
    ].join('\n'),
    'utf8',
  );
  await chmod(fakePnpmPath, 0o755);

  try {
    const child = spawn('/bin/sh', ['-c', `${script} ${extraArg}`], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
        SQUADBOARD_PNPM_ARGV_LOG: logPath,
        SQUADBOARD_PNPM_PROBE: probePath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });

    let pnpmInvocations: string[][] = [];
    try {
      const log = await readFile(logPath, 'utf8');
      pnpmInvocations = log
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    return { exitCode, stdout, stderr, pnpmInvocations };
  } finally {
    await rm(SCRATCH_ROOT, { recursive: true, force: true });
  }
}

function workspaceDevRunInvocations(invocations: string[][]): string[][] {
  return invocations.filter((args) => {
    const runIndex = args.indexOf('run');
    return runIndex >= 0 && args[runIndex + 1] === 'dev';
  });
}

describe('startup scripts', () => {
  it('does not forward pnpm start dev trailing args into workspace dev scripts', async () => {
    const rootPackage = await readPackageJson('package.json');
    const docsPackage = await readPackageJson('packages/docs-site/package.json');
    const startScript = rootPackage.scripts?.['start'];

    expect(docsPackage.scripts?.['dev']).toContain('scripts/docusaurus.mjs start');
    expect(startScript).toBeTruthy();

    const result = await runRootScriptWithFakePnpm(startScript!, 'dev');
    expect(
      result.exitCode,
      `root start script failed before fake pnpm could capture invocations\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    ).toBe(0);

    const devRuns = workspaceDevRunInvocations(result.pnpmInvocations);
    expect(
      devRuns.length,
      `expected root start to invoke workspace dev scripts; captured pnpm calls: ${JSON.stringify(
        result.pnpmInvocations,
      )}`,
    ).toBeGreaterThan(0);

    for (const args of devRuns) {
      const runIndex = args.indexOf('run');
      const forwardedArgs = args.slice(runIndex + 2);
      expect(
        forwardedArgs,
        `pnpm ${args.join(' ')} would forward extra positional args into Docusaurus`,
      ).toEqual([]);
    }
  });
});

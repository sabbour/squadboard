import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

interface PackageJson {
  scripts?: Record<string, string>;
}

interface NormalizedStartArgs {
  ok: boolean;
  args?: string[];
  message?: string;
}

async function readPackageJson(relativePath: string): Promise<PackageJson> {
  return JSON.parse(await readFile(path.join(REPO_ROOT, relativePath), 'utf8')) as PackageJson;
}

async function loadStartScript(): Promise<{
  buildStartDevArgs: () => string[];
  formatStartCommand: (args?: string[]) => string;
  normalizeStartArgs: (argv: string[]) => NormalizedStartArgs;
}> {
  return import(pathToFileURL(path.join(REPO_ROOT, 'scripts/start-dev.mjs')).href);
}

describe('root start script', () => {
  it('routes pnpm start through the argument-normalizing wrapper', async () => {
    const rootPkg = await readPackageJson('package.json');

    expect(rootPkg.scripts?.['start']).toBe('node scripts/start-dev.mjs');
  });

  it('keeps the generated dev command on backend, frontend, and docs without extra argv', async () => {
    const { buildStartDevArgs, formatStartCommand } = await loadStartScript();

    expect(buildStartDevArgs()).toEqual([
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
    expect(formatStartCommand()).toBe(
      'pnpm --parallel --filter @sabbour/squadboard --filter @sabbour/squadboard-client --filter @sabbour/squadboard-docs run dev',
    );
  });

  it('treats pnpm start dev as compatibility input instead of forwarding dev', async () => {
    const { buildStartDevArgs, normalizeStartArgs } = await loadStartScript();

    expect(normalizeStartArgs(['dev'])).toEqual({
      ok: true,
      args: buildStartDevArgs(),
    });
  });

  it('rejects unsupported start arguments instead of leaking them to workspace dev scripts', async () => {
    const { normalizeStartArgs } = await loadStartScript();

    expect(normalizeStartArgs(['docs'])).toMatchObject({
      ok: false,
      message: 'Unsupported argument(s) for pnpm start: docs',
    });
  });
});

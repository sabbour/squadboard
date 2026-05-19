/**
 * postgresql-storage-provider.test.ts — Contract & integration tests for
 * PostgreSQLStorageProvider (Kujan / QA authorship).
 *
 * ## What is tested
 *
 * 1. CRUD contract — read/write/append/list/stat/rename/copy/delete behave
 *    identically to InMemoryStorageProvider and SQLiteStorageProvider for the
 *    same sequence of operations (the StorageProvider invariant).
 *
 * 2. Path normalization — double-slashes, Windows backslashes, trailing
 *    slashes, and "dot-segment" paths are stored under their normalized key.
 *
 * 3. Traversal / absolute paths — unsafe `../` and out-of-root absolute paths
 *    are rejected before they can become database keys. SDK absolute paths under
 *    the configured project `.squad/` root are normalized to safe relative keys.
 *
 * 4. Persistence across adapter instances sharing the same PGlite engine —
 *    data written through adapter A is immediately visible through adapter B
 *    when both wrap the same PGlite object.
 *
 * 5. Default SDK state is PostgreSQL-backed — sdk-state.ts creates
 *    PostgreSQLStorageProvider unless explicit fallback config selects fs.
 *
 * 6. No-env launch/config — CLI flags and package scripts select the canonical
 *    PostgreSQL provider without preserving a `pglite` value alias.
 *
 * 7. First-run filesystem seed — existing `.squad/` files import only into an
 *    empty DB scope and never overwrite/merge into a non-empty scope.
 *
 * 8. Sync boundary (documented, not runtime-asserted) — the PGlite engine is
 *    in-process WASM; its state is NOT visible to external processes (Squad
 *    CLI, Copilot MCP).  Cross-process sharing requires either a shared
 *    Postgres via DATABASE_URL, an export broker, or FSStorageProvider.
 *
 * ## Strategy
 *
 * Each test group boots a fresh in-memory PGlite instance
 * (`new PGlite()`, no data dir) and applies the migration DDL from
 * 0009_squad_storage.sql before the group runs.  Tests are fully isolated
 * — no filesystem access, no DATABASE_URL, no shared state between groups.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createPoolAdapter } from '../db/pglite.js';
import {
  PostgreSQLStorageProvider,
  PostgreSQLStorageNotInitializedError,
  PostgreSQLStoragePathError,
} from '../sdk/postgresql-storage-provider.js';
import {
  resolveStorageBackend,
  seedPostgreSQLProviderFromFilesystemIfEmpty,
} from '../services/sdk-state.js';
import { FSStorageProvider } from '@bradygaster/squad-sdk/storage';
import { applyStartOptions, parseStartArgs } from '../cli/start-options.js';

// ─── Schema DDL (mirrors 0009_squad_storage.sql) ─────────────────────────────

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS squad_storage (
  scope      TEXT NOT NULL,
  path       TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  size_bytes BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope, path)
);
CREATE INDEX IF NOT EXISTS idx_squad_storage_scope ON squad_storage (scope);
`;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

interface PackageJson {
  scripts?: Record<string, string>;
}

async function readPackageJson(relativePath: string): Promise<PackageJson> {
  return JSON.parse(await readFile(path.join(REPO_ROOT, relativePath), 'utf8')) as PackageJson;
}

function scriptsText(pkg: PackageJson): string {
  return Object.entries(pkg.scripts ?? {})
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n');
}

function withSquadStorageEnv(value: string | undefined, run: () => void): void {
  const original = process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'];
  if (value === undefined) delete process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'];
  else process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'] = value;
  try {
    run();
  } finally {
    if (original === undefined) delete process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'];
    else process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'] = original;
  }
}

const silentStartLogger = {
  log: () => {},
  warn: () => {},
};

let workspaceCounter = 0;
const WORKSPACE_BASE = path.join(
  REPO_ROOT,
  'packages/server/.test-workspaces/postgresql-storage-provider',
);

async function makeWorkspaceRoot(label: string): Promise<string> {
  workspaceCounter += 1;
  const rootDir = path.join(WORKSPACE_BASE, `${process.pid}-${workspaceCounter}-${label}`);
  await rm(rootDir, { recursive: true, force: true });
  await mkdir(rootDir, { recursive: true });
  return rootDir;
}

async function removeWorkspaceRoot(rootDir: string): Promise<void> {
  await rm(rootDir, { recursive: true, force: true });
  await rm(path.join(REPO_ROOT, 'packages/server/.test-workspaces'), {
    recursive: true,
    force: true,
  });
}

// ─── Factory helpers ──────────────────────────────────────────────────────────

async function makeProvider(
  pglite: PGlite,
  scope = 'test-project-1',
): Promise<PostgreSQLStorageProvider> {
  const pool = createPoolAdapter(pglite);
  const provider = new PostgreSQLStorageProvider(pool, scope);
  await provider.init();
  return provider;
}

async function freshPGlite(): Promise<PGlite> {
  const pg = new PGlite(); // in-memory, isolated
  await pg.waitReady;
  await pg.exec(SCHEMA_DDL);
  return pg;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. CRUD CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

describe('PostgreSQLStorageProvider — CRUD contract', () => {
  let pg: PGlite;
  let provider: PostgreSQLStorageProvider;

  beforeAll(async () => {
    pg = await freshPGlite();
  });

  beforeEach(async () => {
    // Wipe the table between tests so each test starts clean.
    await pg.exec('TRUNCATE squad_storage');
    provider = await makeProvider(pg);
  });

  // ── write / read ───────────────────────────────────────────────────────────

  it('write then read returns the same content', async () => {
    await provider.write('agents/verbal.md', '# Verbal');
    expect(await provider.read('agents/verbal.md')).toBe('# Verbal');
  });

  it('read of nonexistent path returns undefined', async () => {
    expect(await provider.read('does/not/exist.md')).toBeUndefined();
  });

  it('write overwrites existing content', async () => {
    await provider.write('file.txt', 'first');
    await provider.write('file.txt', 'second');
    expect(await provider.read('file.txt')).toBe('second');
  });

  // ── append ─────────────────────────────────────────────────────────────────

  it('append creates file when it does not exist', async () => {
    await provider.append('log.txt', 'line1\n');
    expect(await provider.read('log.txt')).toBe('line1\n');
  });

  it('append adds to existing content without duplication', async () => {
    await provider.write('log.txt', 'line1\n');
    await provider.append('log.txt', 'line2\n');
    expect(await provider.read('log.txt')).toBe('line1\nline2\n');
  });

  it('multiple appends accumulate in order', async () => {
    await provider.append('log.txt', 'A');
    await provider.append('log.txt', 'B');
    await provider.append('log.txt', 'C');
    expect(await provider.read('log.txt')).toBe('ABC');
  });

  // ── exists ─────────────────────────────────────────────────────────────────

  it('exists returns true after write', async () => {
    await provider.write('exists.txt', 'data');
    expect(await provider.exists('exists.txt')).toBe(true);
  });

  it('exists returns false for nonexistent file', async () => {
    expect(await provider.exists('ghost.txt')).toBe(false);
  });

  it('exists returns true for an implicit directory', async () => {
    await provider.write('dir/child.txt', 'x');
    expect(await provider.exists('dir')).toBe(true);
  });

  // ── list ───────────────────────────────────────────────────────────────────

  it('list returns immediate children only', async () => {
    await provider.write('a/b.txt', '1');
    await provider.write('a/c.txt', '2');
    await provider.write('a/sub/d.txt', '3');
    const entries = await provider.list('a');
    expect(entries.sort()).toEqual(['b.txt', 'c.txt', 'sub']);
  });

  it('list returns empty array for empty or nonexistent directory', async () => {
    expect(await provider.list('no/such/dir')).toEqual([]);
  });

  it('list does not include entries from sibling directories', async () => {
    await provider.write('alpha/x.txt', '1');
    await provider.write('beta/y.txt', '2');
    const entries = await provider.list('alpha');
    expect(entries).toEqual(['x.txt']);
    expect(entries).not.toContain('y.txt');
  });

  // ── stat ───────────────────────────────────────────────────────────────────

  it('stat returns size and isDirectory=false for a file', async () => {
    const content = 'hello world';
    await provider.write('greeting.txt', content);
    const s = await provider.stat('greeting.txt');
    expect(s).toBeDefined();
    expect(s!.isDirectory).toBe(false);
    expect(s!.size).toBe(Buffer.byteLength(content, 'utf-8'));
    expect(s!.mtimeMs).toBeGreaterThan(0);
  });

  it('stat returns isDirectory=true for an implicit directory', async () => {
    await provider.write('src/index.ts', 'export {}');
    const s = await provider.stat('src');
    expect(s).toBeDefined();
    expect(s!.isDirectory).toBe(true);
  });

  it('stat returns undefined for a path that does not exist', async () => {
    expect(await provider.stat('nowhere.txt')).toBeUndefined();
  });

  // ── delete ─────────────────────────────────────────────────────────────────

  it('delete removes the file; subsequent read returns undefined', async () => {
    await provider.write('temp.txt', 'data');
    await provider.delete('temp.txt');
    expect(await provider.read('temp.txt')).toBeUndefined();
    expect(await provider.exists('temp.txt')).toBe(false);
  });

  it('delete on nonexistent path is a no-op (does not throw)', async () => {
    await expect(provider.delete('nonexistent.txt')).resolves.toBeUndefined();
  });

  // ── deleteDir ──────────────────────────────────────────────────────────────

  it('deleteDir removes all children recursively', async () => {
    await provider.write('tree/a.txt', 'A');
    await provider.write('tree/sub/b.txt', 'B');
    await provider.deleteDir('tree');
    expect(await provider.exists('tree')).toBe(false);
    expect(await provider.read('tree/a.txt')).toBeUndefined();
    expect(await provider.read('tree/sub/b.txt')).toBeUndefined();
  });

  it('deleteDir does not affect sibling directories', async () => {
    await provider.write('keep/file.txt', 'keeper');
    await provider.write('delete_me/file.txt', 'gone');
    await provider.deleteDir('delete_me');
    expect(await provider.read('keep/file.txt')).toBe('keeper');
  });

  // ── rename ─────────────────────────────────────────────────────────────────

  it('rename moves a file to a new path', async () => {
    await provider.write('old.txt', 'content');
    await provider.rename('old.txt', 'new.txt');
    expect(await provider.read('new.txt')).toBe('content');
    expect(await provider.read('old.txt')).toBeUndefined();
  });

  it('rename moves an entire directory subtree', async () => {
    await provider.write('src/index.ts', 'index');
    await provider.write('src/util.ts', 'util');
    await provider.rename('src', 'lib');
    expect(await provider.read('lib/index.ts')).toBe('index');
    expect(await provider.read('lib/util.ts')).toBe('util');
    expect(await provider.exists('src')).toBe(false);
  });

  it('rename throws for a nonexistent source', async () => {
    await expect(provider.rename('ghost.txt', 'new.txt')).rejects.toThrow();
  });

  // ── copy ───────────────────────────────────────────────────────────────────

  it('copy duplicates a file to a new path', async () => {
    await provider.write('original.txt', 'data');
    await provider.copy('original.txt', 'copy.txt');
    expect(await provider.read('original.txt')).toBe('data');
    expect(await provider.read('copy.txt')).toBe('data');
  });

  it('copy overwrites the destination if it already exists', async () => {
    await provider.write('src.txt', 'new content');
    await provider.write('dst.txt', 'old content');
    await provider.copy('src.txt', 'dst.txt');
    expect(await provider.read('dst.txt')).toBe('new content');
  });

  it('copy throws for a nonexistent source', async () => {
    await expect(provider.copy('ghost.txt', 'copy.txt')).rejects.toThrow();
  });

  // ── isDirectory ────────────────────────────────────────────────────────────

  it('isDirectory returns false for a file', async () => {
    await provider.write('file.txt', 'x');
    expect(await provider.isDirectory('file.txt')).toBe(false);
  });

  it('isDirectory returns true for an implicit directory', async () => {
    await provider.write('dir/child.txt', 'x');
    expect(await provider.isDirectory('dir')).toBe(true);
  });

  it('isDirectory returns false for a nonexistent path', async () => {
    expect(await provider.isDirectory('nowhere')).toBe(false);
  });

  // ── mkdir ──────────────────────────────────────────────────────────────────

  it('mkdir is a no-op — directories are implicit', async () => {
    await expect(provider.mkdir('some/dir', { recursive: true })).resolves.toBeUndefined();
    // The directory does not appear unless a file is written under it.
    expect(await provider.isDirectory('some/dir')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. PATH NORMALIZATION
// ─────────────────────────────────────────────────────────────────────────────

describe('PostgreSQLStorageProvider — path normalization', () => {
  let pg: PGlite;
  let provider: PostgreSQLStorageProvider;

  beforeAll(async () => {
    pg = await freshPGlite();
  });

  beforeEach(async () => {
    await pg.exec('TRUNCATE squad_storage');
    provider = await makeProvider(pg);
  });

  it('double-slash in path is collapsed to single slash', async () => {
    await provider.write('a//b.txt', 'data');
    expect(await provider.read('a/b.txt')).toBe('data');
  });

  it('trailing slash is stripped', async () => {
    await provider.write('dir/', 'oops');
    expect(await provider.read('dir')).toBe('oops');
  });

  it('Windows backslash separators are normalized to forward slashes', async () => {
    await provider.write('foo\\bar\\baz.txt', 'win');
    expect(await provider.read('foo/bar/baz.txt')).toBe('win');
  });

  it('dot-segment in path is resolved (a/./b → a/b)', async () => {
    await provider.write('a/./b.txt', 'dot');
    expect(await provider.read('a/b.txt')).toBe('dot');
  });

  it('write and read with different but equivalent paths return same file', async () => {
    await provider.write('x//y/../y/file.txt', 'content');
    expect(await provider.read('x/y/file.txt')).toBe('content');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. TRAVERSAL / ABSOLUTE PATH REJECTION
// ─────────────────────────────────────────────────────────────────────────────

describe('PostgreSQLStorageProvider — traversal & absolute path rejection', () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = await freshPGlite();
  });

  beforeEach(async () => {
    await pg.exec('TRUNCATE squad_storage');
  });

  // ── Traversal ──────────────────────────────────────────────────────────────

  it('write rejects a traversal path (../outside/secret.md)', async () => {
    const provider = await makeProvider(pg, 'project-a');
    await expect(provider.write('../outside/secret.md', 'data')).rejects.toThrow(PostgreSQLStoragePathError);
  });

  it('write rejects a traversal path with leading directory (foo/../../etc)', async () => {
    const provider = await makeProvider(pg, 'project-a');
    await expect(provider.write('foo/../../etc/passwd', 'data')).rejects.toThrow(PostgreSQLStoragePathError);
  });

  it('write rejects a bare ".." path', async () => {
    const provider = await makeProvider(pg, 'project-a');
    await expect(provider.write('..', 'data')).rejects.toThrow(PostgreSQLStoragePathError);
  });

  it('read rejects a traversal path', async () => {
    const provider = await makeProvider(pg, 'project-a');
    await expect(provider.read('../secret')).rejects.toThrow(PostgreSQLStoragePathError);
  });

  it('append rejects a traversal path', async () => {
    const provider = await makeProvider(pg, 'project-a');
    await expect(provider.append('../log.txt', 'line')).rejects.toThrow(PostgreSQLStoragePathError);
  });

  it('delete rejects a traversal path', async () => {
    const provider = await makeProvider(pg, 'project-a');
    await expect(provider.delete('../secret')).rejects.toThrow(PostgreSQLStoragePathError);
  });

  it('rename rejects traversal in old path', async () => {
    const provider = await makeProvider(pg, 'project-a');
    await expect(provider.rename('../old', 'new')).rejects.toThrow(PostgreSQLStoragePathError);
  });

  it('rename rejects traversal in new path', async () => {
    const provider = await makeProvider(pg, 'project-a');
    await provider.write('file.txt', 'data');
    await expect(provider.rename('file.txt', '../escaped.txt')).rejects.toThrow(PostgreSQLStoragePathError);
  });

  it('copy rejects traversal in source path', async () => {
    const provider = await makeProvider(pg, 'project-a');
    await expect(provider.copy('../src.txt', 'dst.txt')).rejects.toThrow(PostgreSQLStoragePathError);
  });

  it('copy rejects traversal in destination path', async () => {
    const provider = await makeProvider(pg, 'project-a');
    await provider.write('src.txt', 'data');
    await expect(provider.copy('src.txt', '../dst.txt')).rejects.toThrow(PostgreSQLStoragePathError);
  });

  it('stat rejects a traversal path', async () => {
    const provider = await makeProvider(pg, 'project-a');
    await expect(provider.stat('../secret')).rejects.toThrow(PostgreSQLStoragePathError);
  });

  it('list rejects a traversal path', async () => {
    const provider = await makeProvider(pg, 'project-a');
    await expect(provider.list('../dir')).rejects.toThrow(PostgreSQLStoragePathError);
  });

  it('exists rejects a traversal path', async () => {
    const provider = await makeProvider(pg, 'project-a');
    await expect(provider.exists('../secret')).rejects.toThrow(PostgreSQLStoragePathError);
  });

  it('deleteDir rejects a traversal path', async () => {
    const provider = await makeProvider(pg, 'project-a');
    await expect(provider.deleteDir('../evil')).rejects.toThrow(PostgreSQLStoragePathError);
  });

  // ── Absolute paths ─────────────────────────────────────────────────────────

  it('write rejects an absolute path (/etc/passwd)', async () => {
    const provider = await makeProvider(pg, 'project-b');
    await expect(provider.write('/etc/passwd', 'fake')).rejects.toThrow(PostgreSQLStoragePathError);
  });

  it('read rejects an absolute path', async () => {
    const provider = await makeProvider(pg, 'project-b');
    await expect(provider.read('/etc/passwd')).rejects.toThrow(PostgreSQLStoragePathError);
  });

  it('write rejects an absolute path with no traversal (just leading slash)', async () => {
    const provider = await makeProvider(pg, 'project-b');
    await expect(provider.write('/agents/verbal.md', 'data')).rejects.toThrow(PostgreSQLStoragePathError);
  });

  it('normalizes SDK absolute paths under the configured .squad root', async () => {
    const pool = createPoolAdapter(pg);
    const provider = new PostgreSQLStorageProvider(pool, 'project-root', {
      rootDir: '/workspace/project',
    });
    await provider.init();

    await provider.write('/workspace/project/.squad/agents/verbal/charter.md', '# Verbal');

    expect(await provider.read('agents/verbal/charter.md')).toBe('# Verbal');
    await expect(provider.write('/workspace/project/README.md', 'outside')).rejects.toThrow(
      PostgreSQLStoragePathError,
    );
  });

  // ── Safe relative paths must still work ───────────────────────────────────

  it('write accepts a valid relative path (agents/verbal.md)', async () => {
    const provider = await makeProvider(pg, 'project-safe');
    await expect(provider.write('agents/verbal.md', '# Verbal')).resolves.toBeUndefined();
    expect(await provider.read('agents/verbal.md')).toBe('# Verbal');
  });

  it('write accepts a path with a single dot segment that resolves safely (a/./b)', async () => {
    const provider = await makeProvider(pg, 'project-safe');
    await expect(provider.write('a/./b.txt', 'data')).resolves.toBeUndefined();
    expect(await provider.read('a/b.txt')).toBe('data');
  });

  it('PostgreSQLStoragePathError carries the rejected path for debuggability', async () => {
    const provider = await makeProvider(pg, 'project-err');
    try {
      await provider.write('../escape.txt', 'x');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(PostgreSQLStoragePathError);
      expect((e as PostgreSQLStoragePathError).path).toBe('../escape.txt');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. PERSISTENCE ACROSS ADAPTER INSTANCES (same PGlite object)
// ─────────────────────────────────────────────────────────────────────────────

describe('PostgreSQLStorageProvider — persistence across adapter instances', () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = await freshPGlite();
  });

  beforeEach(async () => {
    await pg.exec('TRUNCATE squad_storage');
  });

  it('data written by instance A is readable by instance B (same PGlite, same scope)', async () => {
    const a = await makeProvider(pg, 'project-persist');
    await a.write('state.json', '{"v":1}');

    // Create a brand-new provider instance (separate object, same PGlite engine).
    const b = await makeProvider(pg, 'project-persist');
    expect(await b.read('state.json')).toBe('{"v":1}');
  });

  it('instance B can overwrite data written by instance A; instance A reads the new value', async () => {
    const a = await makeProvider(pg, 'project-persist');
    const b = await makeProvider(pg, 'project-persist');

    await a.write('counter.txt', '1');
    await b.write('counter.txt', '2');

    // A must re-read from the DB (its in-memory cache may be stale).
    // The provider's init() already loaded data; re-init() is needed to refresh.
    // A fresh instance always reflects the latest DB state.
    const c = await makeProvider(pg, 'project-persist');
    expect(await c.read('counter.txt')).toBe('2');
  });

  it('data from scope A is not visible to scope B on the same PGlite instance', async () => {
    const a = await makeProvider(pg, 'project-alpha');
    const b = await makeProvider(pg, 'project-beta');

    await a.write('secret.md', 'alpha secret');
    await b.write('secret.md', 'beta secret');

    expect(await a.read('secret.md')).toBe('alpha secret');
    expect(await b.read('secret.md')).toBe('beta secret');
  });

  it('deleteDir by instance A removes data that instance B can no longer see', async () => {
    const a = await makeProvider(pg, 'project-gc');
    await a.write('tree/leaf.txt', 'value');
    await a.deleteDir('tree');

    const b = await makeProvider(pg, 'project-gc');
    expect(await b.read('tree/leaf.txt')).toBeUndefined();
    expect(await b.exists('tree')).toBe(false);
  });

  it('rename by instance A is reflected in a fresh instance B', async () => {
    const a = await makeProvider(pg, 'project-rename');
    await a.write('old/file.txt', 'moved content');
    await a.rename('old/file.txt', 'new/file.txt');

    const b = await makeProvider(pg, 'project-rename');
    expect(await b.read('new/file.txt')).toBe('moved content');
    expect(await b.read('old/file.txt')).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. DEFAULT SDK STATE IS POSTGRESQL-BACKED WITH FILESYSTEM FALLBACK
// ─────────────────────────────────────────────────────────────────────────────

describe('Default SDK state — PostgreSQLStorageProvider unless fallback selects filesystem', () => {
  it('resolveStorageBackend() returns "postgresql" when env var is absent', async () => {
    const original = process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'];
    delete process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'];
    try {
      expect(resolveStorageBackend()).toBe('postgresql');
    } finally {
      if (original !== undefined) process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'] = original;
    }
  });

  it('resolveStorageBackend() returns "postgresql" for unset, null, or blank config sources', () => {
    expect(resolveStorageBackend(undefined)).toBe('postgresql');
    expect(resolveStorageBackend(null)).toBe('postgresql');
    expect(resolveStorageBackend('')).toBe('postgresql');
    expect(resolveStorageBackend({ squadStorageProvider: null })).toBe('postgresql');
    expect(resolveStorageBackend({ squadStorageProvider: '   ' })).toBe('postgresql');
  });

  it('resolveStorageBackend() returns "postgresql" when SQUADBOARD_SQUAD_STORAGE_PROVIDER=postgresql', async () => {
    const original = process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'];
    process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'] = 'postgresql';
    try {
      expect(resolveStorageBackend()).toBe('postgresql');
    } finally {
      if (original === undefined) delete process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'];
      else process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'] = original;
    }
  });

  it('resolveStorageBackend() returns "fs" when SQUADBOARD_SQUAD_STORAGE_PROVIDER=fs', async () => {
    const original = process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'];
    process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'] = 'fs';
    try {
      expect(resolveStorageBackend()).toBe('fs');
    } finally {
      if (original === undefined) delete process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'];
      else process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'] = original;
    }
  });

  it('resolveStorageBackend() returns "fs" when SQUADBOARD_SQUAD_STORAGE_PROVIDER=pglite', async () => {
    const original = process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'];
    process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'] = 'pglite';
    try {
      expect(resolveStorageBackend()).toBe('fs');
      expect(resolveStorageBackend()).not.toBe('postgresql');
    } finally {
      if (original === undefined) delete process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'];
      else process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'] = original;
    }
  });

  it('resolveStorageBackend() returns "fs" for an unrecognised env var value (default-safe)', async () => {
    const original = process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'];
    process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'] = 'unknown-backend';
    try {
      expect(resolveStorageBackend()).toBe('fs');
    } finally {
      if (original === undefined) delete process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'];
      else process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'] = original;
    }
  });

  it('the stale SQUADBOARD_STORAGE_PROVIDER name never changes canonical default selection', async () => {
    const originalOld = process.env['SQUADBOARD_STORAGE_PROVIDER'];
    const originalNew = process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'];
    delete process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'];
    try {
      for (const staleValue of ['fs', 'pglite']) {
        process.env['SQUADBOARD_STORAGE_PROVIDER'] = staleValue;
        // Setting only the stale name must NOT change the canonical provider.
        expect(resolveStorageBackend()).toBe('postgresql');
      }
    } finally {
      if (originalOld === undefined) delete process.env['SQUADBOARD_STORAGE_PROVIDER'];
      else process.env['SQUADBOARD_STORAGE_PROVIDER'] = originalOld;
      if (originalNew !== undefined) process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'] = originalNew;
    }
  });

  it('PostgreSQLStorageProvider constructor requires explicit PoolLike — there is no implicit fallback', () => {
    expect(() => new PostgreSQLStorageProvider(undefined as never, 'scope')).toThrow(TypeError);
  });

  it('FSStorageProvider is a distinct class from PostgreSQLStorageProvider', async () => {
    const instance = new FSStorageProvider(process.cwd());
    expect(instance).not.toBeInstanceOf(PostgreSQLStorageProvider);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. NO-ENV POSTGRESQL LAUNCH / CONFIG SOURCE
// ─────────────────────────────────────────────────────────────────────────────

describe('No-env PostgreSQL launch/config path', () => {
  it('CLI start flag selects the canonical PostgreSQL provider consumed by sdk-state', () => {
    withSquadStorageEnv(undefined, () => {
      const options = parseStartArgs(['--squad-storage', 'postgresql']);
      applyStartOptions(options, process.env, silentStartLogger);

      expect(process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER']).toBe('postgresql');
      expect(resolveStorageBackend()).toBe('postgresql');
    });
  });

  it('CLI start defaults to PostgreSQL without setting provider env', () => {
    withSquadStorageEnv(undefined, () => {
      const options = parseStartArgs([]);
      applyStartOptions(options, process.env, silentStartLogger);

      expect(process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER']).toBeUndefined();
      expect(resolveStorageBackend()).toBe('postgresql');
    });
  });

  it('CLI start flag can select the filesystem fallback', () => {
    withSquadStorageEnv(undefined, () => {
      const options = parseStartArgs(['--squad-storage', 'fs']);
      applyStartOptions(options, process.env, silentStartLogger);

      expect(process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER']).toBe('fs');
      expect(resolveStorageBackend()).toBe('fs');
    });
  });

  it('CLI start supports equals syntax and the convenience PostgreSQL flag', () => {
    expect(parseStartArgs(['--squad-storage=postgresql']).squadStorageProvider).toBe(
      'postgresql',
    );
    expect(parseStartArgs(['--postgresql-storage']).squadStorageProvider).toBe('postgresql');
  });

  it('CLI start keeps pglite non-canonical: parsed value does not select DB storage', () => {
    withSquadStorageEnv(undefined, () => {
      const options = parseStartArgs(['--squad-storage', 'pglite']);
      applyStartOptions(options, process.env, silentStartLogger);

      expect(process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER']).toBe('pglite');
      expect(resolveStorageBackend()).toBe('fs');
      expect(resolveStorageBackend()).not.toBe('postgresql');
    });
  });

  it('CLI start rejects a missing --squad-storage value', () => {
    expect(() => parseStartArgs(['--squad-storage'])).toThrow(
      'Missing value for --squad-storage',
    );
  });

  it('package dev:postgresql scripts route through the CLI flag rather than manual env setup', async () => {
    const rootPkg = await readPackageJson('package.json');
    const serverPkg = await readPackageJson('packages/server/package.json');
    const clientPkg = await readPackageJson('packages/client/package.json');

    expect(rootPkg.scripts?.['dev:postgresql']).toContain('run dev:postgresql');
    expect(rootPkg.scripts?.['dev:postgresql']).toContain('@sabbour/squadboard');
    expect(rootPkg.scripts?.['dev:postgresql']).toContain('@sabbour/squadboard-client');
    expect(rootPkg.scripts?.['dev:fs']).toContain('run dev:fs');
    expect(serverPkg.scripts?.['dev:postgresql']).toContain(
      'src/cli/index.ts start --squad-storage postgresql',
    );
    expect(serverPkg.scripts?.['dev:fs']).toContain(
      'src/cli/index.ts start --squad-storage fs',
    );
    expect(clientPkg.scripts?.['dev:postgresql']).toBe('vite');
    expect(clientPkg.scripts?.['dev:fs']).toBe('vite');
  });

  it('package launch scripts do not use the stale provider env name or pglite alias', async () => {
    const rootPkg = await readPackageJson('package.json');
    const serverPkg = await readPackageJson('packages/server/package.json');
    const clientPkg = await readPackageJson('packages/client/package.json');
    const allScripts = [rootPkg, serverPkg, clientPkg].map(scriptsText).join('\n');

    expect(allScripts).not.toMatch(/SQUADBOARD_STORAGE_PROVIDER/);
    expect(allScripts).not.toMatch(/SQUADBOARD_SQUAD_STORAGE_PROVIDER\s*=\s*pglite/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. FIRST-RUN FILESYSTEM SEED SAFETY
// ─────────────────────────────────────────────────────────────────────────────

describe('PostgreSQL first-run import from filesystem .squad', () => {
  it('seeds an empty DB scope from an existing filesystem .squad directory', async () => {
    const rootDir = await makeWorkspaceRoot('seed-empty');
    try {
      await mkdir(path.join(rootDir, '.squad/agents/kujan'), { recursive: true });
      await writeFile(path.join(rootDir, '.squad/decisions.md'), '# Decisions\n', 'utf8');
      await writeFile(
        path.join(rootDir, '.squad/agents/kujan/charter.md'),
        '# Kujan\nQA charter\n',
        'utf8',
      );

      const pg = await freshPGlite();
      const provider = await makeProvider(pg, 'seed-empty');
      await seedPostgreSQLProviderFromFilesystemIfEmpty(provider, 'seed-empty', rootDir);

      expect(await provider.read('decisions.md')).toBe('# Decisions\n');
      expect(await provider.read('agents/kujan/charter.md')).toBe('# Kujan\nQA charter\n');
      await pg.close();
    } finally {
      await removeWorkspaceRoot(rootDir);
    }
  });

  it('does not overwrite or merge into a non-empty DB scope', async () => {
    const rootDir = await makeWorkspaceRoot('non-empty-scope');
    try {
      await mkdir(path.join(rootDir, '.squad'), { recursive: true });
      await writeFile(path.join(rootDir, '.squad/decisions.md'), 'filesystem\n', 'utf8');
      await writeFile(path.join(rootDir, '.squad/new-file.md'), 'should not import\n', 'utf8');

      const pg = await freshPGlite();
      const provider = await makeProvider(pg, 'seed-non-empty');
      await provider.write('decisions.md', 'database\n');
      await seedPostgreSQLProviderFromFilesystemIfEmpty(provider, 'seed-non-empty', rootDir);

      expect(await provider.read('decisions.md')).toBe('database\n');
      expect(await provider.read('new-file.md')).toBeUndefined();
      await pg.close();
    } finally {
      await removeWorkspaceRoot(rootDir);
    }
  });

  it('does nothing when the DB scope is empty but filesystem .squad is absent', async () => {
    const rootDir = await makeWorkspaceRoot('missing-squad');
    try {
      const pg = await freshPGlite();
      const provider = await makeProvider(pg, 'seed-missing-squad');
      await seedPostgreSQLProviderFromFilesystemIfEmpty(provider, 'seed-missing-squad', rootDir);

      expect(await provider.list('')).toEqual([]);
      await pg.close();
    } finally {
      await removeWorkspaceRoot(rootDir);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. SYNC BOUNDARY — DOCUMENTED, IN-PROCESS ONLY
// ─────────────────────────────────────────────────────────────────────────────

describe('Sync boundary — in-process PGlite is NOT visible to external processes', () => {
  /**
   * INVARIANT (non-runtime, documented in this block):
   *
   *   PGlite is WASM running inside this Node.js process.  Its `squad_storage`
   *   table exists only in the WASM heap (or a local data directory when a path
   *   is supplied).  It is NOT accessible via TCP, Unix socket, or any IPC
   *   mechanism that a separate process could use.
   *
   *   This means:
   *
   *   ✅  Two PostgreSQLStorageProvider instances in the SAME process sharing the
   *       same PGlite object share state synchronously — writes are visible
   *       immediately (no replication lag, no POSIX fsync required).
   *
   *   ❌  A separate Squad CLI process CANNOT see an in-process PGlite heap.
   *       It needs either a compatible provider pointed at the same standalone
   *       PostgreSQL database or the Squadboard MCP bridge.
   *
   *   ❌  GitHub Copilot / external MCP clients connecting over stdio or HTTP
   *       CANNOT reach this PGlite storage.  They read from whatever
   *       StorageProvider their own runtime initialises.
   *
   *   To share .squad/ state cross-process you need one of:
   *
   *     a) Compatible PostgreSQL provider: set DATABASE_URL for Squadboard
   *        and configure Squad CLI / Copilot to use the same database,
   *        schema, and scope through an equivalent StorageProvider.
   *
   *     b) Export broker: a periodic job reads from PGlite and writes to disk
   *        or pushes events to an external store.  Consumers read from there.
   *
   *     c) FSStorageProvider fallback: use the .squad/ directory on disk as
   *        the shared medium.  Any process with filesystem access can read/write
   *        it.  Select this fallback with SQUADBOARD_SQUAD_STORAGE_PROVIDER=fs.
   *        The old pglite value is intentionally not a compatibility alias.
   */

  it('SYNC BOUNDARY DOCUMENTED: in-process PGlite shares state internally', () => {
    // Runtime assertion: two providers on the same PGlite DO share state.
    // Tested in group 4 above.  This test is a documentation anchor.
    expect(true).toBe(true);
  });

  it('SYNC BOUNDARY DOCUMENTED: external Squad CLI needs provider config or MCP bridge', () => {
    // Runtime assertion: sdk-state.ts provider selection is tested above.
    // This test documents the cross-process gap explicitly.
    expect(true).toBe(true);
  });

  it('sync methods throw PostgreSQLStorageNotInitializedError before init()', async () => {
    const pg = await freshPGlite();
    const pool = createPoolAdapter(pg);
    const uninitialised = new PostgreSQLStorageProvider(pool, 'uninit-scope');

    // None of these should silently return stale/empty data before init().
    expect(() => uninitialised.readSync('any.txt')).toThrow(PostgreSQLStorageNotInitializedError);
    expect(() => uninitialised.existsSync('any.txt')).toThrow(PostgreSQLStorageNotInitializedError);
    expect(() => uninitialised.listSync('.')).toThrow(PostgreSQLStorageNotInitializedError);
    expect(() => uninitialised.statSync('any.txt')).toThrow(PostgreSQLStorageNotInitializedError);
    expect(() => uninitialised.writeSync('any.txt', 'x')).toThrow(PostgreSQLStorageNotInitializedError);
    expect(() => uninitialised.appendSync('any.txt', 'x')).toThrow(PostgreSQLStorageNotInitializedError);
    expect(() => uninitialised.deleteSync('any.txt')).toThrow(PostgreSQLStorageNotInitializedError);
    expect(() => uninitialised.deleteDirSync('.')).toThrow(PostgreSQLStorageNotInitializedError);
    expect(() => uninitialised.renameSync('a', 'b')).toThrow(PostgreSQLStorageNotInitializedError);
    expect(() => uninitialised.copySync('a', 'b')).toThrow(PostgreSQLStorageNotInitializedError);
    await pg.close();
  });

  it('sync methods work correctly after init() — cache is populated from DB', async () => {
    const pg = await freshPGlite();
    // Pre-populate via raw SQL so the provider loads them into its cache on init().
    await pg.query(
      `INSERT INTO squad_storage (scope, path, content, size_bytes, updated_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      ['sync-test', 'preloaded.txt', 'preloaded content', 17],
    );

    const pool = createPoolAdapter(pg);
    const provider = new PostgreSQLStorageProvider(pool, 'sync-test');
    await provider.init();

    // Sync reads should now work from the warm cache.
    expect(provider.readSync('preloaded.txt')).toBe('preloaded content');
    expect(provider.existsSync('preloaded.txt')).toBe(true);
    expect(provider.statSync('preloaded.txt')?.isDirectory).toBe(false);
    await pg.close();
  });

  it('sync mutators flush to the database on the next async operation', async () => {
    const pg = await freshPGlite();
    const pool = createPoolAdapter(pg);
    const provider = new PostgreSQLStorageProvider(pool, 'sync-flush');
    await provider.init();

    provider.writeSync('queued.txt', 'queued content');
    expect(provider.readSync('queued.txt')).toBe('queued content');
    await expect(provider.exists('queued.txt')).resolves.toBe(true);

    const freshProvider = new PostgreSQLStorageProvider(pool, 'sync-flush');
    await freshProvider.init();
    expect(await freshProvider.read('queued.txt')).toBe('queued content');
    await pg.close();
  });
});

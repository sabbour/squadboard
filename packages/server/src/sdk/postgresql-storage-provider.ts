/**
 * postgresql-storage-provider.ts — Squad SDK StorageProvider backed by Squadboard's PostgreSQL DB.
 *
 * Implements the full `StorageProvider` contract from `@bradygaster/squad-sdk/storage`
 * over the `squad_storage` table in the same Postgres-compatible database that
 * backs Squadboard (PGlite locally, or hosted Postgres via DATABASE_URL).
 *
 * ## Design choices
 *
 * ### Scope
 * Every row is keyed by `(scope, path)`. The `scope` is a project-id (UUID)
 * supplied at construction time, so multiple projects never collide inside the
 * shared `squad_storage` table. Paths are normalized to keys relative to the
 * project `.squad/` root.
 *
 * ### Sync-method strategy
 * The Squad SDK `StorageProvider` interface includes a full set of deprecated
 * synchronous methods (`readSync`, `writeSync`, …) that existed to support
 * synchronous call sites before the async API was available.  The common
 * PostgreSQL pool API is async-only — there is no synchronous query path.
 *
 * To satisfy the interface without lying: this provider maintains an
 * **in-memory compatibility cache** (a `Map<path, content>`). After `init()`
 * is called the cache is pre-populated from the database. Every subsequent
 * async write/delete also updates the cache. Deprecated sync mutators update
 * the cache immediately and queue their database writes to be flushed by the
 * next async operation. Current SquadState call sites use the async API; the
 * sync path exists only for interface compatibility.
 *
 * If a sync method is called before `init()` completes it throws a
 * `PostgreSQLStorageNotInitializedError` rather than silently returning stale data.
 *
 * ### "Virtual directory" model
 * There are no explicit directory rows.  A path is a directory if other stored
 * paths start with `<path>/`.  `mkdir` and `mkdirSync` are no-ops (directories
 * are implicit, exactly as in `InMemoryStorageProvider` and `SQLiteStorageProvider`).
 *
 * ### Database runtime
 * The provider uses Squadboard's existing PoolLike handle. In local installs
 * that handle is backed by in-process PGlite; when DATABASE_URL is set it is
 * backed by standalone PostgreSQL through pg.Pool. The StorageProvider contract
 * and `squad_storage` schema stay identical in both modes.
 *
 * ### Shared-state boundary
 * Local PGlite has no cross-process SQL endpoint. Squad CLI, Copilot CLI, or
 * other external tools share this state only when they use a compatible
 * PostgreSQL StorageProvider against the same hosted database and scope, or
 * when they route reads/writes through the Squadboard MCP/API broker.
 *
 * @module sdk/postgresql-storage-provider
 */

import { posix } from 'node:path';
import type { StorageProvider, StorageStats } from '@bradygaster/squad-sdk/storage';
import type { PoolLike } from '../db/pglite.js';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class PostgreSQLStorageNotInitializedError extends Error {
  constructor() {
    super(
      'PostgreSQLStorageProvider is not initialized. Call init() before using sync methods.',
    );
    this.name = 'PostgreSQLStorageNotInitializedError';
  }
}

/**
 * Thrown when a caller supplies a path that the provider refuses to store:
 *   - Absolute paths (`/etc/passwd`, `C:\\Windows\\...`)
 *   - Paths whose normalized form contains `..` traversal segments
 *
 * Rationale: while PostgreSQL storage itself is never the filesystem, any
 * future export/hydration step (PostgreSQL → FSStorageProvider) would inherit the
 * path as-is.  Rejecting at write-time avoids the deferred directory-traversal
 * attack surface and keeps the stored keys safe to use as relative file paths.
 */
export class PostgreSQLStoragePathError extends Error {
  readonly path: string;
  constructor(path: string, reason: string) {
    super(`PostgreSQLStorageProvider: rejected path "${path}" — ${reason}`);
    this.name = 'PostgreSQLStoragePathError';
    this.path = path;
  }
}

export interface PostgreSQLStorageProviderOptions {
  /**
   * Project root whose `.squad/` directory backs this provider.
   * When provided, absolute SDK paths under `${rootDir}/.squad` are converted
   * into database-relative keys. Absolute paths outside that root are rejected.
   */
  rootDir?: string;
}

// ---------------------------------------------------------------------------
// Internal row type returned by SQL queries
// ---------------------------------------------------------------------------

interface StorageRow extends Record<string, unknown> {
  path: string;
  content: string;
  size_bytes: string | number; // Driver-dependent BIGINT representation.
  updated_at: string | Date;
}

type PendingMutation =
  | { type: 'upsert'; key: string; content: string }
  | { type: 'delete'; key: string }
  | { type: 'deletePrefix'; key: string }
  | { type: 'rename'; oldKey: string; newKey: string }
  | { type: 'copy'; srcKey: string; destKey: string };

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class PostgreSQLStorageProvider implements StorageProvider {
  private readonly pool: PoolLike;
  private readonly scope: string;
  private readonly rootDir: string | null;
  private readonly squadRootDir: string | null;

  /** Compatibility cache that powers the deprecated sync API. */
  private cache: Map<string, string> | null = null;
  /** Mtime map keyed by normalized path (epoch ms). */
  private mtimes: Map<string, number> = new Map();
  /** Sync mutators queue DB work here because the database pool has no sync query path. */
  private pendingMutations: PendingMutation[] = [];

  private initPromise: Promise<void> | null = null;

  /**
   * @param pool  - the PoolLike adapter wrapping the live database connection.
   * @param scope - project UUID (or any opaque string) that namespaces all paths.
   */
  constructor(pool: PoolLike, scope: string, options: PostgreSQLStorageProviderOptions = {}) {
    if (!pool || typeof pool.query !== 'function') {
      throw new TypeError('PostgreSQLStorageProvider requires a PoolLike with query().');
    }
    this.pool = pool;
    this.scope = scope;
    this.rootDir = options.rootDir ? this.normalizeRootDir(options.rootDir) : null;
    this.squadRootDir = this.rootDir ? `${this.rootDir}/.squad` : null;
  }

  // ── Initialization ─────────────────────────────────────────────────────────

  /**
   * Warm the write-through cache from the DB.
   * Must be called before any sync method is used.
   * Safe to call multiple times — subsequent calls return the same promise.
   */
  async init(): Promise<void> {
    if (this.cache !== null) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    const result = await this.pool.query<StorageRow>(
      'SELECT path, content, updated_at FROM squad_storage WHERE scope = $1',
      [this.scope],
    );
    this.cache = new Map();
    for (const row of result.rows) {
      this.cache.set(row.path, row.content);
      this.mtimes.set(row.path, row.updated_at ? new Date(row.updated_at).getTime() : Date.now());
    }
  }

  /** Throws if init() has not completed. Used by sync methods. */
  private ensureCache(): Map<string, string> {
    if (this.cache === null) throw new PostgreSQLStorageNotInitializedError();
    return this.cache;
  }

  /** Ensure the DB is ready for async methods (auto-init). */
  private async ready(): Promise<void> {
    if (this.cache !== null) return;
    await this.init();
  }

  // ── Path helpers ──────────────────────────────────────────────────────────

  /** Normalize a configured project root to forward-slash POSIX form. */
  private normalizeRootDir(rootDir: string): string {
    const normalized = posix.normalize(rootDir.replace(/\\/g, '/')).replace(/\/+$/, '');
    if (!posix.isAbsolute(normalized)) {
      throw new PostgreSQLStoragePathError(rootDir, 'rootDir must be absolute');
    }
    return normalized === '' ? '/' : normalized;
  }

  /** Normalize a caller path into a DB key relative to the project `.squad/` root. */
  private norm(p: string): string {
    const normalized = posix.normalize(p.replace(/\\/g, '/'));
    const withoutTrailing = normalized === '/' ? normalized : normalized.replace(/\/+$/, '');

    let key: string;
    if (posix.isAbsolute(withoutTrailing)) {
      if (!this.squadRootDir) {
        throw new PostgreSQLStoragePathError(p, 'absolute paths require a configured project root');
      }
      if (withoutTrailing === this.squadRootDir) {
        return '';
      }
      if (!withoutTrailing.startsWith(`${this.squadRootDir}/`)) {
        throw new PostgreSQLStoragePathError(p, 'absolute path must stay under the project .squad directory');
      }
      key = withoutTrailing.slice(this.squadRootDir.length + 1);
    } else {
      key = withoutTrailing;
      if (key === '.' || key === '.squad') {
        return '';
      }
      if (key.startsWith('.squad/')) {
        key = key.slice('.squad/'.length);
      }
    }

    if (key === '' || key === '.') {
      return '';
    }

    if (key.split('/').some((part) => part === '..')) {
      throw new PostgreSQLStoragePathError(p, 'path traversal is not allowed');
    }

    return key;
  }

  /**
   * Normalize `p` and reject unsafe paths.
   *
   * Throws `PostgreSQLStoragePathError` for traversal paths and for absolute paths
   * that do not live under the configured project `.squad/` root.
   *
   * Callers: every public method that accepts a user-supplied path must call
   * this instead of `norm()` directly.
   */
  private validateAndNorm(p: string): string {
    const normalized = this.norm(p);
    if (posix.isAbsolute(normalized)) {
      throw new PostgreSQLStoragePathError(p, 'absolute paths are not allowed');
    }
    if (normalized === '..' || normalized.startsWith('../')) {
      throw new PostgreSQLStoragePathError(p, 'path traversal (../) is not allowed');
    }
    return normalized;
  }

  /** Return the current ISO timestamp. */
  private now(): string {
    return new Date().toISOString();
  }

  // ── Internal cache + DB write ─────────────────────────────────────────────

  private cacheSet(key: string, content: string): void {
    this.cache?.set(key, content);
    this.mtimes.set(key, Date.now());
  }

  private cacheDel(key: string): void {
    this.cache?.delete(key);
    this.mtimes.delete(key);
  }

  private cacheDelPrefix(prefix: string): void {
    if (prefix === '') {
      this.cache?.clear();
      this.mtimes.clear();
      return;
    }
    const dirPrefix = prefix + '/';
    for (const key of [...(this.cache?.keys() ?? [])]) {
      if (key === prefix || key.startsWith(dirPrefix)) {
        this.cache?.delete(key);
        this.mtimes.delete(key);
      }
    }
  }

  private async dbUpsert(key: string, content: string): Promise<void> {
    const ts = this.now();
    await this.pool.query(
      `INSERT INTO squad_storage (scope, path, content, size_bytes, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (scope, path)
       DO UPDATE SET content = EXCLUDED.content,
                     size_bytes = EXCLUDED.size_bytes,
                     updated_at = EXCLUDED.updated_at`,
      [this.scope, key, content, Buffer.byteLength(content, 'utf8'), ts],
    );
    this.cacheSet(key, content);
  }

  private async dbDelete(key: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM squad_storage WHERE scope = $1 AND path = $2',
      [this.scope, key],
    );
    this.cacheDel(key);
  }

  private async dbDeletePrefix(key: string): Promise<void> {
    if (key === '') {
      await this.pool.query('DELETE FROM squad_storage WHERE scope = $1', [this.scope]);
      this.cacheDelPrefix(key);
      return;
    }
    // Delete exact match OR anything under key/
    await this.pool.query(
      `DELETE FROM squad_storage
       WHERE scope = $1 AND (path = $2 OR path LIKE $3 ESCAPE '\\')`,
      [this.scope, key, this.escapeLike(key) + '/%'],
    );
    this.cacheDelPrefix(key);
  }

  /** Escape PostgreSQL LIKE wildcards in user-supplied path strings. */
  private escapeLike(value: string): string {
    return value.replace(/[%_\\]/g, (c) => `\\${c}`);
  }

  private queue(mutation: PendingMutation): void {
    this.pendingMutations.push(mutation);
  }

  private async flushPending(): Promise<void> {
    if (this.pendingMutations.length === 0) return;
    const mutations = this.pendingMutations;
    this.pendingMutations = [];

    for (const mutation of mutations) {
      switch (mutation.type) {
        case 'upsert':
          await this.dbUpsert(mutation.key, mutation.content);
          break;
        case 'delete':
          await this.dbDelete(mutation.key);
          break;
        case 'deletePrefix':
          await this.dbDeletePrefix(mutation.key);
          break;
        case 'rename':
          await this.renameDbRows(mutation.oldKey, mutation.newKey);
          break;
        case 'copy':
          await this.copyDbRow(mutation.srcKey, mutation.destKey);
          break;
      }
    }
  }

  private async rowsUnder(key: string): Promise<StorageRow[]> {
    if (key === '') {
      const result = await this.pool.query<StorageRow>(
        'SELECT path, content, updated_at FROM squad_storage WHERE scope = $1',
        [this.scope],
      );
      return result.rows;
    }

    const result = await this.pool.query<StorageRow>(
      `SELECT path, content, updated_at FROM squad_storage
       WHERE scope = $1 AND (path = $2 OR path LIKE $3 ESCAPE '\\')`,
      [this.scope, key, this.escapeLike(key) + '/%'],
    );
    return result.rows;
  }

  private async renameDbRows(oldKey: string, newKey: string): Promise<void> {
    const rows = await this.rowsUnder(oldKey);
    if (rows.length === 0) {
      throw new Error(`PostgreSQLStorageProvider.rename: source does not exist: ${oldKey}`);
    }

    await this.dbDeletePrefix(oldKey);
    for (const row of rows) {
      const newRowKey =
        oldKey === '' ? posix.join(newKey, row.path) : newKey + row.path.slice(oldKey.length);
      await this.dbUpsert(newRowKey, row.content);
    }
  }

  private async copyDbRow(srcKey: string, destKey: string): Promise<void> {
    const result = await this.pool.query<StorageRow>(
      `SELECT path, content FROM squad_storage
       WHERE scope = $1 AND path = $2`,
      [this.scope, srcKey],
    );

    if (result.rows.length === 0) {
      throw new Error(`PostgreSQLStorageProvider.copy: source does not exist: ${srcKey}`);
    }

    await this.dbUpsert(destKey, result.rows[0].content);
  }

  // ── Async interface ────────────────────────────────────────────────────────

  async read(filePath: string): Promise<string | undefined> {
    await this.ready();
    await this.flushPending();
    return this.readSync(filePath);
  }

  async write(filePath: string, data: string): Promise<void> {
    await this.ready();
    await this.flushPending();
    const key = this.validateAndNorm(filePath);
    await this.dbUpsert(key, data);
  }

  async append(filePath: string, data: string): Promise<void> {
    await this.ready();
    await this.flushPending();
    const key = this.validateAndNorm(filePath);
    const existing = this.readSync(filePath) ?? '';
    await this.dbUpsert(key, existing + data);
  }

  async exists(filePath: string): Promise<boolean> {
    await this.ready();
    await this.flushPending();
    return this.existsSync(filePath);
  }

  async list(dirPath: string): Promise<string[]> {
    await this.ready();
    await this.flushPending();
    return this.listSync(dirPath);
  }

  async delete(filePath: string): Promise<void> {
    await this.ready();
    await this.flushPending();
    const key = this.validateAndNorm(filePath);
    await this.dbDelete(key);
  }

  async deleteDir(dirPath: string): Promise<void> {
    await this.ready();
    await this.flushPending();
    const key = this.validateAndNorm(dirPath);
    await this.dbDeletePrefix(key);
  }

  async isDirectory(targetPath: string): Promise<boolean> {
    await this.ready();
    await this.flushPending();
    return this.isDirectorySync(targetPath);
  }

  async mkdir(_dirPath: string, _options?: { recursive?: boolean }): Promise<void> {
    // Directories are implicit — no-op, same as SQLiteStorageProvider.
    await this.ready();
    await this.flushPending();
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.ready();
    await this.flushPending();
    const oldKey = this.validateAndNorm(oldPath);
    const newKey = this.validateAndNorm(newPath);
    await this.renameDbRows(oldKey, newKey);
  }

  async copy(srcPath: string, destPath: string): Promise<void> {
    await this.ready();
    await this.flushPending();
    const srcKey = this.validateAndNorm(srcPath);
    const destKey = this.validateAndNorm(destPath);
    await this.copyDbRow(srcKey, destKey);
  }

  async stat(targetPath: string): Promise<StorageStats | undefined> {
    await this.ready();
    await this.flushPending();
    return this.statSync(targetPath);
  }

  // ── Sync interface (write-through cache) ──────────────────────────────────

  readSync(filePath: string): string | undefined {
    const cache = this.ensureCache();
    const key = this.validateAndNorm(filePath);
    return cache.get(key);
  }

  writeSync(filePath: string, data: string): void {
    // Verify initialised first — a silent no-op before init() would silently
    // drop writes, which is worse than an explicit error.
    this.ensureCache();
    const key = this.validateAndNorm(filePath);
    this.cacheSet(key, data);
    this.queue({ type: 'upsert', key, content: data });
  }

  existsSync(filePath: string): boolean {
    const cache = this.ensureCache();
    const key = this.validateAndNorm(filePath);
    if (key === '') return true;
    if (cache.has(key)) return true;
    const prefix = key + '/';
    for (const k of cache.keys()) {
      if (k.startsWith(prefix)) return true;
    }
    return false;
  }

  listSync(dirPath: string): string[] {
    const cache = this.ensureCache();
    const dir = this.validateAndNorm(dirPath);
    const prefix = dir === '' ? '' : dir + '/';
    const entries = new Set<string>();
    for (const k of cache.keys()) {
      if (dir === '' || k.startsWith(prefix)) {
        const rest = k.slice(prefix.length);
        const name = rest.split('/')[0];
        if (name) entries.add(name);
      }
    }
    return [...entries];
  }

  isDirectorySync(targetPath: string): boolean {
    const cache = this.ensureCache();
    const key = this.validateAndNorm(targetPath);
    if (key === '') return true;
    if (cache.has(key)) return false;
    // A path is a directory if any stored key starts with key + '/'
    const prefix = key + '/';
    for (const k of cache.keys()) {
      if (k.startsWith(prefix)) return true;
    }
    return false;
  }

  mkdirSync(_dirPath: string, _options?: { recursive?: boolean }): void {
    this.ensureCache(); // verify initialized
    // no-op — directories are implicit
  }

  statSync(targetPath: string): StorageStats | undefined {
    const cache = this.ensureCache();
    const key = this.validateAndNorm(targetPath);

    if (key === '') {
      let newestMtime = 0;
      for (const mtime of this.mtimes.values()) {
        if (mtime > newestMtime) newestMtime = mtime;
      }
      return { size: 0, mtimeMs: newestMtime, isDirectory: true };
    }

    // File?
    if (cache.has(key)) {
      const content = cache.get(key)!;
      return {
        size: Buffer.byteLength(content, 'utf8'),
        mtimeMs: this.mtimes.get(key) ?? Date.now(),
        isDirectory: false,
      };
    }

    // Directory?
    const prefix = key + '/';
    let isDir = false;
    let newestMtime = 0;
    for (const k of cache.keys()) {
      if (k.startsWith(prefix)) {
        isDir = true;
        const mtime = this.mtimes.get(k) ?? 0;
        if (mtime > newestMtime) newestMtime = mtime;
      }
    }
    if (isDir) {
      return { size: 0, mtimeMs: newestMtime, isDirectory: true };
    }

    return undefined;
  }

  appendSync(filePath: string, data: string): void {
    const existing = this.readSync(filePath) ?? '';
    this.writeSync(filePath, existing + data);
  }

  deleteSync(filePath: string): void {
    this.ensureCache();
    const key = this.validateAndNorm(filePath);
    this.cacheDel(key);
    this.queue({ type: 'delete', key });
  }

  renameSync(oldPath: string, newPath: string): void {
    const cache = this.ensureCache();
    const oldKey = this.validateAndNorm(oldPath);
    const newKey = this.validateAndNorm(newPath);
    const entries: [string, string][] = [];
    const prefix = oldKey + '/';
    for (const [k, v] of cache.entries()) {
      if (k === oldKey || k.startsWith(prefix)) {
        entries.push([k, v]);
      }
    }
    if (entries.length === 0) {
      throw new Error(`PostgreSQLStorageProvider.renameSync: source does not exist: ${oldPath}`);
    }
    for (const [k, v] of entries) {
      const newK = oldKey === '' ? posix.join(newKey, k) : newKey + k.slice(oldKey.length);
      this.cacheSet(newK, v);
      this.cacheDel(k);
    }
    this.queue({ type: 'rename', oldKey, newKey });
  }

  copySync(srcPath: string, destPath: string): void {
    const content = this.readSync(srcPath);
    if (content === undefined) {
      throw new Error(`PostgreSQLStorageProvider.copySync: source does not exist: ${srcPath}`);
    }
    const srcKey = this.validateAndNorm(srcPath);
    const destKey = this.validateAndNorm(destPath);
    this.cacheSet(destKey, content);
    this.queue({ type: 'copy', srcKey, destKey });
  }

  deleteDirSync(dirPath: string): void {
    const cache = this.ensureCache();
    const key = this.validateAndNorm(dirPath);
    if (key === '') {
      cache.clear();
      this.mtimes.clear();
      this.queue({ type: 'deletePrefix', key });
      return;
    }
    const prefix = key + '/';
    for (const k of [...cache.keys()]) {
      if (k === key || k.startsWith(prefix)) {
        this.cacheDel(k);
      }
    }
    this.queue({ type: 'deletePrefix', key });
  }
}

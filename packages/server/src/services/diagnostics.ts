/**
 * services/diagnostics.ts — Phase 3 Doctor
 *
 * `runDiagnostics()` runs a battery of health checks against server-wide and
 * optionally project-scoped resources. Every check is wrapped in try/catch so
 * one failure never stops the rest. All results are always returned.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, writeFile, readFile, unlink, mkdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getPool, getDb, schema } from '../db/index.js';
import { getWebSocketServer } from '../realtime/ws-server.js';
import {
  getBuiltinBundles,
  getBuiltinBundleWarnings,
  getBuiltinBundleScanError,
  resetBuiltinBundleCache,
} from './builtin-bundles.js';

const execFileAsync = promisify(execFile);

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DiagnosticResult {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'fail';
  detail?: string;
  remediation?: string;
  durationMs: number;
}

export interface DiagnosticsOptions {
  projectId?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, durationMs: Date.now() - start };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms),
    ),
  ]);
}

/**
 * Resolve a stored `projects.path` to the actual `.squad/` directory on disk.
 *
 * Historical inconsistency in how the path is stored:
 *   - Some projects store the **project root** (parent of `.squad/`).
 *   - Some projects store the **`.squad/` directory itself** (e.g. the `foo`
 *     repo, where `path = /…/foo/.squad`).
 *
 * The schema comment claims "path to .squad/ directory" while several
 * services (sdk-state, project-squad) treat it as the .squad/ dir directly.
 * Diagnostics used to blindly `join(path, '.squad')`, which double-nested
 * for the second convention and made every collection check fail.
 *
 * This resolver is tolerant of both layouts:
 *   1. Resolve to absolute (so a relative `projects.path` doesn't pivot off
 *      the server's CWD silently).
 *   2. If `basename === '.squad'` AND that dir exists → use as-is.
 *   3. Else if `<path>/.squad/` exists → use that.
 *   4. Else → return `{ ok: false, reason }` so the caller can surface ONE
 *      clear "project path is wrong" diagnostic instead of N cascading
 *      "missing collection" errors.
 */
export interface ResolvedSquadDir {
  ok: true;
  /** Absolute path to the project root (parent of `.squad/`). */
  projectRoot: string;
  /** Absolute path to the `.squad/` directory. */
  squadDir: string;
  /** Whether `projects.path` itself pointed at `.squad/` (vs the parent). */
  storedAsSquadDir: boolean;
}

export interface UnresolvedSquadDir {
  ok: false;
  /** Absolute path we resolved `projects.path` to. */
  resolvedPath: string;
  /** Human-readable reason the squad dir could not be located. */
  reason: string;
}

export async function resolveSquadDir(
  storedPath: string,
): Promise<ResolvedSquadDir | UnresolvedSquadDir> {
  const absolute = isAbsolute(storedPath) ? storedPath : resolve(storedPath);

  let exists = false;
  let isDir = false;
  try {
    const st = await stat(absolute);
    exists = true;
    isDir = st.isDirectory();
  } catch {
    /* fall through */
  }

  if (!exists) {
    return {
      ok: false,
      resolvedPath: absolute,
      reason: `project path does not exist: ${absolute}`,
    };
  }
  if (!isDir) {
    return {
      ok: false,
      resolvedPath: absolute,
      reason: `project path is not a directory: ${absolute}`,
    };
  }

  // Convention A: stored path IS the .squad/ directory itself.
  if (basename(absolute) === '.squad') {
    return {
      ok: true,
      projectRoot: resolve(absolute, '..'),
      squadDir: absolute,
      storedAsSquadDir: true,
    };
  }

  // Convention B: stored path is the project root; .squad/ lives under it.
  const nested = join(absolute, '.squad');
  try {
    const st = await stat(nested);
    if (st.isDirectory()) {
      return {
        ok: true,
        projectRoot: absolute,
        squadDir: nested,
        storedAsSquadDir: false,
      };
    }
  } catch {
    /* fall through */
  }

  return {
    ok: false,
    resolvedPath: absolute,
    reason: `no .squad/ directory found at ${absolute} or ${nested}`,
  };
}

// ─── Individual checks ────────────────────────────────────────────────────────

async function checkSdkClient(): Promise<DiagnosticResult> {
  const start = Date.now();
  try {
    const token = process.env.GITHUB_TOKEN ?? process.env.SQUADBOARD_GITHUB_TOKEN;
    const { SquadClient } = await import('@bradygaster/squad-sdk/client');
    const client = new SquadClient({
      ...(token ? { githubToken: token } : { useLoggedInUser: true }),
      cwd: process.cwd(),
    });
    await withTimeout(client.connect(), 10_000);
    await client.disconnect().catch(() => {});
    return {
      id: 'sdk.client',
      label: 'SDK client reachable',
      status: 'ok',
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      id: 'sdk.client',
      label: 'SDK client reachable',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
      remediation: 'Run squad doctor or check API keys',
      durationMs: Date.now() - start,
    };
  }
}

async function checkSdkModels(): Promise<DiagnosticResult> {
  const start = Date.now();
  try {
    const token = process.env.GITHUB_TOKEN ?? process.env.SQUADBOARD_GITHUB_TOKEN;
    const { SquadClient } = await import('@bradygaster/squad-sdk/client');
    const client = new SquadClient({
      ...(token ? { githubToken: token } : { useLoggedInUser: true }),
      cwd: process.cwd(),
    });
    await withTimeout(client.connect(), 10_000);
    let models: unknown[];
    try {
      models = (await withTimeout(client.listModels(), 10_000)) as unknown[];
    } finally {
      await client.disconnect().catch(() => {});
    }
    const count = Array.isArray(models) ? models.length : 0;
    return {
      id: 'sdk.models',
      label: 'SDK model list non-empty',
      status: count > 0 ? 'ok' : 'warn',
      detail: count > 0 ? `${count} model(s) available` : 'No models returned from SDK',
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      id: 'sdk.models',
      label: 'SDK model list non-empty',
      status: 'warn',
      detail: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

async function checkGitHubAuth(): Promise<DiagnosticResult> {
  const start = Date.now();
  try {
    await execFileAsync('gh', ['auth', 'status'], { timeout: 8_000 });
    return {
      id: 'github.auth',
      label: 'GitHub CLI authenticated',
      status: 'ok',
      detail: 'gh auth status succeeded',
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // gh not installed or not authed — warn, not fatal (local-first is fine)
    return {
      id: 'github.auth',
      label: 'GitHub CLI authenticated',
      status: 'warn',
      detail: msg.includes('not found') || msg.includes('ENOENT')
        ? 'gh CLI not found — GitHub sync features will be unavailable'
        : 'gh auth status failed — GitHub sync features may be unavailable',
      durationMs: Date.now() - start,
    };
  }
}

async function checkSquadDirShape(projectId: string): Promise<DiagnosticResult> {
  const start = Date.now();
  try {
    // Look up the project path from the DB
    const db = getDb();
    const rows = await db
      .select({ path: schema.projects.path })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId));

    if (rows.length === 0) {
      return {
        id: 'squad_dir.shape',
        label: '.squad/ directory shape',
        status: 'warn',
        detail: `Project ${projectId} not found in database`,
        durationMs: Date.now() - start,
      };
    }

    const projectPath = rows[0]!.path;
    const resolved = await resolveSquadDir(projectPath);

    // Single clear failure when the registered project path itself is wrong.
    // Cascading "missing collection" errors mask the actual problem.
    if (!resolved.ok) {
      return {
        id: 'squad_dir.shape',
        label: '.squad/ directory shape',
        status: 'fail',
        detail: `${resolved.reason} (projects.path = "${projectPath}")`,
        remediation:
          'Update the project record so `path` points to either the project root (containing .squad/) or the .squad/ directory itself.',
        durationMs: Date.now() - start,
      };
    }

    const { squadDir } = resolved;
    const requiredCollections = ['agents', 'log'];
    const requiredFiles = ['routing.md', 'decisions.md'];
    const issues: string[] = [];

    for (const dir of requiredCollections) {
      try {
        await access(join(squadDir, dir), constants.F_OK);
      } catch {
        issues.push(`missing directory: .squad/${dir}/`);
      }
    }

    for (const file of requiredFiles) {
      try {
        await access(join(squadDir, file), constants.F_OK);
      } catch {
        issues.push(`missing file: .squad/${file}`);
      }
    }

    if (issues.length > 0) {
      return {
        id: 'squad_dir.shape',
        label: '.squad/ directory shape',
        status: 'warn',
        detail: `${issues.join('; ')} (resolved squad dir: ${squadDir})`,
        durationMs: Date.now() - start,
      };
    }

    return {
      id: 'squad_dir.shape',
      label: '.squad/ directory shape',
      status: 'ok',
      detail: `All required .squad/ collections present at ${squadDir}`,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      id: 'squad_dir.shape',
      label: '.squad/ directory shape',
      status: 'warn',
      detail: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

async function checkPostgresHealth(): Promise<DiagnosticResult> {
  const start = Date.now();
  try {
    const pool = getPool();
    const client = await withTimeout(pool.connect(), 50);
    try {
      await withTimeout(client.query('SELECT 1'), 50);
    } finally {
      client.release();
    }
    return {
      id: 'postgres.health',
      label: 'Postgres reachable',
      status: 'ok',
      detail: 'SELECT 1 succeeded',
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      id: 'postgres.health',
      label: 'Postgres reachable',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
      remediation: 'Check DATABASE_URL',
      durationMs: Date.now() - start,
    };
  }
}

async function checkWebSocketHealth(): Promise<DiagnosticResult> {
  const start = Date.now();
  try {
    const wss = getWebSocketServer();
    if (!wss) {
      return {
        id: 'websocket.health',
        label: 'WebSocket server mounted',
        status: 'fail',
        detail: 'WebSocket server not initialised',
        durationMs: Date.now() - start,
      };
    }
    // WebSocketServer.readyState: OPEN = 1
    const ready = (wss as unknown as { readyState?: number }).readyState;
    if (ready !== undefined && ready !== 1) {
      return {
        id: 'websocket.health',
        label: 'WebSocket server mounted',
        status: 'warn',
        detail: `WebSocket server readyState=${ready}`,
        durationMs: Date.now() - start,
      };
    }
    return {
      id: 'websocket.health',
      label: 'WebSocket server mounted',
      status: 'ok',
      detail: `WebSocket server mounted (${wss.clients.size} connected client(s))`,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      id: 'websocket.health',
      label: 'WebSocket server mounted',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

async function checkMcpServers(projectId: string): Promise<DiagnosticResult> {
  const start = Date.now();
  try {
    const db = getDb();
    // Gracefully skip if the table doesn't exist yet (schema not bootstrapped)
    const rows = await db
      .select({
        id: schema.mcpServers.id,
        name: schema.mcpServers.name,
        url: schema.mcpServers.url,
      })
      .from(schema.mcpServers)
      .where(eq(schema.mcpServers.projectId, projectId));

    if (rows.length === 0) {
      return {
        id: 'mcp.servers',
        label: 'MCP servers reachable',
        status: 'ok',
        detail: 'No MCP servers registered for this project',
        durationMs: Date.now() - start,
      };
    }

    const unreachable: string[] = [];
    await Promise.allSettled(
      rows.map(async (row) => {
        if (!row.url) return;
        try {
          const res = await withTimeout(fetch(row.url), 5_000);
          if (!res.ok) unreachable.push(`${row.name} (HTTP ${res.status})`);
        } catch {
          unreachable.push(`${row.name} (unreachable)`);
        }
      }),
    );

    if (unreachable.length > 0) {
      return {
        id: 'mcp.servers',
        label: 'MCP servers reachable',
        status: 'warn',
        detail: `Unreachable: ${unreachable.join(', ')}`,
        durationMs: Date.now() - start,
      };
    }

    return {
      id: 'mcp.servers',
      label: 'MCP servers reachable',
      status: 'ok',
      detail: `${rows.length} MCP server(s) registered and reachable`,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    // Table might not exist — skip gracefully
    const msg = err instanceof Error ? err.message : String(err);
    const isTableMissing = msg.includes('does not exist') || msg.includes('relation');
    return {
      id: 'mcp.servers',
      label: 'MCP servers reachable',
      status: isTableMissing ? 'ok' : 'warn',
      detail: isTableMissing ? 'mcp_servers table not yet created — skipped' : msg,
      durationMs: Date.now() - start,
    };
  }
}

async function checkMcpServersGlobal(): Promise<DiagnosticResult> {
  const start = Date.now();
  return {
    id: 'mcp.servers',
    label: 'MCP servers reachable',
    status: 'ok',
    detail: 'Provide a projectId to check project-scoped MCP servers',
    durationMs: Date.now() - start,
  };
}

async function checkDiskWriteable(projectId?: string): Promise<DiagnosticResult> {
  const start = Date.now();
  const targets: Array<{ label: string; dir: string }> = [
    { label: '~/.squadboard/data', dir: join(homedir(), '.squadboard', 'data') },
  ];

  if (projectId) {
    try {
      const db = getDb();
      const rows = await db
        .select({ path: schema.projects.path })
        .from(schema.projects)
        .where(eq(schema.projects.id, projectId));
      if (rows.length > 0) {
        const resolved = await resolveSquadDir(rows[0]!.path);
        if (resolved.ok) {
          targets.push({ label: '.squad/', dir: resolved.squadDir });
        }
        // If resolution failed, skip the squad-dir target — checkSquadDirShape
        // will already surface the actionable error; no need to double-report.
      }
    } catch {
      // ignore — we still check the global target
    }
  }

  const failures: string[] = [];

  for (const target of targets) {
    const tmpFile = join(target.dir, `.diag-${randomUUID()}.tmp`);
    try {
      await mkdir(target.dir, { recursive: true });
      await writeFile(tmpFile, 'squadboard-diag');
      const contents = await readFile(tmpFile, 'utf8');
      if (contents !== 'squadboard-diag') {
        failures.push(`${target.label}: read-back mismatch`);
      }
      await unlink(tmpFile);
    } catch (err) {
      failures.push(
        `${target.label}: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Best-effort cleanup
      await unlink(tmpFile).catch(() => {});
    }
  }

  if (failures.length > 0) {
    return {
      id: 'disk.writeable',
      label: 'Disk writeable',
      status: 'fail',
      detail: failures.join('; '),
      remediation: 'Check directory permissions',
      durationMs: Date.now() - start,
    };
  }

  return {
    id: 'disk.writeable',
    label: 'Disk writeable',
    status: 'ok',
    detail: `Write/read/delete succeeded in: ${targets.map((t) => t.label).join(', ')}`,
    durationMs: Date.now() - start,
  };
}

// ─── Built-in bundles check ──────────────────────────────────────────────────

/**
 * Checks that all built-in project bundles pass structural validation.
 * Refreshes the cache on every diagnostics call so fresh edits to bundles/
 * are picked up without a server restart.
 * Never throws — returns 'warn' on partial failures, 'fail' if the bundles
 * directory is unreadable.
 */
async function checkBuiltinBundles(): Promise<DiagnosticResult> {
  const start = Date.now();

  // Reset to force a fresh scan so edits to bundle files are visible.
  resetBuiltinBundleCache();

  const entries = await getBuiltinBundles();
  const scanError = getBuiltinBundleScanError();
  const warnings = getBuiltinBundleWarnings();

  if (scanError) {
    return {
      id: 'builtin.bundles',
      label: 'Built-in project bundles',
      status: 'fail',
      detail: `Cannot scan bundles directory: ${scanError}`,
      durationMs: Date.now() - start,
    };
  }

  if (warnings.length > 0) {
    const detail = [
      `${entries.length} valid bundle(s); ${warnings.length} with errors:`,
      ...warnings.map((w) => `  • ${w.slug}: ${w.message}`),
    ].join('\n');
    return {
      id: 'builtin.bundles',
      label: 'Built-in project bundles',
      status: 'warn',
      detail,
      durationMs: Date.now() - start,
    };
  }

  return {
    id: 'builtin.bundles',
    label: 'Built-in project bundles',
    status: 'ok',
    detail: `${entries.length} bundle(s) valid: ${entries.map((e) => e.bundleId).join(', ')}`,
    durationMs: Date.now() - start,
  };
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function runDiagnostics(
  opts: DiagnosticsOptions = {},
): Promise<DiagnosticResult[]> {
  const { projectId } = opts;

  const checks: Array<() => Promise<DiagnosticResult>> = [
    checkSdkClient,
    checkSdkModels,
    checkGitHubAuth,
    ...(projectId ? [() => checkSquadDirShape(projectId)] : []),
    checkPostgresHealth,
    checkWebSocketHealth,
    ...(projectId ? [() => checkMcpServers(projectId)] : [() => checkMcpServersGlobal()]),
    () => checkDiskWriteable(projectId),
    checkBuiltinBundles,
  ];

  // Run all checks in parallel; each is already guarded by try/catch internally
  const results = await Promise.all(checks.map((fn) => fn().catch((err) => {
    // Belt-and-suspenders: should never reach here
    return {
      id: 'unknown',
      label: 'Unknown check',
      status: 'fail' as const,
      detail: err instanceof Error ? err.message : String(err),
      durationMs: 0,
    };
  })));

  return results;
}

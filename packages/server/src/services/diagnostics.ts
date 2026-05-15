/**
 * services/diagnostics.ts — Phase 3 Doctor
 *
 * `runDiagnostics()` runs a battery of health checks against server-wide and
 * optionally project-scoped resources. Every check is wrapped in try/catch so
 * one failure never stops the rest. All results are always returned.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, writeFile, readFile, unlink, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getPool, getDb, schema } from '../db/index.js';
import { getWebSocketServer } from '../realtime/ws-server.js';

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
    const squadDir = join(projectPath, '.squad');

    // Check .squad/ exists
    await access(squadDir, constants.F_OK);

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
        detail: issues.join('; '),
        durationMs: Date.now() - start,
      };
    }

    return {
      id: 'squad_dir.shape',
      label: '.squad/ directory shape',
      status: 'ok',
      detail: `All required .squad/ collections present at ${projectPath}`,
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
        targets.push({ label: '.squad/', dir: join(rows[0]!.path, '.squad') });
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

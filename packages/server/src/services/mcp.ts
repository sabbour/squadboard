/**
 * services/mcp.ts — Phase 13
 *
 * CRUD + per-agent assignment for project-scoped MCP servers, with
 * AES-256-GCM encryption of header values at rest. Headers are stored as
 * a JSON array of `{ name, cipher }` items in the `headers` column; a
 * single per-row IV + auth tag (in `headers_iv` / `headers_tag`) wraps
 * all header values together so the row is either fully decryptable or
 * not at all (no partial state).
 *
 * GET responses NEVER expose decrypted values — they return a
 * scrubbed view: `[{ name, hasSecret }]`. The encrypted blob is only
 * decrypted on demand by callers (e.g. an outbound HTTP client about to
 * dispatch a request to the MCP server). Logs always mask values via
 * `maskSecret()`.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import {
  decryptString,
  encryptString,
  getProjectSecretKey,
  maskSecret,
  type EncryptedEnvelope,
} from './secret-key.js';

export type McpTransport = 'http' | 'stdio';

export interface HeaderInput {
  name: string;
  value: string;
}

export interface ScrubbedHeader {
  name: string;
  hasSecret: boolean;
}

export interface CreateMcpServerInput {
  name: string;
  description?: string | null;
  transport: McpTransport;
  url?: string | null;
  command?: string | null;
  args?: string[];
  headers?: HeaderInput[];
  enabled?: boolean;
}

export interface UpdateMcpServerInput {
  name?: string;
  description?: string | null;
  transport?: McpTransport;
  url?: string | null;
  command?: string | null;
  args?: string[];
  headers?: HeaderInput[];
  enabled?: boolean;
}

interface StoredHeaderEntry { name: string }
interface StoredHeadersRow {
  headers: StoredHeaderEntry[];
  headersIv: string | null;
  headersTag: string | null;
  // Cipher only present when there is at least one header — we keep the
  // ciphertext blob alongside the names.
  cipher?: string | null;
}

interface RawMcpRow {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  transport: string;
  url: string | null;
  command: string | null;
  args: unknown;
  headers: unknown;
  headersIv: string | null;
  headersTag: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Header envelope helpers — encrypts/decrypts the array of header values
// as a single blob so we keep a single (iv, tag) pair per row.
// ---------------------------------------------------------------------------

interface HeaderEnvelopeStorage {
  // Public per-row metadata (stored verbatim in JSONB):
  names: StoredHeaderEntry[];
  // Single ciphertext over JSON.stringify(values[]):
  cipher: string | null;
  iv: string | null;
  tag: string | null;
}

async function buildEnvelope(projectId: string, headers: HeaderInput[]): Promise<HeaderEnvelopeStorage> {
  if (headers.length === 0) return { names: [], cipher: null, iv: null, tag: null };
  const key = await getProjectSecretKey(projectId);
  const plain = JSON.stringify(headers.map((h) => h.value));
  const env = encryptString(key, plain);
  return {
    names: headers.map((h) => ({ name: h.name })),
    cipher: env.cipher,
    iv: env.iv,
    tag: env.tag,
  };
}

/**
 * Read a row's headers and return the decrypted [{name, value}] array.
 * Throws if the row's stored envelope is corrupt or out of sync.
 */
export async function decryptHeaders(projectId: string, mcpServerId: string): Promise<HeaderInput[]> {
  const row = await rawGet(projectId, mcpServerId);
  if (!row) {
    const err = new Error('mcp server not found');
    (err as Error & { status?: number }).status = 404;
    throw err;
  }
  return decryptRowHeaders(projectId, row);
}

async function decryptRowHeaders(projectId: string, row: RawMcpRow): Promise<HeaderInput[]> {
  const stored = (row.headers as unknown) as { names?: StoredHeaderEntry[]; cipher?: string | null } | StoredHeaderEntry[] | null;
  if (!stored) return [];
  // Migration-friendly read: support both legacy bare-array and the new
  // {names, cipher} shape (we always write the new shape going forward).
  const names: StoredHeaderEntry[] = Array.isArray(stored)
    ? (stored as StoredHeaderEntry[])
    : (stored.names ?? []);
  const cipher: string | null = Array.isArray(stored) ? null : (stored.cipher ?? null);
  if (names.length === 0 || !cipher || !row.headersIv || !row.headersTag) return names.map((n) => ({ name: n.name, value: '' }));

  const key = await getProjectSecretKey(projectId);
  const env: EncryptedEnvelope = { cipher, iv: row.headersIv, tag: row.headersTag };
  const plain = decryptString(key, env);
  const values = JSON.parse(plain) as string[];
  return names.map((n, i) => ({ name: n.name, value: values[i] ?? '' }));
}

// ---------------------------------------------------------------------------
// Public API — never returns plaintext values.
// ---------------------------------------------------------------------------

export interface ScrubbedMcpServer {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  transport: McpTransport;
  url: string | null;
  command: string | null;
  args: string[];
  headers: ScrubbedHeader[];
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function scrub(row: RawMcpRow): ScrubbedMcpServer {
  const stored = row.headers as unknown as { names?: StoredHeaderEntry[]; cipher?: string | null } | StoredHeaderEntry[] | null;
  let names: StoredHeaderEntry[] = [];
  let hasCipher = false;
  if (Array.isArray(stored)) {
    names = stored as StoredHeaderEntry[];
  } else if (stored && stored.names) {
    names = stored.names;
    hasCipher = !!stored.cipher;
  }
  const args = Array.isArray(row.args) ? (row.args as string[]) : [];
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    transport: row.transport as McpTransport,
    url: row.url,
    command: row.command,
    args,
    headers: names.map((n) => ({ name: n.name, hasSecret: hasCipher })),
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function rawGet(projectId: string, mcpServerId: string): Promise<RawMcpRow | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.mcpServers)
    .where(and(eq(schema.mcpServers.projectId, projectId), eq(schema.mcpServers.id, mcpServerId)))
    .limit(1);
  return (rows[0] as unknown as RawMcpRow) ?? null;
}

export async function listMcpServers(projectId: string): Promise<ScrubbedMcpServer[]> {
  const db = getDb();
  const rows = (await db
    .select()
    .from(schema.mcpServers)
    .where(eq(schema.mcpServers.projectId, projectId))
    .orderBy(schema.mcpServers.name)) as unknown as RawMcpRow[];
  return rows.map(scrub);
}

export async function getMcpServer(projectId: string, mcpServerId: string): Promise<ScrubbedMcpServer | null> {
  const row = await rawGet(projectId, mcpServerId);
  return row ? scrub(row) : null;
}

function validateInput(input: { transport?: McpTransport; url?: string | null; command?: string | null }): void {
  if (input.transport === 'http' && !input.url) {
    throw Object.assign(new Error('http transport requires url'), { status: 400 });
  }
  if (input.transport === 'stdio' && !input.command) {
    throw Object.assign(new Error('stdio transport requires command'), { status: 400 });
  }
}

export async function createMcpServer(projectId: string, input: CreateMcpServerInput): Promise<ScrubbedMcpServer> {
  validateInput(input);
  const env = await buildEnvelope(projectId, input.headers ?? []);
  const db = getDb();
  const headersStored = { names: env.names, cipher: env.cipher } as unknown as object;
  const [row] = (await db
    .insert(schema.mcpServers)
    .values({
      projectId,
      name: input.name,
      description: input.description ?? null,
      transport: input.transport,
      url: input.url ?? null,
      command: input.command ?? null,
      args: (input.args ?? []) as unknown as never,
      headers: headersStored as unknown as never,
      headersIv: env.iv,
      headersTag: env.tag,
      enabled: input.enabled ?? true,
    })
    .returning()) as unknown as RawMcpRow[];
  console.log(`[mcp] created ${row.id} (${row.name}) — ${env.names.length} header(s) ${env.names.length ? `[${env.names.map((n) => `${n.name}=${maskSecret(env.cipher ?? '')}`).join(', ')}]` : ''}`);
  return scrub(row);
}

export async function updateMcpServer(projectId: string, mcpServerId: string, input: UpdateMcpServerInput): Promise<ScrubbedMcpServer | null> {
  if (input.transport || input.url !== undefined || input.command !== undefined) {
    // Re-validate the resulting transport/url/command set together by reading
    // the existing row so we don't allow an inconsistent partial update.
    const existing = await rawGet(projectId, mcpServerId);
    if (!existing) return null;
    validateInput({
      transport: (input.transport ?? existing.transport) as McpTransport,
      url: input.url !== undefined ? input.url : existing.url,
      command: input.command !== undefined ? input.command : existing.command,
    });
  }
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.transport !== undefined) patch.transport = input.transport;
  if (input.url !== undefined) patch.url = input.url;
  if (input.command !== undefined) patch.command = input.command;
  if (input.args !== undefined) patch.args = input.args;
  if (input.enabled !== undefined) patch.enabled = input.enabled;

  if (input.headers !== undefined) {
    const env = await buildEnvelope(projectId, input.headers);
    patch.headers = { names: env.names, cipher: env.cipher };
    patch.headersIv = env.iv;
    patch.headersTag = env.tag;
  }

  const db = getDb();
  const [row] = (await db
    .update(schema.mcpServers)
    .set(patch)
    .where(and(eq(schema.mcpServers.projectId, projectId), eq(schema.mcpServers.id, mcpServerId)))
    .returning()) as unknown as RawMcpRow[];
  return row ? scrub(row) : null;
}

export async function deleteMcpServer(projectId: string, mcpServerId: string): Promise<boolean> {
  const db = getDb();
  const result = await db
    .delete(schema.mcpServers)
    .where(and(eq(schema.mcpServers.projectId, projectId), eq(schema.mcpServers.id, mcpServerId)))
    .returning({ id: schema.mcpServers.id });
  return result.length > 0;
}

// ---------------------------------------------------------------------------
// Connection test — minimal smoke check (no real handshake).
// ---------------------------------------------------------------------------

export interface McpTestResult { ok: boolean; status?: number; latencyMs: number; error?: string }

export async function testMcpServer(projectId: string, mcpServerId: string): Promise<McpTestResult> {
  const start = Date.now();
  const row = await rawGet(projectId, mcpServerId);
  if (!row) return { ok: false, latencyMs: Date.now() - start, error: 'mcp server not found' };
  if (row.transport === 'http') {
    if (!row.url) return { ok: false, latencyMs: Date.now() - start, error: 'no url configured' };
    try {
      const headers: Record<string, string> = {};
      const decoded = await decryptRowHeaders(projectId, row);
      for (const h of decoded) headers[h.name] = h.value;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(row.url, { method: 'HEAD', headers, signal: ctrl.signal });
      clearTimeout(t);
      return { ok: res.ok || res.status < 500, status: res.status, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: (err as Error).message };
    }
  }
  // stdio transport: confirm command string is non-empty; we don't spawn here.
  return { ok: !!row.command, latencyMs: Date.now() - start, error: row.command ? undefined : 'no command configured' };
}

// ---------------------------------------------------------------------------
// Per-agent assignment.
// ---------------------------------------------------------------------------

export async function listAgentMcpServers(projectId: string, agentId: string): Promise<ScrubbedMcpServer[]> {
  const db = getDb();
  const rows = (await db
    .select({
      id: schema.mcpServers.id,
      projectId: schema.mcpServers.projectId,
      name: schema.mcpServers.name,
      description: schema.mcpServers.description,
      transport: schema.mcpServers.transport,
      url: schema.mcpServers.url,
      command: schema.mcpServers.command,
      args: schema.mcpServers.args,
      headers: schema.mcpServers.headers,
      headersIv: schema.mcpServers.headersIv,
      headersTag: schema.mcpServers.headersTag,
      enabled: schema.mcpServers.enabled,
      createdAt: schema.mcpServers.createdAt,
      updatedAt: schema.mcpServers.updatedAt,
    })
    .from(schema.agentMcpServers)
    .innerJoin(schema.mcpServers, eq(schema.agentMcpServers.mcpServerId, schema.mcpServers.id))
    .where(and(eq(schema.agentMcpServers.agentId, agentId), eq(schema.mcpServers.projectId, projectId)))
    .orderBy(schema.mcpServers.name)) as unknown as RawMcpRow[];
  return rows.map(scrub);
}

export async function assignMcpServersToAgent(
  projectId: string,
  agentId: string,
  mcpServerIds: string[],
): Promise<{ assigned: string[]; skipped: string[] }> {
  if (mcpServerIds.length === 0) return { assigned: [], skipped: [] };
  const db = getDb();
  const valid = await db
    .select({ id: schema.mcpServers.id })
    .from(schema.mcpServers)
    .where(and(eq(schema.mcpServers.projectId, projectId), inArray(schema.mcpServers.id, mcpServerIds)));
  const validIds = new Set(valid.map((r) => r.id));
  const skipped = mcpServerIds.filter((id) => !validIds.has(id));
  if (validIds.size === 0) return { assigned: [], skipped };

  const inserted = await db
    .insert(schema.agentMcpServers)
    .values(Array.from(validIds).map((mcpServerId) => ({ agentId, mcpServerId })))
    .onConflictDoNothing()
    .returning({ mcpServerId: schema.agentMcpServers.mcpServerId });
  return { assigned: inserted.map((r) => r.mcpServerId), skipped };
}

export async function unassignMcpServerFromAgent(agentId: string, mcpServerId: string): Promise<boolean> {
  const db = getDb();
  const result = await db
    .delete(schema.agentMcpServers)
    .where(and(eq(schema.agentMcpServers.agentId, agentId), eq(schema.agentMcpServers.mcpServerId, mcpServerId)))
    .returning({ mcpServerId: schema.agentMcpServers.mcpServerId });
  return result.length > 0;
}

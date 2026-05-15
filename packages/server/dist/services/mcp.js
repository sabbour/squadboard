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
import { decryptString, encryptString, getProjectSecretKey, maskSecret, } from './secret-key.js';
async function buildEnvelope(projectId, headers) {
    if (headers.length === 0)
        return { names: [], cipher: null, iv: null, tag: null };
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
export async function decryptHeaders(projectId, mcpServerId) {
    const row = await rawGet(projectId, mcpServerId);
    if (!row) {
        const err = new Error('mcp server not found');
        err.status = 404;
        throw err;
    }
    return decryptRowHeaders(projectId, row);
}
async function decryptRowHeaders(projectId, row) {
    const stored = row.headers;
    if (!stored)
        return [];
    // Migration-friendly read: support both legacy bare-array and the new
    // {names, cipher} shape (we always write the new shape going forward).
    const names = Array.isArray(stored)
        ? stored
        : (stored.names ?? []);
    const cipher = Array.isArray(stored) ? null : (stored.cipher ?? null);
    if (names.length === 0 || !cipher || !row.headersIv || !row.headersTag)
        return names.map((n) => ({ name: n.name, value: '' }));
    const key = await getProjectSecretKey(projectId);
    const env = { cipher, iv: row.headersIv, tag: row.headersTag };
    const plain = decryptString(key, env);
    const values = JSON.parse(plain);
    return names.map((n, i) => ({ name: n.name, value: values[i] ?? '' }));
}
function scrub(row) {
    const stored = row.headers;
    let names = [];
    let hasCipher = false;
    if (Array.isArray(stored)) {
        names = stored;
    }
    else if (stored && stored.names) {
        names = stored.names;
        hasCipher = !!stored.cipher;
    }
    const args = Array.isArray(row.args) ? row.args : [];
    return {
        id: row.id,
        projectId: row.projectId,
        name: row.name,
        description: row.description,
        transport: row.transport,
        url: row.url,
        command: row.command,
        args,
        headers: names.map((n) => ({ name: n.name, hasSecret: hasCipher })),
        enabled: row.enabled,
        source: row.source ?? 'custom',
        sourceUri: row.sourceUri ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}
async function rawGet(projectId, mcpServerId) {
    const db = getDb();
    const rows = await db
        .select()
        .from(schema.mcpServers)
        .where(and(eq(schema.mcpServers.projectId, projectId), eq(schema.mcpServers.id, mcpServerId)))
        .limit(1);
    return rows[0] ?? null;
}
export async function listMcpServers(projectId) {
    const db = getDb();
    const rows = (await db
        .select()
        .from(schema.mcpServers)
        .where(eq(schema.mcpServers.projectId, projectId))
        .orderBy(schema.mcpServers.name));
    return rows.map(scrub);
}
export async function getMcpServer(projectId, mcpServerId) {
    const row = await rawGet(projectId, mcpServerId);
    return row ? scrub(row) : null;
}
function validateInput(input) {
    if (input.transport === 'http' && !input.url) {
        throw Object.assign(new Error('http transport requires url'), { status: 400 });
    }
    if (input.transport === 'stdio' && !input.command) {
        throw Object.assign(new Error('stdio transport requires command'), { status: 400 });
    }
}
export async function createMcpServer(projectId, input) {
    validateInput(input);
    const env = await buildEnvelope(projectId, input.headers ?? []);
    const db = getDb();
    const headersStored = { names: env.names, cipher: env.cipher };
    const [row] = (await db
        .insert(schema.mcpServers)
        .values({
        projectId,
        name: input.name,
        description: input.description ?? null,
        transport: input.transport,
        url: input.url ?? null,
        command: input.command ?? null,
        args: (input.args ?? []),
        headers: headersStored,
        headersIv: env.iv,
        headersTag: env.tag,
        enabled: input.enabled ?? true,
    })
        .returning());
    console.log(`[mcp] created ${row.id} (${row.name}) — ${env.names.length} header(s) ${env.names.length ? `[${env.names.map((n) => `${n.name}=${maskSecret(env.cipher ?? '')}`).join(', ')}]` : ''}`);
    return scrub(row);
}
export async function updateMcpServer(projectId, mcpServerId, input) {
    if (input.transport || input.url !== undefined || input.command !== undefined) {
        // Re-validate the resulting transport/url/command set together by reading
        // the existing row so we don't allow an inconsistent partial update.
        const existing = await rawGet(projectId, mcpServerId);
        if (!existing)
            return null;
        validateInput({
            transport: (input.transport ?? existing.transport),
            url: input.url !== undefined ? input.url : existing.url,
            command: input.command !== undefined ? input.command : existing.command,
        });
    }
    const patch = { updatedAt: new Date() };
    if (input.name !== undefined)
        patch.name = input.name;
    if (input.description !== undefined)
        patch.description = input.description;
    if (input.transport !== undefined)
        patch.transport = input.transport;
    if (input.url !== undefined)
        patch.url = input.url;
    if (input.command !== undefined)
        patch.command = input.command;
    if (input.args !== undefined)
        patch.args = input.args;
    if (input.enabled !== undefined)
        patch.enabled = input.enabled;
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
        .returning());
    return row ? scrub(row) : null;
}
export async function deleteMcpServer(projectId, mcpServerId) {
    const db = getDb();
    const result = await db
        .delete(schema.mcpServers)
        .where(and(eq(schema.mcpServers.projectId, projectId), eq(schema.mcpServers.id, mcpServerId)))
        .returning({ id: schema.mcpServers.id });
    return result.length > 0;
}
function normalizeMcpEntry(name, raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const r = raw;
    const description = typeof r.description === 'string' ? r.description.trim() : null;
    const url = typeof r.url === 'string' ? r.url.trim() : null;
    const command = typeof r.command === 'string' ? r.command.trim() : null;
    let transport;
    if (url && !command)
        transport = 'http';
    else if (command && !url)
        transport = 'stdio';
    else if (typeof r.transport === 'string' && (r.transport === 'http' || r.transport === 'stdio'))
        transport = r.transport;
    else if (url)
        transport = 'http';
    else if (command)
        transport = 'stdio';
    else
        return null;
    const args = Array.isArray(r.args) ? r.args.filter((a) => typeof a === 'string') : [];
    const headers = [];
    if (r.headers && typeof r.headers === 'object' && !Array.isArray(r.headers)) {
        for (const [hname, hval] of Object.entries(r.headers)) {
            if (typeof hval === 'string' && hname.trim())
                headers.push({ name: hname.trim(), value: hval });
        }
    }
    // env → headers when stdio (downstream MCP launchers read env from headers map)
    if (transport === 'stdio' && r.env && typeof r.env === 'object' && !Array.isArray(r.env)) {
        for (const [hname, hval] of Object.entries(r.env)) {
            if (typeof hval === 'string' && hname.trim())
                headers.push({ name: hname.trim(), value: hval });
        }
    }
    return {
        name: name.trim().slice(0, 80),
        description: description ? description.slice(0, 280) : null,
        transport,
        url,
        command,
        args,
        headers,
    };
}
export async function importMcpServersFromJson(projectId, input) {
    let parsed;
    if (typeof input.content === 'string') {
        if (!input.content.trim()) {
            throw Object.assign(new Error('content is required'), { status: 400 });
        }
        try {
            parsed = JSON.parse(input.content);
        }
        catch (err) {
            throw Object.assign(new Error(`invalid JSON: ${err.message}`), { status: 400 });
        }
    }
    else {
        parsed = input.content;
    }
    // Build candidate map name → raw entry
    const candidates = new Map();
    if (Array.isArray(parsed)) {
        for (const item of parsed) {
            if (item && typeof item === 'object' && typeof item.name === 'string') {
                candidates.set(item.name.trim(), item);
            }
        }
    }
    else if (parsed && typeof parsed === 'object') {
        const p = parsed;
        if (p.mcpServers && typeof p.mcpServers === 'object' && !Array.isArray(p.mcpServers)) {
            for (const [name, entry] of Object.entries(p.mcpServers)) {
                if (name && typeof entry === 'object' && entry)
                    candidates.set(name.trim(), entry);
            }
        }
        else if (typeof p.name === 'string') {
            candidates.set(p.name.trim(), p);
        }
        else if (Object.keys(p).length > 0) {
            // Bare map of name → config (no top-level `mcpServers` wrapper)
            for (const [name, entry] of Object.entries(p)) {
                if (entry && typeof entry === 'object')
                    candidates.set(name.trim(), entry);
            }
        }
    }
    if (candidates.size === 0) {
        throw Object.assign(new Error('no mcp server entries found in payload'), { status: 400 });
    }
    const existing = await listMcpServers(projectId);
    const existingByName = new Set(existing.map((m) => m.name));
    const result = { imported: [], skipped: [] };
    for (const [name, raw] of candidates) {
        const norm = normalizeMcpEntry(name, raw);
        if (!norm) {
            result.skipped.push({ name, reason: 'missing url/command or invalid shape' });
            continue;
        }
        if (existingByName.has(norm.name)) {
            result.skipped.push({ name: norm.name, reason: 'already exists' });
            continue;
        }
        try {
            const created = await createMcpServer(projectId, {
                name: norm.name,
                description: norm.description,
                transport: norm.transport,
                url: norm.url,
                command: norm.command,
                args: norm.args,
                headers: norm.headers,
                enabled: true,
            });
            // Tag provenance so the UI can render the right badge.
            if (input.sourceUri) {
                const db = getDb();
                await db
                    .update(schema.mcpServers)
                    .set({ source: 'imported', sourceUri: input.sourceUri })
                    .where(and(eq(schema.mcpServers.projectId, projectId), eq(schema.mcpServers.id, created.id)));
            }
            else {
                const db = getDb();
                await db
                    .update(schema.mcpServers)
                    .set({ source: 'imported' })
                    .where(and(eq(schema.mcpServers.projectId, projectId), eq(schema.mcpServers.id, created.id)));
            }
            existingByName.add(created.name);
            result.imported.push({ id: created.id, name: created.name, transport: created.transport });
        }
        catch (err) {
            result.skipped.push({ name: norm.name, reason: err.message });
        }
    }
    return result;
}
export async function testMcpServer(projectId, mcpServerId) {
    const start = Date.now();
    const row = await rawGet(projectId, mcpServerId);
    if (!row)
        return { ok: false, latencyMs: Date.now() - start, error: 'mcp server not found' };
    if (row.transport === 'http') {
        if (!row.url)
            return { ok: false, latencyMs: Date.now() - start, error: 'no url configured' };
        try {
            const headers = {};
            const decoded = await decryptRowHeaders(projectId, row);
            for (const h of decoded)
                headers[h.name] = h.value;
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 5000);
            const res = await fetch(row.url, { method: 'HEAD', headers, signal: ctrl.signal });
            clearTimeout(t);
            return { ok: res.ok || res.status < 500, status: res.status, latencyMs: Date.now() - start };
        }
        catch (err) {
            return { ok: false, latencyMs: Date.now() - start, error: err.message };
        }
    }
    // stdio transport: confirm command string is non-empty; we don't spawn here.
    return { ok: !!row.command, latencyMs: Date.now() - start, error: row.command ? undefined : 'no command configured' };
}
// ---------------------------------------------------------------------------
// Per-agent assignment.
// ---------------------------------------------------------------------------
export async function listAgentMcpServers(projectId, agentId) {
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
        source: schema.mcpServers.source,
        sourceUri: schema.mcpServers.sourceUri,
        createdAt: schema.mcpServers.createdAt,
        updatedAt: schema.mcpServers.updatedAt,
    })
        .from(schema.agentMcpServers)
        .innerJoin(schema.mcpServers, eq(schema.agentMcpServers.mcpServerId, schema.mcpServers.id))
        .where(and(eq(schema.agentMcpServers.agentId, agentId), eq(schema.mcpServers.projectId, projectId)))
        .orderBy(schema.mcpServers.name));
    return rows.map(scrub);
}
export async function assignMcpServersToAgent(projectId, agentId, mcpServerIds) {
    if (mcpServerIds.length === 0)
        return { assigned: [], skipped: [] };
    const db = getDb();
    const valid = await db
        .select({ id: schema.mcpServers.id })
        .from(schema.mcpServers)
        .where(and(eq(schema.mcpServers.projectId, projectId), inArray(schema.mcpServers.id, mcpServerIds)));
    const validIds = new Set(valid.map((r) => r.id));
    const skipped = mcpServerIds.filter((id) => !validIds.has(id));
    if (validIds.size === 0)
        return { assigned: [], skipped };
    const inserted = await db
        .insert(schema.agentMcpServers)
        .values(Array.from(validIds).map((mcpServerId) => ({ agentId, mcpServerId })))
        .onConflictDoNothing()
        .returning({ mcpServerId: schema.agentMcpServers.mcpServerId });
    return { assigned: inserted.map((r) => r.mcpServerId), skipped };
}
export async function unassignMcpServerFromAgent(agentId, mcpServerId) {
    const db = getDb();
    const result = await db
        .delete(schema.agentMcpServers)
        .where(and(eq(schema.agentMcpServers.agentId, agentId), eq(schema.agentMcpServers.mcpServerId, mcpServerId)))
        .returning({ mcpServerId: schema.agentMcpServers.mcpServerId });
    return result.length > 0;
}
//# sourceMappingURL=mcp.js.map
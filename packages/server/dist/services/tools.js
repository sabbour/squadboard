/**
 * services/tools.ts — Phase 13
 *
 * CRUD + per-agent assignment for the project-scoped Tools registry.
 * A "tool" is a catalogued external action — typically backed by an MCP
 * server, but a tool row can exist without an mcpServerId (e.g. a built-in
 * SDK tool, or a tool whose backing server hasn't been registered yet).
 * Tools carry optional input/output JSON schemas for downstream UIs.
 *
 * AI-formulated tools (see `formulateTool` at the bottom) let users sketch
 * a tool with a brief prose description; the model returns a structured
 * draft (key, name, description, category, suggested input schema sketch)
 * that the user reviews and accepts.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { extractJsonObject, runFormulator, } from './formulator.js';
export async function listTools(projectId) {
    const db = getDb();
    return db
        .select()
        .from(schema.tools)
        .where(eq(schema.tools.projectId, projectId))
        .orderBy(schema.tools.category, schema.tools.name);
}
export async function getTool(projectId, toolId) {
    const db = getDb();
    const rows = await db
        .select()
        .from(schema.tools)
        .where(and(eq(schema.tools.projectId, projectId), eq(schema.tools.id, toolId)))
        .limit(1);
    return rows[0] ?? null;
}
export async function createTool(projectId, input) {
    const db = getDb();
    const [row] = await db
        .insert(schema.tools)
        .values({
        projectId,
        key: input.key,
        name: input.name,
        description: input.description,
        category: input.category ?? null,
        mcpServerId: input.mcpServerId ?? null,
        inputSchema: (input.inputSchema ?? null),
        outputSchema: (input.outputSchema ?? null),
        source: input.source ?? 'custom',
        sourceUri: input.sourceUri ?? null,
    })
        .returning();
    return row;
}
export async function updateTool(projectId, toolId, input) {
    const db = getDb();
    const patch = { updatedAt: new Date() };
    if (input.key !== undefined)
        patch.key = input.key;
    if (input.name !== undefined)
        patch.name = input.name;
    if (input.description !== undefined)
        patch.description = input.description;
    if (input.category !== undefined)
        patch.category = input.category;
    if (input.mcpServerId !== undefined)
        patch.mcpServerId = input.mcpServerId;
    if (input.inputSchema !== undefined)
        patch.inputSchema = input.inputSchema;
    if (input.outputSchema !== undefined)
        patch.outputSchema = input.outputSchema;
    const [row] = await db
        .update(schema.tools)
        .set(patch)
        .where(and(eq(schema.tools.projectId, projectId), eq(schema.tools.id, toolId)))
        .returning();
    return row ?? null;
}
export async function deleteTool(projectId, toolId) {
    const db = getDb();
    const result = await db
        .delete(schema.tools)
        .where(and(eq(schema.tools.projectId, projectId), eq(schema.tools.id, toolId)))
        .returning({ id: schema.tools.id });
    return result.length > 0;
}
// ---------------------------------------------------------------------------
// Agent assignment
// ---------------------------------------------------------------------------
export async function listAgentTools(projectId, agentId) {
    const db = getDb();
    return db
        .select({
        id: schema.tools.id,
        projectId: schema.tools.projectId,
        key: schema.tools.key,
        name: schema.tools.name,
        description: schema.tools.description,
        category: schema.tools.category,
        mcpServerId: schema.tools.mcpServerId,
        inputSchema: schema.tools.inputSchema,
        outputSchema: schema.tools.outputSchema,
        source: schema.tools.source,
        sourceUri: schema.tools.sourceUri,
        createdAt: schema.tools.createdAt,
        updatedAt: schema.tools.updatedAt,
        assignedAt: schema.agentTools.assignedAt,
    })
        .from(schema.agentTools)
        .innerJoin(schema.tools, eq(schema.agentTools.toolId, schema.tools.id))
        .where(and(eq(schema.agentTools.agentId, agentId), eq(schema.tools.projectId, projectId)))
        .orderBy(schema.tools.category, schema.tools.name);
}
export async function assignToolsToAgent(projectId, agentId, toolIds) {
    if (toolIds.length === 0)
        return { assigned: [], skipped: [] };
    const db = getDb();
    const valid = await db
        .select({ id: schema.tools.id })
        .from(schema.tools)
        .where(and(eq(schema.tools.projectId, projectId), inArray(schema.tools.id, toolIds)));
    const validIds = new Set(valid.map((r) => r.id));
    const skipped = toolIds.filter((id) => !validIds.has(id));
    if (validIds.size === 0)
        return { assigned: [], skipped };
    const inserted = await db
        .insert(schema.agentTools)
        .values(Array.from(validIds).map((toolId) => ({ agentId, toolId })))
        .onConflictDoNothing()
        .returning({ toolId: schema.agentTools.toolId });
    return { assigned: inserted.map((r) => r.toolId), skipped };
}
export async function unassignToolFromAgent(agentId, toolId) {
    const db = getDb();
    const result = await db
        .delete(schema.agentTools)
        .where(and(eq(schema.agentTools.agentId, agentId), eq(schema.agentTools.toolId, toolId)))
        .returning({ toolId: schema.agentTools.toolId });
    return result.length > 0;
}
function toolKeySlug(input) {
    return input
        .toLowerCase()
        .replace(/\.json$/, '')
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_-]/g, '')
        .replace(/[_-]+/g, (m) => m[0])
        .replace(/^[_-]|[_-]$/g, '')
        .slice(0, 40);
}
function normalizeToolEntry(raw, fallbackFilename) {
    if (!raw || typeof raw !== 'object')
        return null;
    const r = raw;
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    const description = typeof r.description === 'string' ? r.description.trim() : '';
    if (!name || !description)
        return null;
    let key = typeof r.key === 'string' ? r.key.trim().toLowerCase() : '';
    if (!key)
        key = toolKeySlug(name);
    if (!key && fallbackFilename)
        key = toolKeySlug(fallbackFilename);
    if (!key || !TOOL_KEBAB_RE.test(key))
        return null;
    const category = typeof r.category === 'string' ? r.category.trim().toLowerCase() : null;
    return {
        key: key.slice(0, 40),
        name: name.slice(0, 60),
        description: description.slice(0, 1024),
        category: category && category.length ? category.slice(0, 30) : null,
        inputSchema: r.inputSchema ?? r.input_schema ?? undefined,
        outputSchema: r.outputSchema ?? r.output_schema ?? undefined,
    };
}
export async function importToolsFromJson(projectId, input) {
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
    // Normalise to an array of candidate entries.
    let entries = [];
    if (Array.isArray(parsed)) {
        entries = parsed;
    }
    else if (parsed && typeof parsed === 'object') {
        const p = parsed;
        if (Array.isArray(p.tools)) {
            entries = p.tools;
        }
        else {
            entries = [p];
        }
    }
    if (entries.length === 0) {
        throw Object.assign(new Error('no tool entries found in payload'), { status: 400 });
    }
    const existing = await listTools(projectId);
    const existingByKey = new Map(existing.map((t) => [t.key, t]));
    const result = { imported: [], skipped: [] };
    for (const entry of entries) {
        const norm = normalizeToolEntry(entry, input.filename);
        if (!norm) {
            result.skipped.push({ key: '<invalid>', reason: 'missing name or description' });
            continue;
        }
        const dup = existingByKey.get(norm.key);
        if (dup) {
            result.skipped.push({ key: norm.key, reason: 'already exists' });
            continue;
        }
        const created = await createTool(projectId, {
            key: norm.key,
            name: norm.name,
            description: norm.description,
            category: norm.category,
            mcpServerId: input.mcpServerId ?? null,
            inputSchema: norm.inputSchema,
            outputSchema: norm.outputSchema,
            source: 'imported',
            sourceUri: input.sourceUri ?? null,
        });
        existingByKey.set(created.key, created);
        result.imported.push({ id: created.id, key: created.key, name: created.name });
    }
    return result;
}
const TOOL_KEBAB_RE = /^[a-z][a-z0-9_-]*$/;
function buildToolPrompt(draft, existingKeys) {
    const existing = existingKeys.length
        ? existingKeys.slice(0, 50).map((k) => `- ${k}`).join('\n')
        : '(no existing tools yet)';
    return [
        "You are a tool formulator for an agent-driven kanban board. A 'tool' is a catalogued external action that an AI agent can invoke (typically via MCP). The user gave a brief, raw description — your job is to turn it into a clean, well-structured tool draft.",
        '',
        'Existing tool keys in this project (avoid collisions, never reuse):',
        existing,
        '',
        "User's draft:",
        '"""',
        draft,
        '"""',
        '',
        'Respond ONLY with a JSON object (no prose, no markdown fence) matching:',
        '{',
        '  "key": string,                // snake_case or kebab-case, ≤40 chars, unique',
        '  "name": string,               // human-readable, ≤60 chars',
        '  "description": string,        // 1-2 sentences explaining what the tool does and when to use it',
        '  "category": string,           // 1-2 word grouping (e.g. "github", "search", "filesystem")',
        '  "inputSchema": object         // a JSON Schema sketch of the tool\'s input parameters (object with properties + required)',
        '}',
        '',
        'Guidelines:',
        '- description: clear, actionable, mentions when an agent should reach for this tool.',
        '- inputSchema: use standard JSON Schema (type, properties, required). If unsure of inputs, return { "type": "object", "properties": {}, "required": [] }.',
        '- Prefer well-known parameter names (owner, repo, query, path, …) for clarity.',
    ].join('\n');
}
function normalizeToolDraft(parsed, existingKeys) {
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('LLM payload was not a JSON object');
    }
    const p = parsed;
    let key = typeof p.key === 'string' ? p.key.trim().toLowerCase() : '';
    key = key.replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '').replace(/[_-]+/g, (m) => m[0]).replace(/^[_-]|[_-]$/g, '');
    if (!key || !TOOL_KEBAB_RE.test(key))
        throw new Error('LLM produced an invalid tool key');
    if (existingKeys.has(key)) {
        let n = 2;
        while (existingKeys.has(`${key}_${n}`))
            n++;
        key = `${key}_${n}`;
    }
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    if (!name)
        throw new Error('LLM payload missing `name`');
    const description = typeof p.description === 'string' ? p.description.trim() : '';
    if (!description)
        throw new Error('LLM payload missing `description`');
    const category = typeof p.category === 'string' ? p.category.trim().toLowerCase() : '';
    let inputSchema = p.inputSchema;
    if (!inputSchema || typeof inputSchema !== 'object') {
        inputSchema = { type: 'object', properties: {}, required: [] };
    }
    return {
        key: key.slice(0, 40),
        name: name.slice(0, 60),
        description: description.slice(0, 280),
        category: category.slice(0, 30),
        inputSchema,
    };
}
export async function formulateTool(projectId, draft) {
    const trimmed = (draft ?? '').trim();
    if (!trimmed) {
        throw Object.assign(new Error('draft is required'), { status: 400 });
    }
    const existing = await listTools(projectId);
    const existingKeys = existing.map((t) => t.key);
    const prompt = buildToolPrompt(trimmed, existingKeys);
    const { raw, modelUsed } = await runFormulator({ prompt, projectId });
    console.log(`[tools] formulating draft (${trimmed.length} chars) with model=${modelUsed.model} (via ${modelUsed.via})`);
    const parsed = extractJsonObject(raw);
    const tool = normalizeToolDraft(parsed, new Set(existingKeys));
    return { tool, modelUsed };
}
//# sourceMappingURL=tools.js.map
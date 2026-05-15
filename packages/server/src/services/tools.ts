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
import {
  extractJsonObject,
  runFormulator,
  type ResolveModelResult,
} from './formulator.js';

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export interface CreateToolInput {
  key: string;
  name: string;
  description: string;
  category?: string | null;
  mcpServerId?: string | null;
  inputSchema?: unknown;
  outputSchema?: unknown;
}

export interface UpdateToolInput {
  key?: string;
  name?: string;
  description?: string;
  category?: string | null;
  mcpServerId?: string | null;
  inputSchema?: unknown;
  outputSchema?: unknown;
}

export async function listTools(projectId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.tools)
    .where(eq(schema.tools.projectId, projectId))
    .orderBy(schema.tools.category, schema.tools.name);
}

export async function getTool(projectId: string, toolId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.tools)
    .where(and(eq(schema.tools.projectId, projectId), eq(schema.tools.id, toolId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createTool(projectId: string, input: CreateToolInput) {
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
      inputSchema: (input.inputSchema ?? null) as never,
      outputSchema: (input.outputSchema ?? null) as never,
    })
    .returning();
  return row;
}

export async function updateTool(projectId: string, toolId: string, input: UpdateToolInput) {
  const db = getDb();
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.key !== undefined) patch.key = input.key;
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.category !== undefined) patch.category = input.category;
  if (input.mcpServerId !== undefined) patch.mcpServerId = input.mcpServerId;
  if (input.inputSchema !== undefined) patch.inputSchema = input.inputSchema;
  if (input.outputSchema !== undefined) patch.outputSchema = input.outputSchema;

  const [row] = await db
    .update(schema.tools)
    .set(patch)
    .where(and(eq(schema.tools.projectId, projectId), eq(schema.tools.id, toolId)))
    .returning();
  return row ?? null;
}

export async function deleteTool(projectId: string, toolId: string): Promise<boolean> {
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

export async function listAgentTools(projectId: string, agentId: string) {
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
      createdAt: schema.tools.createdAt,
      updatedAt: schema.tools.updatedAt,
      assignedAt: schema.agentTools.assignedAt,
    })
    .from(schema.agentTools)
    .innerJoin(schema.tools, eq(schema.agentTools.toolId, schema.tools.id))
    .where(and(eq(schema.agentTools.agentId, agentId), eq(schema.tools.projectId, projectId)))
    .orderBy(schema.tools.category, schema.tools.name);
}

export async function assignToolsToAgent(
  projectId: string,
  agentId: string,
  toolIds: string[],
): Promise<{ assigned: string[]; skipped: string[] }> {
  if (toolIds.length === 0) return { assigned: [], skipped: [] };
  const db = getDb();

  const valid = await db
    .select({ id: schema.tools.id })
    .from(schema.tools)
    .where(and(eq(schema.tools.projectId, projectId), inArray(schema.tools.id, toolIds)));
  const validIds = new Set(valid.map((r) => r.id));
  const skipped = toolIds.filter((id) => !validIds.has(id));

  if (validIds.size === 0) return { assigned: [], skipped };

  const inserted = await db
    .insert(schema.agentTools)
    .values(Array.from(validIds).map((toolId) => ({ agentId, toolId })))
    .onConflictDoNothing()
    .returning({ toolId: schema.agentTools.toolId });

  return { assigned: inserted.map((r) => r.toolId), skipped };
}

export async function unassignToolFromAgent(
  agentId: string,
  toolId: string,
): Promise<boolean> {
  const db = getDb();
  const result = await db
    .delete(schema.agentTools)
    .where(and(eq(schema.agentTools.agentId, agentId), eq(schema.agentTools.toolId, toolId)))
    .returning({ toolId: schema.agentTools.toolId });
  return result.length > 0;
}

// ---------------------------------------------------------------------------
// AI Formulator — turn a brief draft into a structured tool draft the user
// can review + accept. Returns a CreateToolInput-shaped payload (NOT
// persisted) plus the model that produced it.
// ---------------------------------------------------------------------------

export interface FormulatedToolDraft {
  key: string;
  name: string;
  description: string;
  category: string;
  inputSchema: unknown;
}

export interface FormulateToolResult {
  tool: FormulatedToolDraft;
  modelUsed: ResolveModelResult;
}

const TOOL_KEBAB_RE = /^[a-z][a-z0-9_-]*$/;

function buildToolPrompt(draft: string, existingKeys: string[]): string {
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

function normalizeToolDraft(parsed: unknown, existingKeys: Set<string>): FormulatedToolDraft {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('LLM payload was not a JSON object');
  }
  const p = parsed as Record<string, unknown>;

  let key = typeof p.key === 'string' ? p.key.trim().toLowerCase() : '';
  key = key.replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '').replace(/[_-]+/g, (m) => m[0]).replace(/^[_-]|[_-]$/g, '');
  if (!key || !TOOL_KEBAB_RE.test(key)) throw new Error('LLM produced an invalid tool key');
  if (existingKeys.has(key)) {
    let n = 2;
    while (existingKeys.has(`${key}_${n}`)) n++;
    key = `${key}_${n}`;
  }

  const name = typeof p.name === 'string' ? p.name.trim() : '';
  if (!name) throw new Error('LLM payload missing `name`');

  const description = typeof p.description === 'string' ? p.description.trim() : '';
  if (!description) throw new Error('LLM payload missing `description`');

  const category = typeof p.category === 'string' ? p.category.trim().toLowerCase() : '';

  let inputSchema: unknown = p.inputSchema;
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

export async function formulateTool(
  projectId: string,
  draft: string,
): Promise<FormulateToolResult> {
  const trimmed = (draft ?? '').trim();
  if (!trimmed) {
    throw Object.assign(new Error('draft is required'), { status: 400 });
  }

  const existing = await listTools(projectId);
  const existingKeys = existing.map((t) => t.key);

  const prompt = buildToolPrompt(trimmed, existingKeys);
  const { raw, modelUsed } = await runFormulator({ prompt, projectId });
  console.log(
    `[tools] formulating draft (${trimmed.length} chars) with model=${modelUsed.model} (via ${modelUsed.via})`,
  );

  const parsed = extractJsonObject(raw);
  const tool = normalizeToolDraft(parsed, new Set(existingKeys));
  return { tool, modelUsed };
}

/**
 * services/tools.ts — Phase 13
 *
 * CRUD + per-agent assignment for the project-scoped Tools registry.
 * A "tool" is a catalogued external action — typically backed by an MCP
 * server, but a tool row can exist without an mcpServerId (e.g. a built-in
 * SDK tool, or a tool whose backing server hasn't been registered yet).
 * Tools carry optional input/output JSON schemas for downstream UIs.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';

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

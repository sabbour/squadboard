import { Router } from 'express';
import type { Request, Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { eq, and } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { parseCharter, writeCharter, computeCharterHash } from '../services/charter-compiler.js';
import { syncAgentsFromDisk } from '../services/agent-sync.js';

const router = Router({ mergeParams: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KEBAB_RE = /^[a-z][a-z0-9-]*$/;

async function resolveSquadPath(projectId: string): Promise<string | null> {
  const db = getDb();
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  return project?.path ?? null;
}

// ---------------------------------------------------------------------------
// GET /api/projects/:projectId/agents
// List agents, optionally filtered by ?status=active|disabled|retired
// ---------------------------------------------------------------------------
router.get('/', async (req: Request, res: Response) => {
  const { projectId } = req.params as Record<string, string>;
  const { status } = req.query;

  const db = getDb();

  const conditions = [eq(schema.agents.projectId, projectId)];
  if (status && typeof status === 'string') {
    conditions.push(
      eq(schema.agents.status, status as 'active' | 'disabled' | 'retired'),
    );
  }

  // Trigger a sync from disk before returning so the list is always fresh.
  const squadPath = await resolveSquadPath(projectId);
  if (squadPath) {
    await syncAgentsFromDisk(projectId, squadPath).catch(() => { /* best-effort */ });
  }

  const rows = await db
    .select()
    .from(schema.agents)
    .where(conditions.length === 1 ? conditions[0] : and(...conditions));

  res.json({ ok: true, data: rows });
});

// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/agents  — hire a new agent
// Body: { name, role, model?, expertise[] }
// ---------------------------------------------------------------------------
router.post('/', async (req: Request, res: Response) => {
  const { projectId } = req.params as Record<string, string>;
  const { name, role, model, expertise } = req.body as {
    name?: string;
    role?: string;
    model?: string;
    expertise?: string[];
  };

  if (!name || !role) {
    res.status(400).json({ ok: false, error: '`name` and `role` are required' });
    return;
  }

  if (!KEBAB_RE.test(name)) {
    res.status(400).json({
      ok: false,
      error: '`name` must be kebab-case (lowercase letters, digits, hyphens; must start with a letter)',
    });
    return;
  }

  const squadPath = await resolveSquadPath(projectId);
  if (!squadPath) {
    res.status(404).json({ ok: false, error: 'Project not found or has no .squad/ path' });
    return;
  }

  const agentDir = path.join(squadPath, 'agents', name);
  const charterPath = path.join(agentDir, 'charter.md');
  const historyPath = path.join(agentDir, 'history.md');

  const db = getDb();

  // Collision check
  const collision = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.projectId, projectId), eq(schema.agents.name, name)))
    .limit(1);

  if (collision.length > 0) {
    res.status(409).json({ ok: false, error: `Agent "${name}" already exists in this project` });
    return;
  }

  // Also check on disk
  try {
    await fs.access(agentDir);
    res.status(409).json({ ok: false, error: `Agent folder .squad/agents/${name} already exists on disk` });
    return;
  } catch {
    // Good — folder does not exist yet
  }

  // Create files atomically: directory first, then charter, then history
  await fs.mkdir(agentDir, { recursive: true });

  await writeCharter(charterPath, {
    name,
    role,
    model,
    expertise: expertise ?? [],
  });

  const historyContent = `# ${name} — History\n\n## Core Context\n\n- **Role:** ${role}\n- **Joined:** 2026-05-14T09:23:41Z\n\n## Learnings\n\n<!-- Append learnings below -->\n`;
  await fs.writeFile(historyPath, historyContent, 'utf-8');

  const charterHash = await computeCharterHash(charterPath);

  const [inserted] = await db
    .insert(schema.agents)
    .values({
      projectId,
      name,
      role,
      model: model ?? null,
      status: 'active',
      charterPath,
      historyPath,
      charterHash,
    })
    .returning();

  res.status(201).json({ ok: true, data: inserted });
});

// ---------------------------------------------------------------------------
// GET /api/projects/:projectId/agents/:id
// Agent details + recent history excerpt (last 20 lines of history.md)
// ---------------------------------------------------------------------------
router.get('/:id', async (req: Request, res: Response) => {
  const { projectId, id } = req.params as Record<string, string>;
  const db = getDb();

  const [agent] = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.projectId, projectId), eq(schema.agents.id, id)))
    .limit(1);

  if (!agent) {
    res.status(404).json({ ok: false, error: 'Agent not found' });
    return;
  }

  let historyExcerpt: string | null = null;
  if (agent.historyPath) {
    historyExcerpt = await fs
      .readFile(agent.historyPath, 'utf-8')
      .then((content) => content.split('\n').slice(-20).join('\n'))
      .catch(() => null);
  }

  res.json({ ok: true, data: { ...agent, historyExcerpt } });
});

// ---------------------------------------------------------------------------
// PATCH /api/projects/:projectId/agents/:id
// Update agent fields: role, model, status
// ---------------------------------------------------------------------------
router.patch('/:id', async (req: Request, res: Response) => {
  const { projectId, id } = req.params as Record<string, string>;
  const { role, model, status } = req.body as {
    role?: string;
    model?: string;
    status?: 'active' | 'disabled' | 'retired';
  };

  const db = getDb();

  const [agent] = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.projectId, projectId), eq(schema.agents.id, id)))
    .limit(1);

  if (!agent) {
    res.status(404).json({ ok: false, error: 'Agent not found' });
    return;
  }

  const updates: Partial<typeof schema.agents.$inferInsert> = { updatedAt: new Date() };
  if (role !== undefined) updates.role = role;
  if (model !== undefined) updates.model = model;
  if (status !== undefined) updates.status = status;

  const [updated] = await db
    .update(schema.agents)
    .set(updates)
    .where(eq(schema.agents.id, id))
    .returning();

  res.json({ ok: true, data: updated });
});

// ---------------------------------------------------------------------------
// DELETE /api/projects/:projectId/agents/:id
// Disable agent (status='disabled'); file on disk is untouched.
// ---------------------------------------------------------------------------
router.delete('/:id', async (req: Request, res: Response) => {
  const { projectId, id } = req.params as Record<string, string>;
  const db = getDb();

  const [agent] = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.projectId, projectId), eq(schema.agents.id, id)))
    .limit(1);

  if (!agent) {
    res.status(404).json({ ok: false, error: 'Agent not found' });
    return;
  }

  const [updated] = await db
    .update(schema.agents)
    .set({ status: 'disabled', updatedAt: new Date() })
    .where(eq(schema.agents.id, id))
    .returning();

  res.json({ ok: true, data: updated });
});

// ---------------------------------------------------------------------------
// GET /api/projects/:projectId/agents/:id/charter
// Return raw charter.md content
// ---------------------------------------------------------------------------
router.get('/:id/charter', async (req: Request, res: Response) => {
  const { projectId, id } = req.params as Record<string, string>;
  const db = getDb();

  const [agent] = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.projectId, projectId), eq(schema.agents.id, id)))
    .limit(1);

  if (!agent) {
    res.status(404).json({ ok: false, error: 'Agent not found' });
    return;
  }

  const content = await fs.readFile(agent.charterPath, 'utf-8').catch(() => null);
  if (content === null) {
    res.status(404).json({ ok: false, error: 'Charter file not found on disk' });
    return;
  }

  res.json({ ok: true, data: { charterPath: agent.charterPath, content } });
});

// ---------------------------------------------------------------------------
// PATCH /api/projects/:projectId/agents/:id/charter
// Overwrite charter on disk and update hash in DB.
// Body: { content: string }
// ---------------------------------------------------------------------------
router.patch('/:id/charter', async (req: Request, res: Response) => {
  const { projectId, id } = req.params as Record<string, string>;
  const { content } = req.body as { content?: string };

  if (typeof content !== 'string') {
    res.status(400).json({ ok: false, error: '`content` (string) is required' });
    return;
  }

  const db = getDb();

  const [agent] = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.projectId, projectId), eq(schema.agents.id, id)))
    .limit(1);

  if (!agent) {
    res.status(404).json({ ok: false, error: 'Agent not found' });
    return;
  }

  await fs.writeFile(agent.charterPath, content, 'utf-8');
  const newHash = await computeCharterHash(agent.charterPath);

  // Re-parse to keep role/model in sync
  const meta = await parseCharter(agent.charterPath).catch(() => null);

  const [updated] = await db
    .update(schema.agents)
    .set({
      charterHash: newHash,
      role: meta?.role ?? agent.role,
      model: meta?.model ?? agent.model,
      updatedAt: new Date(),
    })
    .where(eq(schema.agents.id, id))
    .returning();

  res.json({ ok: true, data: updated });
});

export default router;

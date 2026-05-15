/**
 * routes/skills.ts — Phase 13 REST surface
 *
 * Project-scoped Skills registry + per-agent assignment.
 *
 *   GET    /api/skills/curated                              — bundled curated lib
 *   GET    /api/projects/:projectId/skills                  — list project skills
 *   POST   /api/projects/:projectId/skills                  — create
 *   PATCH  /api/projects/:projectId/skills/:id              — update
 *   DELETE /api/projects/:projectId/skills/:id              — delete
 *   POST   /api/projects/:projectId/skills/clone-curated    — clone curated entry
 *   GET    /api/projects/:projectId/agents/:agentId/skills  — assigned skills
 *   POST   /api/projects/:projectId/agents/:agentId/skills  — bulk assign
 *   DELETE /api/projects/:projectId/agents/:agentId/skills/:skillId — unassign
 */

import { Router, type Request, type Response } from 'express';
import * as skillsService from '../services/skills.js';

function handleError(res: Response, err: unknown, scope: string): void {
  if (err instanceof Error) {
    const status = (err as Error & { status?: number }).status ?? 500;
    if (status >= 500) console.error(`[${scope}] unhandled error:`, err);
    res.status(status).json({ ok: false, error: err.message });
    return;
  }
  console.error(`[${scope}] unhandled error:`, err);
  res.status(500).json({ ok: false, error: 'Internal server error' });
}

// ---------------------------------------------------------------------------
// Curated library — top-level (not project scoped).
// ---------------------------------------------------------------------------
export const curatedSkillsRouter = Router();

curatedSkillsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const list = await skillsService.loadCuratedSkills();
    res.json({ ok: true, data: list });
  } catch (err) {
    handleError(res, err, 'skills/curated');
  }
});

// ---------------------------------------------------------------------------
// Project-scoped CRUD.
// ---------------------------------------------------------------------------
export const projectSkillsRouter = Router({ mergeParams: true });

projectSkillsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const rows = await skillsService.listSkills(projectId);
    res.json({ ok: true, data: rows });
  } catch (err) {
    handleError(res, err, 'skills');
  }
});

projectSkillsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const body = req.body as Partial<skillsService.CreateSkillInput>;
    if (!body || !body.key || !body.name || !body.promptAddendum) {
      res.status(400).json({ ok: false, error: 'key, name, promptAddendum are required' });
      return;
    }
    const created = await skillsService.createSkill(projectId, {
      key: body.key,
      name: body.name,
      description: body.description ?? null,
      category: body.category ?? null,
      promptAddendum: body.promptAddendum,
      curatedKey: body.curatedKey ?? null,
    });
    res.status(201).json({ ok: true, data: created });
  } catch (err) {
    handleError(res, err, 'skills');
  }
});

projectSkillsRouter.post('/clone-curated', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const { key } = req.body as { key?: string };
    if (!key) {
      res.status(400).json({ ok: false, error: 'key is required' });
      return;
    }
    const created = await skillsService.cloneCuratedSkill(projectId, key);
    res.status(201).json({ ok: true, data: created });
  } catch (err) {
    handleError(res, err, 'skills');
  }
});

projectSkillsRouter.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { projectId, id } = req.params as { projectId: string; id: string };
    const body = req.body as skillsService.UpdateSkillInput;
    const updated = await skillsService.updateSkill(projectId, id, body);
    if (!updated) {
      res.status(404).json({ ok: false, error: 'skill not found' });
      return;
    }
    res.json({ ok: true, data: updated });
  } catch (err) {
    handleError(res, err, 'skills');
  }
});

projectSkillsRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { projectId, id } = req.params as { projectId: string; id: string };
    const ok = await skillsService.deleteSkill(projectId, id);
    if (!ok) {
      res.status(404).json({ ok: false, error: 'skill not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err, 'skills');
  }
});

// ---------------------------------------------------------------------------
// Per-agent assignment.
// ---------------------------------------------------------------------------
export const agentSkillsRouter = Router({ mergeParams: true });

agentSkillsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { projectId, agentId } = req.params as { projectId: string; agentId: string };
    const rows = await skillsService.listAgentSkills(projectId, agentId);
    res.json({ ok: true, data: rows });
  } catch (err) {
    handleError(res, err, 'agent-skills');
  }
});

agentSkillsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { projectId, agentId } = req.params as { projectId: string; agentId: string };
    const { skillIds } = req.body as { skillIds?: string[] };
    if (!Array.isArray(skillIds)) {
      res.status(400).json({ ok: false, error: 'skillIds must be an array' });
      return;
    }
    const result = await skillsService.assignSkillsToAgent(projectId, agentId, skillIds);
    res.status(201).json({ ok: true, data: result });
  } catch (err) {
    handleError(res, err, 'agent-skills');
  }
});

agentSkillsRouter.delete('/:skillId', async (req: Request, res: Response) => {
  try {
    const { agentId, skillId } = req.params as { agentId: string; skillId: string };
    const ok = await skillsService.unassignSkillFromAgent(agentId, skillId);
    if (!ok) {
      res.status(404).json({ ok: false, error: 'assignment not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err, 'agent-skills');
  }
});

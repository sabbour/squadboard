/**
 * routes/tools.ts — Phase 13 REST surface
 *
 * Project-scoped Tools registry + per-agent assignment.
 *
 *   GET    /api/projects/:projectId/tools                    — list project tools
 *   POST   /api/projects/:projectId/tools                    — create
 *   PATCH  /api/projects/:projectId/tools/:id                — update
 *   DELETE /api/projects/:projectId/tools/:id                — delete
 *   GET    /api/projects/:projectId/agents/:agentId/tools    — assigned tools
 *   POST   /api/projects/:projectId/agents/:agentId/tools    — bulk assign
 *   DELETE /api/projects/:projectId/agents/:agentId/tools/:toolId — unassign
 */

import { Router, type Request, type Response } from 'express';
import * as toolsService from '../services/tools.js';

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
// Project-scoped CRUD.
// ---------------------------------------------------------------------------
export const projectToolsRouter = Router({ mergeParams: true });

projectToolsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const rows = await toolsService.listTools(projectId);
    res.json({ ok: true, data: rows });
  } catch (err) {
    handleError(res, err, 'tools');
  }
});

projectToolsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const body = req.body as Partial<toolsService.CreateToolInput>;
    if (!body || !body.key || !body.name || !body.description) {
      res.status(400).json({ ok: false, error: 'key, name, description are required' });
      return;
    }
    const created = await toolsService.createTool(projectId, {
      key: body.key,
      name: body.name,
      description: body.description,
      category: body.category ?? null,
      mcpServerId: body.mcpServerId ?? null,
      inputSchema: body.inputSchema,
      outputSchema: body.outputSchema,
    });
    res.status(201).json({ ok: true, data: created });
  } catch (err) {
    handleError(res, err, 'tools');
  }
});

projectToolsRouter.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { projectId, id } = req.params as { projectId: string; id: string };
    const body = req.body as toolsService.UpdateToolInput;
    const updated = await toolsService.updateTool(projectId, id, body);
    if (!updated) {
      res.status(404).json({ ok: false, error: 'tool not found' });
      return;
    }
    res.json({ ok: true, data: updated });
  } catch (err) {
    handleError(res, err, 'tools');
  }
});

projectToolsRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { projectId, id } = req.params as { projectId: string; id: string };
    const ok = await toolsService.deleteTool(projectId, id);
    if (!ok) {
      res.status(404).json({ ok: false, error: 'tool not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err, 'tools');
  }
});

// ---------------------------------------------------------------------------
// Per-agent assignment.
// ---------------------------------------------------------------------------
export const agentToolsRouter = Router({ mergeParams: true });

agentToolsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { projectId, agentId } = req.params as { projectId: string; agentId: string };
    const rows = await toolsService.listAgentTools(projectId, agentId);
    res.json({ ok: true, data: rows });
  } catch (err) {
    handleError(res, err, 'agent-tools');
  }
});

agentToolsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { projectId, agentId } = req.params as { projectId: string; agentId: string };
    const { toolIds } = req.body as { toolIds?: string[] };
    if (!Array.isArray(toolIds)) {
      res.status(400).json({ ok: false, error: 'toolIds must be an array' });
      return;
    }
    const result = await toolsService.assignToolsToAgent(projectId, agentId, toolIds);
    res.status(201).json({ ok: true, data: result });
  } catch (err) {
    handleError(res, err, 'agent-tools');
  }
});

agentToolsRouter.delete('/:toolId', async (req: Request, res: Response) => {
  try {
    const { agentId, toolId } = req.params as { agentId: string; toolId: string };
    const ok = await toolsService.unassignToolFromAgent(agentId, toolId);
    if (!ok) {
      res.status(404).json({ ok: false, error: 'assignment not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err, 'agent-tools');
  }
});

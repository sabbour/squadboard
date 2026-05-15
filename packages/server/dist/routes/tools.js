/**
 * routes/tools.ts — Phase 13 REST surface
 *
 * Project-scoped Tools registry + per-agent assignment.
 *
 *   GET    /api/projects/:projectId/tools                    — list project tools
 *   POST   /api/projects/:projectId/tools                    — create
 *   POST   /api/projects/:projectId/tools/import-from-json   — import tool(s) (Wave 10 D3)
 *   POST   /api/projects/:projectId/tools/formulate          — AI-author from a draft
 *   PATCH  /api/projects/:projectId/tools/:id                — update
 *   DELETE /api/projects/:projectId/tools/:id                — delete
 *   GET    /api/projects/:projectId/agents/:agentId/tools    — assigned tools
 *   POST   /api/projects/:projectId/agents/:agentId/tools    — bulk assign
 *   DELETE /api/projects/:projectId/agents/:agentId/tools/:toolId — unassign
 */
import { Router } from 'express';
import * as toolsService from '../services/tools.js';
function handleError(res, err, scope) {
    if (err instanceof Error) {
        const status = err.status ?? 500;
        if (status >= 500)
            console.error(`[${scope}] unhandled error:`, err);
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
projectToolsRouter.get('/', async (req, res) => {
    try {
        const { projectId } = req.params;
        const rows = await toolsService.listTools(projectId);
        res.json({ ok: true, data: rows });
    }
    catch (err) {
        handleError(res, err, 'tools');
    }
});
projectToolsRouter.post('/', async (req, res) => {
    try {
        const { projectId } = req.params;
        const body = req.body;
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
    }
    catch (err) {
        handleError(res, err, 'tools');
    }
});
projectToolsRouter.post('/import-from-json', async (req, res) => {
    try {
        const { projectId } = req.params;
        const body = req.body;
        if (body.content === undefined || body.content === null) {
            res.status(400).json({ ok: false, error: 'content is required (raw JSON string or object)' });
            return;
        }
        const result = await toolsService.importToolsFromJson(projectId, {
            content: body.content,
            filename: typeof body.filename === 'string' ? body.filename : undefined,
            sourceUri: typeof body.sourceUri === 'string' ? body.sourceUri : undefined,
            mcpServerId: typeof body.mcpServerId === 'string' ? body.mcpServerId : undefined,
        });
        res.status(201).json({ ok: true, data: result });
    }
    catch (err) {
        handleError(res, err, 'tools/import-from-json');
    }
});
projectToolsRouter.post('/formulate', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { draft } = req.body;
        if (!draft || typeof draft !== 'string') {
            res.status(400).json({ ok: false, error: 'draft is required' });
            return;
        }
        const result = await toolsService.formulateTool(projectId, draft);
        res.json({ ok: true, data: result });
    }
    catch (err) {
        handleError(res, err, 'tools/formulate');
    }
});
projectToolsRouter.patch('/:id', async (req, res) => {
    try {
        const { projectId, id } = req.params;
        const body = req.body;
        const updated = await toolsService.updateTool(projectId, id, body);
        if (!updated) {
            res.status(404).json({ ok: false, error: 'tool not found' });
            return;
        }
        res.json({ ok: true, data: updated });
    }
    catch (err) {
        handleError(res, err, 'tools');
    }
});
projectToolsRouter.delete('/:id', async (req, res) => {
    try {
        const { projectId, id } = req.params;
        const ok = await toolsService.deleteTool(projectId, id);
        if (!ok) {
            res.status(404).json({ ok: false, error: 'tool not found' });
            return;
        }
        res.json({ ok: true });
    }
    catch (err) {
        handleError(res, err, 'tools');
    }
});
// ---------------------------------------------------------------------------
// Per-agent assignment.
// ---------------------------------------------------------------------------
export const agentToolsRouter = Router({ mergeParams: true });
agentToolsRouter.get('/', async (req, res) => {
    try {
        const { projectId, agentId } = req.params;
        const rows = await toolsService.listAgentTools(projectId, agentId);
        res.json({ ok: true, data: rows });
    }
    catch (err) {
        handleError(res, err, 'agent-tools');
    }
});
agentToolsRouter.post('/', async (req, res) => {
    try {
        const { projectId, agentId } = req.params;
        const { toolIds } = req.body;
        if (!Array.isArray(toolIds)) {
            res.status(400).json({ ok: false, error: 'toolIds must be an array' });
            return;
        }
        const result = await toolsService.assignToolsToAgent(projectId, agentId, toolIds);
        res.status(201).json({ ok: true, data: result });
    }
    catch (err) {
        handleError(res, err, 'agent-tools');
    }
});
agentToolsRouter.delete('/:toolId', async (req, res) => {
    try {
        const { agentId, toolId } = req.params;
        const ok = await toolsService.unassignToolFromAgent(agentId, toolId);
        if (!ok) {
            res.status(404).json({ ok: false, error: 'assignment not found' });
            return;
        }
        res.json({ ok: true });
    }
    catch (err) {
        handleError(res, err, 'agent-tools');
    }
});
//# sourceMappingURL=tools.js.map
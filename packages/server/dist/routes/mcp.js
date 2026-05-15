/**
 * routes/mcp.ts — Phase 13 REST surface
 *
 * Project-scoped MCP server registry + per-agent assignment + a connection
 * test endpoint. Header values are AES-256-GCM encrypted at rest by the
 * service layer; GET responses are scrubbed (`hasSecret` only).
 *
 *   GET    /api/projects/:projectId/mcp-servers                 — list (scrubbed)
 *   POST   /api/projects/:projectId/mcp-servers                 — create
 *   GET    /api/projects/:projectId/mcp-servers/:id             — get (scrubbed)
 *   PATCH  /api/projects/:projectId/mcp-servers/:id             — update
 *   DELETE /api/projects/:projectId/mcp-servers/:id             — delete
 *   POST   /api/projects/:projectId/mcp-servers/:id/test        — connection test
 *   GET    /api/projects/:projectId/agents/:agentId/mcp-servers — assigned
 *   POST   /api/projects/:projectId/agents/:agentId/mcp-servers — bulk assign
 *   DELETE /api/projects/:projectId/agents/:agentId/mcp-servers/:mcpServerId — unassign
 */
import { Router } from 'express';
import * as mcpService from '../services/mcp.js';
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
export const projectMcpRouter = Router({ mergeParams: true });
projectMcpRouter.get('/', async (req, res) => {
    try {
        const { projectId } = req.params;
        const rows = await mcpService.listMcpServers(projectId);
        res.json({ ok: true, data: rows });
    }
    catch (err) {
        handleError(res, err, 'mcp');
    }
});
projectMcpRouter.get('/:id', async (req, res) => {
    try {
        const { projectId, id } = req.params;
        const row = await mcpService.getMcpServer(projectId, id);
        if (!row) {
            res.status(404).json({ ok: false, error: 'mcp server not found' });
            return;
        }
        res.json({ ok: true, data: row });
    }
    catch (err) {
        handleError(res, err, 'mcp');
    }
});
projectMcpRouter.post('/', async (req, res) => {
    try {
        const { projectId } = req.params;
        const body = req.body;
        if (!body || !body.name || !body.transport) {
            res.status(400).json({ ok: false, error: 'name and transport are required' });
            return;
        }
        if (body.transport !== 'http' && body.transport !== 'stdio') {
            res.status(400).json({ ok: false, error: 'transport must be "http" or "stdio"' });
            return;
        }
        const created = await mcpService.createMcpServer(projectId, {
            name: body.name,
            description: body.description ?? null,
            transport: body.transport,
            url: body.url ?? null,
            command: body.command ?? null,
            args: body.args ?? [],
            headers: body.headers ?? [],
            enabled: body.enabled,
        });
        res.status(201).json({ ok: true, data: created });
    }
    catch (err) {
        handleError(res, err, 'mcp');
    }
});
projectMcpRouter.patch('/:id', async (req, res) => {
    try {
        const { projectId, id } = req.params;
        const body = req.body;
        if (body.transport && body.transport !== 'http' && body.transport !== 'stdio') {
            res.status(400).json({ ok: false, error: 'transport must be "http" or "stdio"' });
            return;
        }
        const updated = await mcpService.updateMcpServer(projectId, id, body);
        if (!updated) {
            res.status(404).json({ ok: false, error: 'mcp server not found' });
            return;
        }
        res.json({ ok: true, data: updated });
    }
    catch (err) {
        handleError(res, err, 'mcp');
    }
});
projectMcpRouter.delete('/:id', async (req, res) => {
    try {
        const { projectId, id } = req.params;
        const ok = await mcpService.deleteMcpServer(projectId, id);
        if (!ok) {
            res.status(404).json({ ok: false, error: 'mcp server not found' });
            return;
        }
        res.json({ ok: true });
    }
    catch (err) {
        handleError(res, err, 'mcp');
    }
});
projectMcpRouter.post('/:id/test', async (req, res) => {
    try {
        const { projectId, id } = req.params;
        const result = await mcpService.testMcpServer(projectId, id);
        res.json({ ok: true, data: result });
    }
    catch (err) {
        handleError(res, err, 'mcp');
    }
});
// ---------------------------------------------------------------------------
// Per-agent assignment.
// ---------------------------------------------------------------------------
export const agentMcpRouter = Router({ mergeParams: true });
agentMcpRouter.get('/', async (req, res) => {
    try {
        const { projectId, agentId } = req.params;
        const rows = await mcpService.listAgentMcpServers(projectId, agentId);
        res.json({ ok: true, data: rows });
    }
    catch (err) {
        handleError(res, err, 'agent-mcp');
    }
});
agentMcpRouter.post('/', async (req, res) => {
    try {
        const { projectId, agentId } = req.params;
        const { mcpServerIds } = req.body;
        if (!Array.isArray(mcpServerIds)) {
            res.status(400).json({ ok: false, error: 'mcpServerIds must be an array' });
            return;
        }
        const result = await mcpService.assignMcpServersToAgent(projectId, agentId, mcpServerIds);
        res.status(201).json({ ok: true, data: result });
    }
    catch (err) {
        handleError(res, err, 'agent-mcp');
    }
});
agentMcpRouter.delete('/:mcpServerId', async (req, res) => {
    try {
        const { agentId, mcpServerId } = req.params;
        const ok = await mcpService.unassignMcpServerFromAgent(agentId, mcpServerId);
        if (!ok) {
            res.status(404).json({ ok: false, error: 'assignment not found' });
            return;
        }
        res.json({ ok: true });
    }
    catch (err) {
        handleError(res, err, 'agent-mcp');
    }
});
//# sourceMappingURL=mcp.js.map
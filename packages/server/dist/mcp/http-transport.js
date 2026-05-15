/**
 * Squadboard MCP server — Streamable HTTP transport mounted on the live
 * Express app. Reuses the `createMcpServer()` factory; the stdio entry point
 * (packages/server/src/mcp/index.ts) keeps working in parallel for desktop
 * MCP clients (Claude Desktop, Cursor) that spawn child processes.
 *
 * Transport: @modelcontextprotocol/sdk/server/streamableHttp.js
 *   - POST /mcp           — JSON-RPC requests (initialize, tools/list, tools/call)
 *   - GET  /mcp           — SSE stream for server-to-client notifications
 *   - DELETE /mcp         — explicit session close
 *   - GET  /mcp/health    — non-MCP probe used by VS Code and the UI's
 *                           "Test connection" button
 *
 * Stateful mode: each `initialize` from a client creates a fresh transport +
 * server pair keyed by an opaque session ID. Subsequent requests carry the
 * `Mcp-Session-Id` header which we route back to the correct transport.
 *
 * Auth: local-only in v1. No bearer tokens. The HTTP transport listens on the
 * same port as the web app and is implicitly trusted because Squadboard is
 * local-first.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Router } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer, TOOL_NAMES } from './server.js';
const sdkVersion = readSdkVersion();
const sessions = new Map();
export function createMcpHttpRouter() {
    const router = Router();
    router.get('/health', (_req, res) => {
        res.json({
            ok: true,
            transport: 'streamable-http',
            sdkVersion,
            tools: TOOL_NAMES,
            sessions: sessions.size,
        });
    });
    router.post('/', async (req, res) => {
        try {
            const sessionId = headerString(req.headers['mcp-session-id']);
            let entry = sessionId ? sessions.get(sessionId) : undefined;
            if (!entry) {
                if (sessionId) {
                    // Client sent a stale session ID — let it know it's gone so it can re-initialize.
                    res.status(404).json({
                        jsonrpc: '2.0',
                        error: { code: -32001, message: 'Unknown or expired Mcp-Session-Id; re-initialize.' },
                        id: null,
                    });
                    return;
                }
                if (!isInitializeRequest(req.body)) {
                    res.status(400).json({
                        jsonrpc: '2.0',
                        error: {
                            code: -32000,
                            message: 'Bad Request: first request on a new session must be an `initialize` JSON-RPC call.',
                        },
                        id: null,
                    });
                    return;
                }
                entry = createSession();
            }
            await entry.transport.handleRequest(req, res, req.body);
        }
        catch (err) {
            handleTransportError(err, res);
        }
    });
    router.get('/', async (req, res) => {
        const sessionId = headerString(req.headers['mcp-session-id']);
        if (!sessionId) {
            res.status(400).json({ error: 'missing_session_id' });
            return;
        }
        const entry = sessions.get(sessionId);
        if (!entry) {
            res.status(404).json({ error: 'unknown_session' });
            return;
        }
        try {
            await entry.transport.handleRequest(req, res);
        }
        catch (err) {
            handleTransportError(err, res);
        }
    });
    router.delete('/', async (req, res) => {
        const sessionId = headerString(req.headers['mcp-session-id']);
        if (!sessionId) {
            res.status(400).json({ error: 'missing_session_id' });
            return;
        }
        const entry = sessions.get(sessionId);
        if (!entry) {
            res.status(404).json({ error: 'unknown_session' });
            return;
        }
        try {
            await entry.transport.handleRequest(req, res);
        }
        catch (err) {
            handleTransportError(err, res);
        }
    });
    return router;
}
function createSession() {
    const closeHandlers = new Set();
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
            sessions.set(id, entry);
        },
        onsessionclosed: (id) => {
            sessions.delete(id);
            for (const fn of closeHandlers)
                fn();
        },
    });
    const server = createMcpServer();
    void server.connect(transport);
    const entry = { transport, closeHandlers };
    transport.onclose = () => {
        if (transport.sessionId)
            sessions.delete(transport.sessionId);
        for (const fn of closeHandlers)
            fn();
    };
    return entry;
}
function handleTransportError(err, res) {
    const message = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) {
        res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: `MCP transport error: ${message}` },
            id: null,
        });
    }
}
function headerString(v) {
    if (!v)
        return undefined;
    return Array.isArray(v) ? v[0] : v;
}
function readSdkVersion() {
    try {
        // Resolve the SDK module path then walk up to find its package.json. The
        // SDK doesn't expose `./package.json` in its exports map, so a plain
        // `require('@modelcontextprotocol/sdk/package.json')` fails.
        const sdkEntry = fileURLToPath(import.meta.resolve('@modelcontextprotocol/sdk/server/streamableHttp.js'));
        // dist/esm/server/streamableHttp.js → up 3 → package root
        const pkgPath = join(dirname(sdkEntry), '..', '..', '..', 'package.json');
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        return pkg.version ?? 'unknown';
    }
    catch {
        return 'unknown';
    }
}
//# sourceMappingURL=http-transport.js.map
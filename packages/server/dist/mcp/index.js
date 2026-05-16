#!/usr/bin/env node
/**
 * Squadboard MCP server entry point — stdio transport.
 *
 * Boots embedded Postgres, initialises the DB, then starts the MCP server
 * on stdin/stdout. Agents (Claude Desktop, Cursor, etc.) communicate via
 * JSON-RPC 2.0 messages over stdio.
 *
 * Usage:
 *   node packages/server/dist/mcp/index.js
 *   squadboard mcp          ← via CLI
 *
 * Wave 10 / A3: honours `SQUADBOARD_DEFAULT_PROJECT_ID` so every
 * project-scoped tool (`capture`, `list_inbox`, `list_issues`, …) has a
 * fallback projectId without the caller having to thread it on every call.
 *
 * Stream G Phase 2B (D4): SIGPIPE/SIGTERM/SIGINT handlers drain the pg pool
 * before exit so the parent process never sees a "pool already ended" trace
 * on stderr from the background PGlite checkpoint flush.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { startEmbeddedPostgres } from '../db/pglite.js';
import { initDb, closeDb } from '../db/index.js';
import { createMcpServer, setDefaultProjectId } from './server.js';
// ---------------------------------------------------------------------------
// Graceful shutdown — drain pg pool before exit
// ---------------------------------------------------------------------------
let shuttingDown = false;
async function shutdown(signal) {
    if (shuttingDown)
        return;
    shuttingDown = true;
    process.stderr.write(`[squadboard-mcp] ${signal} received — shutting down cleanly\n`);
    try {
        await closeDb();
    }
    catch {
        // Swallow — pool may already be closed if the parent died
    }
    process.exit(0);
}
// SIGTERM: clean Ctrl-C / systemd stop / process manager shutdown
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
// SIGINT: Ctrl-C in the terminal
process.on('SIGINT', () => { void shutdown('SIGINT'); });
// SIGPIPE: stdout pipe broken (parent process died). Exit silently — no trace.
process.on('SIGPIPE', () => {
    try {
        closeDb().catch(() => undefined);
    }
    catch { /* ignore */ }
    process.exit(0);
});
// ---------------------------------------------------------------------------
async function main() {
    // Log to stderr so stdout stays clean for JSON-RPC
    process.stderr.write('[squadboard-mcp] starting…\n');
    const connectionString = await startEmbeddedPostgres();
    await initDb(connectionString);
    // Wave 10 / A3: stdio has no request headers, so the only way to get a
    // default projectId in is via env. HTTP transport can still override per
    // request via the `x-project-id` header.
    const envDefault = process.env.SQUADBOARD_DEFAULT_PROJECT_ID;
    if (envDefault && envDefault.trim()) {
        setDefaultProjectId(envDefault);
        process.stderr.write(`[squadboard-mcp] default projectId from SQUADBOARD_DEFAULT_PROJECT_ID = ${envDefault.trim()}\n`);
    }
    process.stderr.write('[squadboard-mcp] DB ready, launching MCP server on stdio\n');
    const server = createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write('[squadboard-mcp] ready — listening for MCP calls on stdin\n');
}
main().catch((err) => {
    process.stderr.write(`[squadboard-mcp] fatal: ${String(err)}\n`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map
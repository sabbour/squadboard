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
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { startEmbeddedPostgres } from '../db/postgres.js';
import { initDb } from '../db/index.js';
import { createMcpServer } from './server.js';
async function main() {
    // Log to stderr so stdout stays clean for JSON-RPC
    process.stderr.write('[squadboard-mcp] starting…\n');
    const connectionString = await startEmbeddedPostgres();
    await initDb(connectionString);
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
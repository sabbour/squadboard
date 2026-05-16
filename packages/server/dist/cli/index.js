#!/usr/bin/env node
/**
 * packages/server/src/cli/index.ts
 *
 * Squadboard CLI entry point.
 *
 * Commands:
 *   squadboard mcp       Start the MCP stdio server (for Claude Desktop, Cursor, etc.)
 *   squadboard start     Start the HTTP dashboard server
 *   squadboard --version Print version
 *   squadboard --help    Show this help
 */
const [, , cmd] = process.argv;
switch (cmd) {
    case 'mcp':
        await import('../mcp/index.js');
        break;
    case 'start':
        await import('../index.js');
        break;
    case '--version':
    case '-v': {
        const { createRequire } = await import('node:module');
        const req = createRequire(import.meta.url);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pkg = req('../../package.json');
        console.log(pkg.version);
        break;
    }
    case '--help':
    case '-h':
    case undefined:
    default:
        console.log([
            'Squadboard — local-first kanban + workflow board for Squad agents',
            '',
            'Usage:',
            '  squadboard mcp       Start the MCP stdio server (add to Claude Desktop / Cursor config)',
            '  squadboard start     Start the HTTP dashboard server',
            '  squadboard --version Show version',
            '  squadboard --help    Show this help',
            '',
            'Examples:',
            '  # Add to Claude Desktop mcpServers config:',
            '  # { "command": "squadboard", "args": ["mcp"] }',
            '',
            '  # Start the web dashboard:',
            '  SQUADBOARD_DEFAULT_PROJECT_ID=my-project squadboard start',
        ].join('\n'));
        break;
}
export {};
//# sourceMappingURL=index.js.map
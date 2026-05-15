/**
 * scripts/smoke-loop-mcp.ts — Wave 10 Stream A6 smoke test.
 *
 * Drives the squadboard MCP server via the StdioClientTransport (same path
 * a desktop Copilot CLI would use). Exercises the full dogfood loop:
 *
 *   1. capture(prompt) → MCP tool creates a card on the board
 *   2. list_issues({status: 'backlog'}) → confirm the card is there
 *   3. update_issue({status: 'todo'}) → move to-do
 *   4. update_issue({status: 'in_progress'}) → start work
 *   5. update_issue({status: 'done'}) → close the loop
 *   6. list_issues({status: 'done'}) → confirm closure
 *
 * Reads SQUADBOARD_DEFAULT_PROJECT_ID at the parent level and forwards it
 * into the spawned MCP server's env so the project-id fallback (A3) is the
 * thing we're actually testing.
 *
 * Run:
 *   SQUADBOARD_DEFAULT_PROJECT_ID=<id> \
 *     pnpm --filter @sabbour/squadboard-server tsx src/scripts/smoke-loop-mcp.ts
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
function parseToolJson(result) {
    const text = result.content?.[0]?.text ?? '{}';
    try {
        return JSON.parse(text);
    }
    catch {
        return { raw: text };
    }
}
async function main() {
    const projectId = process.env.SQUADBOARD_DEFAULT_PROJECT_ID;
    if (!projectId) {
        console.error('[smoke] SQUADBOARD_DEFAULT_PROJECT_ID is required (the squadboard self-registered project id).');
        process.exit(2);
    }
    const here = dirname(fileURLToPath(import.meta.url));
    const mcpEntry = resolve(here, '..', 'mcp', 'index.ts');
    console.log(`[smoke] spawning MCP server: tsx ${mcpEntry}`);
    console.log(`[smoke] forwarding SQUADBOARD_DEFAULT_PROJECT_ID=${projectId}`);
    const transport = new StdioClientTransport({
        command: 'npx',
        args: ['tsx', mcpEntry],
        env: {
            ...process.env,
            SQUADBOARD_DEFAULT_PROJECT_ID: projectId,
        },
    });
    const client = new Client({ name: 'squadboard-smoke-loop', version: '0.1.0' }, { capabilities: {} });
    await client.connect(transport);
    console.log('[smoke] connected');
    // ── 1. capture ──────────────────────────────────────────────────────────
    const promptText = `[DOGFOOD A6 SMOKE ${new Date().toISOString()}] ` +
        'Fix bug: capture-from-CLI smoke test card. Will be moved through ' +
        'todo → in_progress → done by the smoke script and closed.';
    console.log('\n[smoke] (1) calling capture …');
    const captureRes = (await client.callTool({
        name: 'capture',
        arguments: { prompt: promptText, hint: 'issue' },
    }));
    const capture = parseToolJson(captureRes);
    console.log('[smoke]    →', JSON.stringify(capture, null, 2));
    if (!capture.issue?.id) {
        console.error('[smoke] FAIL: capture did not return an issue.id');
        await client.close();
        process.exit(1);
    }
    const issueId = capture.issue.id;
    // ── 2. list_issues backlog ──────────────────────────────────────────────
    console.log('\n[smoke] (2) listing backlog to confirm card landed …');
    const listBacklogRes = (await client.callTool({
        name: 'list_issues',
        arguments: { status: 'backlog' },
    }));
    const listBacklog = parseToolJson(listBacklogRes);
    const found = listBacklog.issues?.find((i) => i.id === issueId);
    console.log(`[smoke]    backlog count=${listBacklog.issues?.length ?? 0}, our card present=${!!found}`);
    if (!found) {
        console.error('[smoke] FAIL: card not found in backlog');
        await client.close();
        process.exit(1);
    }
    // ── 3. → todo ───────────────────────────────────────────────────────────
    console.log('\n[smoke] (3) update_issue → status=todo …');
    const upd1 = parseToolJson((await client.callTool({
        name: 'update_issue',
        arguments: { issueId, status: 'todo' },
    })));
    console.log('[smoke]    →', JSON.stringify(upd1));
    // ── 4. → in_progress ────────────────────────────────────────────────────
    console.log('\n[smoke] (4) update_issue → status=in_progress …');
    const upd2 = parseToolJson((await client.callTool({
        name: 'update_issue',
        arguments: { issueId, status: 'in_progress' },
    })));
    console.log('[smoke]    →', JSON.stringify(upd2));
    // ── 5. → done (close) ───────────────────────────────────────────────────
    console.log('\n[smoke] (5) update_issue → status=done …');
    const upd3 = parseToolJson((await client.callTool({
        name: 'update_issue',
        arguments: { issueId, status: 'done' },
    })));
    console.log('[smoke]    →', JSON.stringify(upd3));
    // ── 6. confirm in done column ───────────────────────────────────────────
    console.log('\n[smoke] (6) listing done column …');
    const listDoneRes = (await client.callTool({
        name: 'list_issues',
        arguments: { status: 'done' },
    }));
    const listDone = parseToolJson(listDoneRes);
    const closed = listDone.issues?.find((i) => i.id === issueId);
    console.log(`[smoke]    done count=${listDone.issues?.length ?? 0}, our card present=${!!closed}`);
    await client.close();
    if (closed) {
        console.log('\n[smoke] PASS — full loop completed: capture → backlog → todo → in_progress → done.');
        process.exit(0);
    }
    console.error('\n[smoke] FAIL: card did not land in done after final update');
    process.exit(1);
}
main().catch((err) => {
    console.error('[smoke] fatal:', err);
    process.exit(1);
});
//# sourceMappingURL=smoke-loop-mcp.js.map
/**
 * Slash command parser for /squadboard commands.
 * Parses "/squadboard <command> [args]" and returns markdown-formatted output.
 * Used by the slash_command MCP tool.
 */
import { getDb } from '../db/index.js';
import { issues, issueRuns, agents } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
/**
 * Parse and execute a /squadboard slash command string.
 * Supported: /squadboard list [--project <id>] [--status <status>]
 *            /squadboard create <title> [--project <id>]
 *            /squadboard run <issueId> [--agent <agentId>]
 *            /squadboard status <runId>
 *            /squadboard agents [--project <id>]
 */
export async function handleSlashCommand(input) {
    const trimmed = input.trim();
    // Strip leading "/squadboard" prefix if present
    const body = trimmed.replace(/^\/squadboard\s*/i, '');
    const parts = tokenize(body);
    if (parts.length === 0) {
        return helpResult();
    }
    const [cmd, ...rest] = parts;
    switch (cmd.toLowerCase()) {
        case 'list':
            return handleList(rest);
        case 'create':
            return handleCreate(rest);
        case 'run':
            return handleRun(rest);
        case 'status':
            return handleStatus(rest);
        case 'agents':
            return handleAgents(rest);
        case 'help':
            return helpResult();
        default:
            return {
                ok: false,
                markdown: `❌ Unknown command: \`${cmd}\`\n\n${helpText()}`,
            };
    }
}
// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------
async function handleList(args) {
    const db = getDb();
    const projectId = flagValue(args, '--project');
    const status = flagValue(args, '--status');
    const conditions = [];
    if (projectId)
        conditions.push(eq(issues.projectId, projectId));
    if (status) {
        // Runtime cast — status values are validated by the DB enum
        conditions.push(eq(issues.status, status));
    }
    conditions.push(eq(issues.archived, 0));
    const rows = await db
        .select({
        id: issues.id,
        title: issues.title,
        status: issues.status,
        projectId: issues.projectId,
    })
        .from(issues)
        .where(conditions.length === 1 ? conditions[0] : and(...conditions))
        .limit(50);
    if (rows.length === 0) {
        return { ok: true, markdown: '_No issues found._', data: [] };
    }
    const lines = rows.map((r) => `- **[${r.status}]** ${r.title} \`${r.id.slice(0, 8)}\``);
    return {
        ok: true,
        markdown: `## Issues (${rows.length})\n\n${lines.join('\n')}`,
        data: rows,
    };
}
async function handleCreate(args) {
    const projectId = flagValue(args, '--project');
    // Remaining positional args form the title (strip flags)
    const positional = args.filter((a) => !a.startsWith('--') && a !== projectId);
    const title = positional.join(' ').trim();
    if (!title) {
        return {
            ok: false,
            markdown: '❌ `create` requires a title.\n\nUsage: `/squadboard create My issue title --project <id>`',
        };
    }
    if (!projectId) {
        return {
            ok: false,
            markdown: '❌ `create` requires `--project <projectId>`.',
        };
    }
    const db = getDb();
    const [created] = await db
        .insert(issues)
        .values({ projectId, title, body: '', status: 'backlog', position: 0, archived: 0 })
        .returning({ id: issues.id, title: issues.title, status: issues.status });
    return {
        ok: true,
        markdown: `✅ Issue created: **${created.title}** \`${created.id}\``,
        data: created,
    };
}
async function handleRun(args) {
    const [issueId, ...rest] = args;
    const agentId = flagValue(rest, '--agent');
    if (!issueId || issueId.startsWith('--')) {
        return {
            ok: false,
            markdown: '❌ `run` requires an issueId.\n\nUsage: `/squadboard run <issueId> [--agent <agentId>]`',
        };
    }
    const db = getDb();
    // Resolve agent: use provided or pick first active agent for the issue's project
    let resolvedAgentId = agentId;
    if (!resolvedAgentId) {
        const [issue] = await db
            .select({ projectId: issues.projectId })
            .from(issues)
            .where(eq(issues.id, issueId))
            .limit(1);
        if (!issue) {
            return { ok: false, markdown: `❌ Issue \`${issueId}\` not found.` };
        }
        const [agent] = await db
            .select({ id: agents.id })
            .from(agents)
            .where(and(eq(agents.projectId, issue.projectId), eq(agents.status, 'active')))
            .limit(1);
        if (!agent) {
            return {
                ok: false,
                markdown: `❌ No active agents found for project. Hire one first.`,
            };
        }
        resolvedAgentId = agent.id;
    }
    const [run] = await db
        .insert(issueRuns)
        .values({ issueId, agentId: resolvedAgentId, kind: 'agent_run', status: 'pending' })
        .returning({ id: issueRuns.id, status: issueRuns.status });
    return {
        ok: true,
        markdown: `🚀 Run queued: \`${run.id}\` (status: **${run.status}**)`,
        data: run,
    };
}
async function handleStatus(args) {
    const [runId] = args;
    if (!runId || runId.startsWith('--')) {
        return {
            ok: false,
            markdown: '❌ `status` requires a runId.\n\nUsage: `/squadboard status <runId>`',
        };
    }
    const db = getDb();
    const [run] = await db
        .select({
        id: issueRuns.id,
        issueId: issueRuns.issueId,
        status: issueRuns.status,
        kind: issueRuns.kind,
        startedAt: issueRuns.startedAt,
        completedAt: issueRuns.completedAt,
        costUsd: issueRuns.costUsd,
    })
        .from(issueRuns)
        .where(eq(issueRuns.id, runId))
        .limit(1);
    if (!run) {
        return { ok: false, markdown: `❌ Run \`${runId}\` not found.` };
    }
    const statusEmoji = {
        pending: '⏳',
        running: '🔄',
        completed: '✅',
        failed: '❌',
        cancelled: '🚫',
    };
    const emoji = statusEmoji[run.status] ?? '❓';
    const lines = [
        `## Run \`${run.id.slice(0, 8)}\``,
        `- **Status:** ${emoji} ${run.status}`,
        `- **Kind:** ${run.kind}`,
        `- **Issue:** \`${run.issueId}\``,
        run.startedAt ? `- **Started:** ${run.startedAt.toISOString()}` : '',
        run.completedAt ? `- **Completed:** ${run.completedAt.toISOString()}` : '',
        run.costUsd !== '0' ? `- **Cost:** $${run.costUsd}` : '',
    ].filter(Boolean);
    return { ok: true, markdown: lines.join('\n'), data: run };
}
async function handleAgents(args) {
    const projectId = flagValue(args, '--project');
    const db = getDb();
    const conditions = [eq(agents.status, 'active')];
    if (projectId)
        conditions.push(eq(agents.projectId, projectId));
    const rows = await db
        .select({ id: agents.id, name: agents.name, role: agents.role, model: agents.model })
        .from(agents)
        .where(and(...conditions))
        .limit(50);
    if (rows.length === 0) {
        return { ok: true, markdown: '_No active agents found._', data: [] };
    }
    const lines = rows.map((a) => `- **${a.name}** — ${a.role}${a.model ? ` (${a.model})` : ''} \`${a.id.slice(0, 8)}\``);
    return {
        ok: true,
        markdown: `## Active Agents (${rows.length})\n\n${lines.join('\n')}`,
        data: rows,
    };
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function tokenize(input) {
    // Simple whitespace tokenizer; quoted strings preserve spaces
    const tokens = [];
    let current = '';
    let inQuote = false;
    for (const ch of input) {
        if (ch === '"') {
            inQuote = !inQuote;
        }
        else if (ch === ' ' && !inQuote) {
            if (current)
                tokens.push(current);
            current = '';
        }
        else {
            current += ch;
        }
    }
    if (current)
        tokens.push(current);
    return tokens;
}
function flagValue(args, flag) {
    const idx = args.indexOf(flag);
    if (idx === -1)
        return undefined;
    return args[idx + 1];
}
function helpText() {
    return `**Usage:** \`/squadboard <command> [args]\`

**Commands:**
- \`list [--project <id>] [--status <status>]\` — List issues
- \`create <title> --project <id>\` — Create a new issue
- \`run <issueId> [--agent <agentId>]\` — Queue an agent run
- \`status <runId>\` — Get run status
- \`agents [--project <id>]\` — List active agents`;
}
function helpResult() {
    return { ok: true, markdown: helpText() };
}
//# sourceMappingURL=slash-handler.js.map
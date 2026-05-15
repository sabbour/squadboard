/**
 * Squadboard MCP server — transport-agnostic factory.
 *
 * `createMcpServer()` returns a fresh `Server` instance with all tools
 * registered. The same factory backs both transports:
 *   - stdio   — `packages/server/src/mcp/index.ts` (child-process launches)
 *   - HTTP    — `packages/server/src/mcp/http-transport.ts` (mounted on the
 *               live Express app at POST /mcp + GET /mcp)
 *
 * Phase 18:
 *   - Tool names dropped the `squadboard_` prefix; the MCP server name
 *     (`squadboard`) already namespaces. Renamed: list_issues, create_issue,
 *     update_issue (NEW), run_agent, get_run_status, list_agents,
 *     slash_command. 7 tools total.
 *   - Project-scoped tools accept `projectId` from args OR fall back to the
 *     `x-project-id` HTTP request header (HTTP transport only — stdio has no
 *     headers, so args are required there).
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDb } from '../db/index.js';
import { issues, issueRuns, agents, issueLabels, projects } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { handleSlashCommand } from './slash-handler.js';
import { classifyAndDraft } from '../services/conjure-classifier.js';
import * as inboxService from '../services/inbox.js';
import { resolveSquadDir } from '../services/diagnostics.js';
// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
export const TOOLS = [
    {
        name: 'list_issues',
        description: 'List issues on the board, with optional column-status filter. ' +
            "projectId may be omitted if the request includes an 'x-project-id' header.",
        inputSchema: {
            type: 'object',
            properties: {
                projectId: { type: 'string', description: 'UUID of the project (optional if x-project-id header set)' },
                status: {
                    type: 'string',
                    enum: ['backlog', 'todo', 'in_progress', 'in_review', 'done'],
                    description: 'Filter by column status (optional)',
                },
            },
            required: [],
        },
    },
    {
        name: 'create_issue',
        description: 'Create a new issue (card) on the board. ' +
            "projectId may be omitted if the request includes an 'x-project-id' header.",
        inputSchema: {
            type: 'object',
            properties: {
                projectId: { type: 'string', description: 'UUID of the project (optional if x-project-id header set)' },
                title: { type: 'string', description: 'Issue title' },
                body: { type: 'string', description: 'Issue body / description (markdown)' },
                labels: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Label IDs to attach (optional)',
                },
                idempotencyKey: {
                    type: 'string',
                    description: 'Optional idempotency key — safe to replay (partial unique check)',
                },
            },
            required: ['title'],
        },
    },
    {
        name: 'update_issue',
        description: "Update an existing issue's title, body, status (column), assignee, or labels. " +
            'Only fields that are provided are changed; omit a field to leave it as-is.',
        inputSchema: {
            type: 'object',
            properties: {
                issueId: { type: 'string', description: 'UUID of the issue to update' },
                title: { type: 'string', description: 'New title (optional)' },
                body: { type: 'string', description: 'New body / description (optional)' },
                status: {
                    type: 'string',
                    enum: ['backlog', 'todo', 'in_progress', 'in_review', 'done'],
                    description: 'New column status (optional)',
                },
                assigneeId: {
                    type: ['string', 'null'],
                    description: 'Agent UUID to assign, or null to unassign (optional)',
                },
                labels: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Replace label set with these label IDs (optional)',
                },
            },
            required: ['issueId'],
        },
    },
    {
        name: 'run_agent',
        description: 'Trigger an agent run on an issue.',
        inputSchema: {
            type: 'object',
            properties: {
                issueId: { type: 'string', description: 'UUID of the issue' },
                agentId: {
                    type: 'string',
                    description: 'UUID of the agent to run (optional — auto-picks first active agent in the project)',
                },
            },
            required: ['issueId'],
        },
    },
    {
        name: 'get_run_status',
        description: 'Get the status, output, and cost of an issue run.',
        inputSchema: {
            type: 'object',
            properties: {
                runId: { type: 'string', description: 'UUID of the issue run' },
            },
            required: ['runId'],
        },
    },
    {
        name: 'list_agents',
        description: 'List agents in a Squadboard project. Defaults to active agents only; ' +
            "pass `status` to include disabled or retired agents. " +
            "projectId may be omitted if the request includes an 'x-project-id' header.",
        inputSchema: {
            type: 'object',
            properties: {
                projectId: { type: 'string', description: 'UUID of the project (optional if x-project-id header set)' },
                status: {
                    type: 'string',
                    enum: ['active', 'disabled', 'retired', 'all'],
                    description: 'Filter agents by status. Default: "active". ' +
                        'Use "disabled" to find paused agents that can be re-enabled, ' +
                        '"retired" for archived agents, or "all" to see everything.',
                },
            },
            required: [],
        },
    },
    {
        name: 'slash_command',
        description: 'Execute a /squadboard slash command and get a markdown-formatted response.',
        inputSchema: {
            type: 'object',
            properties: {
                command: {
                    type: 'string',
                    description: 'The full slash command string, e.g. "/squadboard list --project abc"',
                },
            },
            required: ['command'],
        },
    },
    {
        name: 'list_projects',
        description: 'List all Squadboard projects. Returns id, name, and resolved squad path. ' +
            'Useful for an external CLI to discover which projectId to pass to other tools.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'list_inbox',
        description: 'List items in the Squadboard inbox (Conjure / quick-capture queue). ' +
            'Filter by status (captured | formulated | published | discarded) and/or projectId. ' +
            "projectId may be omitted if the request includes an 'x-project-id' header; pass no filters for the global inbox.",
        inputSchema: {
            type: 'object',
            properties: {
                projectId: { type: 'string', description: 'UUID of the project (optional; filters by suggestedProjectId).' },
                status: {
                    type: 'string',
                    enum: ['captured', 'formulated', 'published', 'discarded'],
                    description: 'Filter by inbox status (optional).',
                },
                limit: { type: 'number', description: 'Max rows to return (default 50).' },
            },
            required: [],
        },
    },
    {
        name: 'capture',
        description: 'Drop a free-form prompt into Squadboard. Routes the prompt through the Conjure ' +
            'classifier (intent: project | issue | team | agent | skill | tool) and, when the ' +
            'intent resolves to a board card (issue), creates the issue immediately. For other ' +
            'intents Conjure returns a draft + routing hint without persisting — surface that to ' +
            'the user so they can confirm. ' +
            "projectId may be omitted if the request includes an 'x-project-id' header.",
        inputSchema: {
            type: 'object',
            properties: {
                prompt: { type: 'string', description: 'The free-form prose to capture.' },
                projectId: {
                    type: 'string',
                    description: 'UUID of the project to land the resulting card in. Optional if x-project-id header set OR if the user just wants a draft back.',
                },
                hint: {
                    type: 'string',
                    enum: ['project', 'issue', 'team', 'agent', 'skill', 'tool'],
                    description: 'Optional pre-classified intent (skips part of the Conjure router).',
                },
                useLlm: {
                    type: 'boolean',
                    description: 'If false, never call the LLM (rule-based only). Defaults to true.',
                },
            },
            required: ['prompt'],
        },
    },
    {
        name: 'get_routing',
        description: "Return the contents of the project's .squad/routing.md file. " +
            "projectId may be omitted if the request includes an 'x-project-id' header.",
        inputSchema: {
            type: 'object',
            properties: {
                projectId: { type: 'string', description: 'UUID of the project (optional if x-project-id header set).' },
            },
            required: [],
        },
    },
];
/** Stable list of tool names. Used by GET /mcp/health and by the UI. */
export const TOOL_NAMES = TOOLS.map((t) => t.name);
// ---------------------------------------------------------------------------
// Header-based projectId fallback
// ---------------------------------------------------------------------------
/**
 * Pull `x-project-id` out of the SDK's RequestHandlerExtra. Headers can arrive
 * as `string | string[] | undefined` per the IsomorphicHeaders shape, so we
 * normalise to a single string. Stdio transport has no headers — returns
 * undefined and the tool falls back to required args validation.
 */
function headerProjectId(extra) {
    const raw = extra.requestInfo?.headers?.['x-project-id'];
    if (Array.isArray(raw))
        return raw[0];
    return raw;
}
/**
 * Wave 10 / A3: process-wide default projectId. Set via
 * `setDefaultProjectId()` from the stdio transport boot path (which reads
 * `SQUADBOARD_DEFAULT_PROJECT_ID`). Used as the last-resort fallback when
 * neither args.projectId nor the x-project-id header is present.
 *
 * Module-scope state is acceptable here because every MCP server in the
 * process shares the same DB and the env var applies to the whole process.
 */
let defaultProjectId;
export function setDefaultProjectId(id) {
    defaultProjectId = id && id.trim() ? id.trim() : undefined;
}
export function getDefaultProjectId() {
    return defaultProjectId;
}
function resolveProjectId(args, extra) {
    return args.projectId ?? headerProjectId(extra) ?? defaultProjectId;
}
async function handleListIssues(args, extra) {
    const db = getDb();
    const { status } = args;
    const projectId = resolveProjectId(args, extra);
    if (!projectId) {
        return { error: 'missing_project_id', hint: 'Pass projectId in args, or set the x-project-id header.' };
    }
    const conditions = [eq(issues.projectId, projectId), eq(issues.archived, 0)];
    if (status) {
        conditions.push(eq(issues.status, status));
    }
    const rows = await db
        .select({
        id: issues.id,
        title: issues.title,
        status: issues.status,
        assigneeId: issues.assigneeId,
        position: issues.position,
        createdAt: issues.createdAt,
    })
        .from(issues)
        .where(and(...conditions))
        .limit(100);
    return { issues: rows, count: rows.length };
}
async function handleCreateIssue(args, extra) {
    const db = getDb();
    const { title, body = '', idempotencyKey, } = args;
    const projectId = resolveProjectId(args, extra);
    if (!projectId) {
        return { error: 'missing_project_id', hint: 'Pass projectId in args, or set the x-project-id header.' };
    }
    if (idempotencyKey) {
        const existing = await db
            .select({ id: issues.id })
            .from(issues)
            .where(and(eq(issues.projectId, projectId), eq(issues.title, `[${idempotencyKey}] ${title}`)))
            .limit(1);
        if (existing.length > 0) {
            return { created: false, id: existing[0].id, idempotencyKey };
        }
    }
    const insertTitle = idempotencyKey ? `[${idempotencyKey}] ${title}` : title;
    const [created] = await db
        .insert(issues)
        .values({
        projectId,
        title: insertTitle,
        body: body,
        status: 'backlog',
        position: 0,
        archived: 0,
    })
        .returning({ id: issues.id, title: issues.title, status: issues.status, createdAt: issues.createdAt });
    return { created: true, id: created.id, issue: created, idempotencyKey };
}
async function handleUpdateIssue(args) {
    const db = getDb();
    const { issueId, title, body, status, assigneeId, labels, } = args;
    if (!issueId) {
        return { error: 'missing_issue_id' };
    }
    const [existing] = await db
        .select({ id: issues.id, projectId: issues.projectId, archived: issues.archived })
        .from(issues)
        .where(eq(issues.id, issueId))
        .limit(1);
    if (!existing || existing.archived === 1) {
        return { error: 'issue_not_found', issueId };
    }
    const patch = { updatedAt: new Date() };
    if (title !== undefined)
        patch.title = title.trim();
    if (body !== undefined)
        patch.body = body;
    if (status !== undefined)
        patch.status = status;
    if (assigneeId !== undefined)
        patch.assigneeId = assigneeId ?? undefined;
    const wantsLabels = Array.isArray(labels);
    const hasFieldPatch = title !== undefined || body !== undefined || status !== undefined || assigneeId !== undefined;
    let updated = existing;
    if (hasFieldPatch) {
        const [row] = await db
            .update(issues)
            .set(patch)
            .where(eq(issues.id, issueId))
            .returning({ id: issues.id, projectId: issues.projectId, archived: issues.archived });
        if (row)
            updated = row;
    }
    if (wantsLabels) {
        await db.delete(issueLabels).where(eq(issueLabels.issueId, issueId));
        if (labels && labels.length > 0) {
            await db.insert(issueLabels).values(labels.map((labelId) => ({ issueId, labelId })));
        }
    }
    return { updated: true, id: updated.id };
}
async function handleRunAgent(args) {
    const db = getDb();
    const { issueId, agentId } = args;
    const [issue] = await db
        .select({ id: issues.id, projectId: issues.projectId })
        .from(issues)
        .where(eq(issues.id, issueId))
        .limit(1);
    if (!issue) {
        return { error: 'issue_not_found', issueId };
    }
    let resolvedAgentId = agentId;
    if (!resolvedAgentId) {
        const [agent] = await db
            .select({ id: agents.id })
            .from(agents)
            .where(and(eq(agents.projectId, issue.projectId), eq(agents.status, 'active')))
            .limit(1);
        if (!agent) {
            return { error: 'no_active_agents', projectId: issue.projectId };
        }
        resolvedAgentId = agent.id;
    }
    else {
        // Wave 10 B9: when an explicit agentId is supplied, refuse to dispatch
        // it if it isn't active. Mirrors the REST surface (POST issues/.../runs)
        // so MCP-driven runs honour the same disabled/retired semantics.
        const [agentRow] = await db
            .select({ id: agents.id, name: agents.name, status: agents.status })
            .from(agents)
            .where(eq(agents.id, resolvedAgentId))
            .limit(1);
        if (!agentRow) {
            return { error: 'agent_not_found', agentId: resolvedAgentId };
        }
        if (agentRow.status !== 'active') {
            return {
                error: 'agent_not_active',
                agentId: agentRow.id,
                agentName: agentRow.name,
                status: agentRow.status,
                hint: 'Re-enable the agent before running it.',
            };
        }
    }
    // Invariant I-1: MCP-triggered runs use kind='agent_run'
    const [run] = await db
        .insert(issueRuns)
        .values({
        issueId,
        agentId: resolvedAgentId,
        kind: 'agent_run',
        status: 'pending',
    })
        .returning({
        id: issueRuns.id,
        issueId: issueRuns.issueId,
        agentId: issueRuns.agentId,
        kind: issueRuns.kind,
        status: issueRuns.status,
        createdAt: issueRuns.createdAt,
    });
    return { run };
}
async function handleGetRunStatus(args) {
    const db = getDb();
    const { runId } = args;
    const [run] = await db
        .select({
        id: issueRuns.id,
        issueId: issueRuns.issueId,
        agentId: issueRuns.agentId,
        kind: issueRuns.kind,
        status: issueRuns.status,
        startedAt: issueRuns.startedAt,
        completedAt: issueRuns.completedAt,
        output: issueRuns.output,
        errorMessage: issueRuns.errorMessage,
        costUsd: issueRuns.costUsd,
        inputTokens: issueRuns.inputTokens,
        outputTokens: issueRuns.outputTokens,
    })
        .from(issueRuns)
        .where(eq(issueRuns.id, runId))
        .limit(1);
    if (!run) {
        return { error: 'run_not_found', runId };
    }
    return { run };
}
async function handleListAgents(args, extra) {
    const db = getDb();
    const argsTyped = args;
    const projectId = resolveProjectId(argsTyped, extra);
    if (!projectId) {
        return { error: 'missing_project_id', hint: 'Pass projectId in args, or set the x-project-id header.' };
    }
    // Wave 10 B9: status defaults to 'active' to keep the LLM picker honest;
    // 'all' or an explicit ('disabled' | 'retired') broadens the scope.
    const statusArg = (argsTyped.status ?? 'active').toLowerCase();
    const validStatuses = new Set(['active', 'disabled', 'retired', 'all']);
    if (!validStatuses.has(statusArg)) {
        return {
            error: 'invalid_status',
            hint: `status must be one of: ${[...validStatuses].join(', ')}`,
        };
    }
    const baseFilter = eq(agents.projectId, projectId);
    const where = statusArg === 'all'
        ? baseFilter
        : and(baseFilter, eq(agents.status, statusArg));
    const rows = await db
        .select({
        id: agents.id,
        name: agents.name,
        role: agents.role,
        model: agents.model,
        status: agents.status,
        charterPath: agents.charterPath,
    })
        .from(agents)
        .where(where)
        .limit(100);
    return { agents: rows, count: rows.length, status: statusArg };
}
async function handleSlashCommandTool(args) {
    const { command } = args;
    const result = await handleSlashCommand(command);
    return result;
}
async function handleListProjects() {
    const db = getDb();
    const rows = await db
        .select({
        id: projects.id,
        name: projects.name,
        path: projects.path,
        defaultModel: projects.defaultModel,
        createdAt: projects.createdAt,
    })
        .from(projects)
        .limit(200);
    const enriched = await Promise.all(rows.map(async (row) => {
        try {
            const resolved = await resolveSquadDir(row.path);
            return {
                ...row,
                squadDir: resolved.ok ? resolved.squadDir : null,
                squadDirOk: resolved.ok,
                squadDirError: resolved.ok ? null : resolved.reason,
            };
        }
        catch (err) {
            return {
                ...row,
                squadDir: null,
                squadDirOk: false,
                squadDirError: err instanceof Error ? err.message : String(err),
            };
        }
    }));
    return { projects: enriched, count: enriched.length };
}
async function handleListInbox(args, extra) {
    const { status, limit } = args;
    const projectId = resolveProjectId(args, extra);
    const rows = await inboxService.listInboxItems({
        status,
        projectId: projectId ?? undefined,
        limit: typeof limit === 'number' && limit > 0 ? Math.min(limit, 200) : 50,
    });
    // Trim payload — drop the long original/formulated bodies for list view.
    const summary = rows.map((row) => ({
        id: row.id,
        status: row.status,
        suggestedProjectId: row.suggestedProjectId,
        suggestedColumn: row.suggestedColumn,
        formulatedTitle: row.formulatedTitle,
        confidence: row.confidence,
        publishedIssueId: row.publishedIssueId,
        createdAt: row.createdAt,
        originalDraftPreview: row.originalDraft.length > 200
            ? `${row.originalDraft.slice(0, 200)}…`
            : row.originalDraft,
    }));
    return { inbox: summary, count: summary.length };
}
async function handleCapture(args, extra) {
    const db = getDb();
    const { prompt, hint, useLlm } = args;
    const projectId = resolveProjectId(args, extra);
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
        return { error: 'missing_prompt', hint: 'Pass a non-empty `prompt` string.' };
    }
    let classification;
    try {
        classification = await classifyAndDraft({
            prompt,
            hint: hint ?? null,
            useLlm: useLlm === false ? false : true,
            context: projectId ? { currentProjectId: projectId, currentProjectName: null } : null,
        });
    }
    catch (err) {
        return {
            error: 'classify_failed',
            message: err instanceof Error ? err.message : String(err),
        };
    }
    // For 'issue' intent + a projectId, materialize the card immediately so the
    // external CLI gets a concrete URL to show. Other intents return draft +
    // routing hint only — they need a UI confirmation step.
    if (classification.intent === 'issue' && projectId) {
        const draft = classification.draft;
        const title = (draft.title ?? prompt.slice(0, 80)).trim() || 'Untitled';
        const body = (draft.body ?? '').toString();
        try {
            const [created] = await db
                .insert(issues)
                .values({
                projectId,
                title,
                body,
                status: 'backlog',
                position: 0,
                archived: 0,
            })
                .returning({
                id: issues.id,
                title: issues.title,
                status: issues.status,
                createdAt: issues.createdAt,
            });
            return {
                action: 'issue_created',
                issue: created,
                classification: {
                    intent: classification.intent,
                    confidence: classification.confidence,
                    rationale: classification.rationale,
                    strategy: classification.strategy,
                },
            };
        }
        catch (err) {
            // Fall through to draft response so the caller still sees the conjure
            // output even if the insert failed (e.g. bad projectId).
            return {
                action: 'issue_create_failed',
                error: err instanceof Error ? err.message : String(err),
                classification,
            };
        }
    }
    return {
        action: 'draft_only',
        note: classification.intent === 'issue'
            ? 'Issue draft ready — pass projectId (or set x-project-id header) to materialize on the board.'
            : `Conjure routed this prompt to "${classification.intent}". Take the draft + routing hint into the matching create flow.`,
        classification,
    };
}
async function handleGetRouting(args, extra) {
    const db = getDb();
    const projectId = resolveProjectId(args, extra);
    if (!projectId) {
        return { error: 'missing_project_id', hint: 'Pass projectId in args, or set the x-project-id header.' };
    }
    const [project] = await db
        .select({ id: projects.id, name: projects.name, path: projects.path })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
    if (!project) {
        return { error: 'project_not_found', projectId };
    }
    const resolved = await resolveSquadDir(project.path);
    if (!resolved.ok) {
        return {
            error: 'squad_dir_unresolved',
            projectId,
            reason: resolved.reason,
            storedPath: project.path,
        };
    }
    const routingMdPath = join(resolved.squadDir, 'routing.md');
    try {
        const contents = await readFile(routingMdPath, 'utf8');
        return {
            projectId,
            projectName: project.name,
            path: routingMdPath,
            bytes: contents.length,
            contents,
        };
    }
    catch (err) {
        const code = err.code;
        if (code === 'ENOENT') {
            return { error: 'routing_md_missing', projectId, path: routingMdPath };
        }
        return {
            error: 'read_failed',
            projectId,
            path: routingMdPath,
            message: err instanceof Error ? err.message : String(err),
        };
    }
}
// ---------------------------------------------------------------------------
// MCP server bootstrap
// ---------------------------------------------------------------------------
export function createMcpServer() {
    const server = new Server({ name: 'squadboard', version: '0.1.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return { tools: TOOLS };
    });
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
        const { name, arguments: toolArgs = {} } = request.params;
        try {
            let result;
            switch (name) {
                case 'list_issues':
                    result = await handleListIssues(toolArgs, extra);
                    break;
                case 'create_issue':
                    result = await handleCreateIssue(toolArgs, extra);
                    break;
                case 'update_issue':
                    result = await handleUpdateIssue(toolArgs);
                    break;
                case 'run_agent':
                    result = await handleRunAgent(toolArgs);
                    break;
                case 'get_run_status':
                    result = await handleGetRunStatus(toolArgs);
                    break;
                case 'list_agents':
                    result = await handleListAgents(toolArgs, extra);
                    break;
                case 'slash_command':
                    result = await handleSlashCommandTool(toolArgs);
                    break;
                case 'list_projects':
                    result = await handleListProjects();
                    break;
                case 'list_inbox':
                    result = await handleListInbox(toolArgs, extra);
                    break;
                case 'capture':
                    result = await handleCapture(toolArgs, extra);
                    break;
                case 'get_routing':
                    result = await handleGetRouting(toolArgs, extra);
                    break;
                default:
                    return {
                        content: [{ type: 'text', text: JSON.stringify({ error: 'unknown_tool', name }) }],
                        isError: true,
                    };
            }
            return {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                content: [{ type: 'text', text: JSON.stringify({ error: 'internal_error', message }) }],
                isError: true,
            };
        }
    });
    return server;
}
//# sourceMappingURL=server.js.map
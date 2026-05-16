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
import { issues, issueRuns, agents, issueLabels, projects, inboxItems } from '../db/schema.js';
import { eq, and, ilike, or } from 'drizzle-orm';
import { handleSlashCommand } from './slash-handler.js';
import { classifyAndDraft } from '../services/conjure-classifier.js';
import * as inboxService from '../services/inbox.js';
import { resolveSquadDir } from '../services/diagnostics.js';
import { createIssue as createIssueService } from '../services/issues.js';
import { pushBranch, createPr, commentOnIssue, triggerWorkflow, mergePr, GitOpsError, } from '../services/github-git-ops.js';
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
            "projectId may be omitted if the request includes an 'x-project-id' header. " +
            "Prefix the prompt with 'done: ' to close an existing card by fuzzy-matching its title.",
        inputSchema: {
            type: 'object',
            properties: {
                prompt: {
                    type: 'string',
                    description: "The free-form prose to capture. Prefix with 'done: ' to close an existing card " +
                        "(e.g. 'done: Fixed the login bug (sha=abc123)').",
                },
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
                idempotencyKey: {
                    type: 'string',
                    description: 'Optional caller-supplied dedup key. A second call with the same key returns the ' +
                        'existing card without creating a duplicate.',
                },
                createdBy: {
                    type: 'string',
                    enum: ['user', 'copilot-cli', 'squadboard-server', 'webhook'],
                    description: "Provenance tag. Defaults to 'user'.",
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
    // ── Stream G Phase 2B: GitHub tools ───────────────────────────────────────
    {
        name: 'github_push_branch',
        description: 'Push the current run\'s worktree branch to GitHub origin. ' +
            'Call this after the agent has committed changes to the worktree. ' +
            'Returns the branch URL so you can share or open a PR next.',
        inputSchema: {
            type: 'object',
            properties: {
                runId: { type: 'string', description: 'UUID of the issue run whose worktree branch to push.' },
            },
            required: ['runId'],
        },
    },
    {
        name: 'github_open_pr',
        description: 'Open a GitHub Pull Request for the current run\'s branch. ' +
            'Requires a branch push (github_push_branch) first. ' +
            'Returns prUrl and prNumber for use in comments or status badges.',
        inputSchema: {
            type: 'object',
            properties: {
                runId: { type: 'string', description: 'UUID of the issue run.' },
                title: { type: 'string', description: 'PR title (optional — defaults to the issue title).' },
                body: { type: 'string', description: 'PR body markdown (optional — auto-generated if omitted).' },
                draft: { type: 'boolean', description: 'Open as a draft PR (default false).' },
            },
            required: ['runId'],
        },
    },
    {
        name: 'github_comment_issue',
        description: 'Post a comment on the linked GitHub issue. ' +
            'Use this to report progress, paste summaries, or leave a handoff note for human reviewers.',
        inputSchema: {
            type: 'object',
            properties: {
                runId: { type: 'string', description: 'UUID of the issue run (provides repo context via its workspace).' },
                issueNumber: { type: 'number', description: 'GitHub issue number to comment on.' },
                body: { type: 'string', description: 'Comment body in Markdown.' },
            },
            required: ['runId', 'issueNumber', 'body'],
        },
    },
    {
        name: 'github_trigger_workflow',
        description: 'Dispatch a GitHub Actions workflow_dispatch event. ' +
            'Use this to trigger CI pipelines, deployment workflows, or other automated processes. ' +
            'Returns the workflow run ID and URL once it is queued.',
        inputSchema: {
            type: 'object',
            properties: {
                workflowFile: {
                    type: 'string',
                    description: 'Workflow filename, e.g. "deploy.yml" or "ci.yaml". No path separators.',
                },
                ref: { type: 'string', description: 'Git ref (branch name, tag, or SHA) to run the workflow on.' },
                inputs: {
                    type: 'object',
                    additionalProperties: { type: 'string' },
                    description: 'Optional key-value pairs passed as workflow_dispatch inputs.',
                },
            },
            required: ['workflowFile', 'ref'],
        },
    },
    {
        name: 'github_merge_pr',
        description: 'Merge the open PR associated with this run. ' +
            'Validates required CI checks first; refuses if checks are failing. ' +
            'Returns the merge SHA and the PR URL after a successful merge.',
        inputSchema: {
            type: 'object',
            properties: {
                runId: { type: 'string', description: 'UUID of the issue run whose PR to merge.' },
                method: {
                    type: 'string',
                    enum: ['squash', 'merge', 'rebase'],
                    description: 'Merge strategy (default "squash").',
                },
            },
            required: ['runId'],
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
    const { title, body = '', idempotencyKey, } = args;
    const projectId = resolveProjectId(args, extra);
    if (!projectId) {
        return { error: 'missing_project_id', hint: 'Pass projectId in args, or set the x-project-id header.' };
    }
    return createIssueService({
        projectId,
        title,
        body,
        status: 'backlog',
        position: 0,
        archived: false,
        idempotencyKey,
        createdBy: 'mcp',
    });
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
    const { prompt, hint, useLlm, idempotencyKey, createdBy } = args;
    const projectId = resolveProjectId(args, extra);
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
        return { error: 'missing_prompt', hint: 'Pass a non-empty `prompt` string.' };
    }
    const normalizedPrompt = prompt.trim();
    // ── N1: done: prefix — close out an existing card ────────────────────────
    const DONE_PREFIX = /^done:\s*/i;
    if (DONE_PREFIX.test(normalizedPrompt)) {
        const descriptor = normalizedPrompt.replace(DONE_PREFIX, '').trim();
        return handleCaptureClose(descriptor, projectId, idempotencyKey);
    }
    // ── N2: idempotency dedup on inbox_items ──────────────────────────────────
    if (idempotencyKey) {
        const existing = await db
            .select({ id: inboxItems.id, status: inboxItems.status, publishedIssueId: inboxItems.publishedIssueId })
            .from(inboxItems)
            .where(eq(inboxItems.idempotencyKey, idempotencyKey))
            .limit(1);
        if (existing.length > 0) {
            return { action: 'dedup', idempotencyKey, inboxItemId: existing[0].id, status: existing[0].status };
        }
    }
    let classification;
    try {
        classification = await classifyAndDraft({
            prompt: normalizedPrompt,
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
        const title = (draft.title ?? normalizedPrompt.slice(0, 80)).trim() || 'Untitled';
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
            // Persist the inbox_items row for idempotency tracking, linking back to
            // the created issue.
            if (idempotencyKey || createdBy) {
                try {
                    await db.insert(inboxItems).values({
                        originalDraft: normalizedPrompt,
                        formulatedTitle: title,
                        formulatedBody: body,
                        status: 'published',
                        publishedIssueId: created.id,
                        ...(projectId ? { suggestedProjectId: projectId } : {}),
                        ...(idempotencyKey ? { idempotencyKey } : {}),
                        createdBy: createdBy ?? 'copilot-cli',
                    });
                }
                catch {
                    // idempotency row insertion is best-effort; don't fail the main capture
                }
            }
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
// ── N1: done: close-out helper ──────────────────────────────────────────────
// Tokenise the descriptor, find the best matching open issue in the project,
// and move it to 'done'. If no match is found, create a standalone done card.
async function handleCaptureClose(descriptor, projectId, idempotencyKey) {
    if (!projectId) {
        return {
            error: 'missing_project_id',
            hint: "Pass projectId (or x-project-id header) when using the 'done:' prefix.",
        };
    }
    // N2 idempotency: if we've already processed this close, return early.
    const db = getDb();
    if (idempotencyKey) {
        const existing = await db
            .select({ id: inboxItems.id, status: inboxItems.status, publishedIssueId: inboxItems.publishedIssueId })
            .from(inboxItems)
            .where(eq(inboxItems.idempotencyKey, idempotencyKey))
            .limit(1);
        if (existing.length > 0) {
            return {
                action: 'dedup',
                idempotencyKey,
                inboxItemId: existing[0].id,
                linkedIssueId: existing[0].publishedIssueId,
            };
        }
    }
    // Tokenise: extract words ≥ 3 chars, lower-cased, strip common stop-words.
    const STOP = new Set([
        'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her',
        'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how',
        'its', 'let', 'man', 'new', 'now', 'old', 'see', 'two', 'way', 'who',
        'did', 'with', 'from', 'that', 'this', 'they', 'what', 'when', 'will',
        'been', 'have', 'into', 'more', 'also', 'than', 'then', 'sha=',
        'fixed', 'fix', 'done', 'closes', 'resolves', 'implements',
    ]);
    const tokens = descriptor
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length >= 3 && !STOP.has(t));
    let matchedIssue = null;
    if (tokens.length > 0) {
        // Query open issues in the project. Use a LIKE clause on any token to
        // narrow the candidate set, then rank by token overlap in JS.
        const likeConditions = tokens.slice(0, 5).map((t) => ilike(issues.title, `%${t}%`));
        const candidates = await db
            .select({ id: issues.id, title: issues.title, status: issues.status })
            .from(issues)
            .where(and(eq(issues.projectId, projectId), eq(issues.archived, 0), or(...likeConditions)))
            .limit(20);
        // Score: count how many query tokens appear in the candidate title.
        let bestScore = 0;
        for (const c of candidates) {
            const titleLower = c.title.toLowerCase();
            const score = tokens.filter((t) => titleLower.includes(t)).length;
            if (score > bestScore) {
                bestScore = score;
                matchedIssue = c;
            }
        }
        // Require at least 2 matching tokens to avoid false positives on very short
        // descriptors (single-token match is too ambiguous).
        if (bestScore < 2 && tokens.length > 1)
            matchedIssue = null;
        // For a 1-token descriptor, require 1 match.
        if (tokens.length === 1 && bestScore < 1)
            matchedIssue = null;
    }
    if (matchedIssue) {
        // Move the matched card to done.
        await db
            .update(issues)
            .set({ status: 'done', updatedAt: new Date() })
            .where(and(eq(issues.id, matchedIssue.id), eq(issues.projectId, projectId)));
        // Persist idempotency record if key provided.
        if (idempotencyKey) {
            try {
                await db.insert(inboxItems).values({
                    originalDraft: `done: ${descriptor}`,
                    formulatedTitle: matchedIssue.title,
                    status: 'published',
                    publishedIssueId: matchedIssue.id,
                    suggestedProjectId: projectId,
                    idempotencyKey,
                    createdBy: 'copilot-cli',
                });
            }
            catch { /* best-effort */ }
        }
        return {
            action: 'issue_closed',
            matchedIssue: { id: matchedIssue.id, title: matchedIssue.title, previousStatus: matchedIssue.status },
            descriptor,
        };
    }
    // No match — create a standalone done card so the work is visible on the board.
    const [created] = await db
        .insert(issues)
        .values({
        projectId,
        title: descriptor.slice(0, 120) || 'Done (no match)',
        body: `Closed via \`capture done:\` — no matching open card found.\n\nDescriptor: ${descriptor}`,
        status: 'done',
        position: 0,
        archived: 0,
    })
        .returning({ id: issues.id, title: issues.title, status: issues.status });
    if (idempotencyKey) {
        try {
            await db.insert(inboxItems).values({
                originalDraft: `done: ${descriptor}`,
                formulatedTitle: created.title,
                status: 'published',
                publishedIssueId: created.id,
                suggestedProjectId: projectId,
                idempotencyKey,
                createdBy: 'copilot-cli',
            });
        }
        catch { /* best-effort */ }
    }
    return {
        action: 'standalone_done_card_created',
        issue: created,
        note: 'No matching open card found — created a standalone done card instead.',
        descriptor,
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
// Stream G Phase 2B: GitHub tool handlers
// ---------------------------------------------------------------------------
function gitOpsErrorToResult(err) {
    if (err instanceof GitOpsError) {
        return { error: err.code, message: err.detail, httpStatus: err.httpStatus };
    }
    return { error: 'internal_error', message: err instanceof Error ? err.message : String(err) };
}
async function handleGithubPushBranch(args) {
    const { runId } = args;
    if (!runId || typeof runId !== 'string') {
        return { error: 'missing_run_id', hint: 'Pass runId (UUID of the issue run).' };
    }
    try {
        return await pushBranch(runId);
    }
    catch (err) {
        return gitOpsErrorToResult(err);
    }
}
async function handleGithubOpenPr(args) {
    const { runId, title, body, draft } = args;
    if (!runId || typeof runId !== 'string') {
        return { error: 'missing_run_id', hint: 'Pass runId (UUID of the issue run).' };
    }
    try {
        return await createPr(runId, { title, body, draft });
    }
    catch (err) {
        return gitOpsErrorToResult(err);
    }
}
async function handleGithubCommentIssue(args) {
    const { runId, issueNumber, body } = args;
    if (!runId || typeof runId !== 'string') {
        return { error: 'missing_run_id', hint: 'Pass runId (UUID of the issue run).' };
    }
    if (typeof issueNumber !== 'number' || !Number.isInteger(issueNumber) || issueNumber < 1) {
        return { error: 'invalid_issue_number', hint: '`issueNumber` must be a positive integer.' };
    }
    if (typeof body !== 'string' || !body.trim()) {
        return { error: 'missing_body', hint: '`body` must be a non-empty string.' };
    }
    try {
        return await commentOnIssue(runId, { issueNumber, body });
    }
    catch (err) {
        return gitOpsErrorToResult(err);
    }
}
async function handleGithubTriggerWorkflow(args) {
    const { workflowFile, ref, inputs } = args;
    if (!workflowFile || typeof workflowFile !== 'string') {
        return { error: 'missing_workflow_file', hint: 'Pass workflowFile, e.g. "deploy.yml".' };
    }
    if (!ref || typeof ref !== 'string') {
        return { error: 'missing_ref', hint: 'Pass ref (branch name, tag, or SHA).' };
    }
    try {
        return await triggerWorkflow({ workflowFile, ref, inputs });
    }
    catch (err) {
        return gitOpsErrorToResult(err);
    }
}
async function handleGithubMergePr(args) {
    const { runId, method } = args;
    if (!runId || typeof runId !== 'string') {
        return { error: 'missing_run_id', hint: 'Pass runId (UUID of the issue run).' };
    }
    const validMethods = new Set(['squash', 'merge', 'rebase']);
    if (method !== undefined && !validMethods.has(method)) {
        return { error: 'invalid_method', hint: 'method must be "squash", "merge", or "rebase".' };
    }
    try {
        return await mergePr(runId, { method });
    }
    catch (err) {
        return gitOpsErrorToResult(err);
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
                // ── Stream G Phase 2B: GitHub tools ──────────────────────────────
                case 'github_push_branch':
                    result = await handleGithubPushBranch(toolArgs);
                    break;
                case 'github_open_pr':
                    result = await handleGithubOpenPr(toolArgs);
                    break;
                case 'github_comment_issue':
                    result = await handleGithubCommentIssue(toolArgs);
                    break;
                case 'github_trigger_workflow':
                    result = await handleGithubTriggerWorkflow(toolArgs);
                    break;
                case 'github_merge_pr':
                    result = await handleGithubMergePr(toolArgs);
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
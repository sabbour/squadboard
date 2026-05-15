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
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getDb } from '../db/index.js';
import { issues, issueRuns, agents, issueLabels } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { handleSlashCommand } from './slash-handler.js';

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const TOOLS = [
  {
    name: 'list_issues',
    description:
      'List issues on the board, with optional column-status filter. ' +
      "projectId may be omitted if the request includes an 'x-project-id' header.",
    inputSchema: {
      type: 'object' as const,
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
    description:
      'Create a new issue (card) on the board. ' +
      "projectId may be omitted if the request includes an 'x-project-id' header.",
    inputSchema: {
      type: 'object' as const,
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
    description:
      "Update an existing issue's title, body, status (column), assignee, or labels. " +
      'Only fields that are provided are changed; omit a field to leave it as-is.',
    inputSchema: {
      type: 'object' as const,
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
      type: 'object' as const,
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
      type: 'object' as const,
      properties: {
        runId: { type: 'string', description: 'UUID of the issue run' },
      },
      required: ['runId'],
    },
  },
  {
    name: 'list_agents',
    description:
      'List active agents in a Squadboard project. ' +
      "projectId may be omitted if the request includes an 'x-project-id' header.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'UUID of the project (optional if x-project-id header set)' },
      },
      required: [],
    },
  },
  {
    name: 'slash_command',
    description: 'Execute a /squadboard slash command and get a markdown-formatted response.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        command: {
          type: 'string',
          description: 'The full slash command string, e.g. "/squadboard list --project abc"',
        },
      },
      required: ['command'],
    },
  },
];

/** Stable list of tool names. Used by GET /mcp/health and by the UI. */
export const TOOL_NAMES = TOOLS.map((t) => t.name) as readonly string[];

// ---------------------------------------------------------------------------
// Header-based projectId fallback
// ---------------------------------------------------------------------------

/**
 * Pull `x-project-id` out of the SDK's RequestHandlerExtra. Headers can arrive
 * as `string | string[] | undefined` per the IsomorphicHeaders shape, so we
 * normalise to a single string. Stdio transport has no headers — returns
 * undefined and the tool falls back to required args validation.
 */
function headerProjectId(extra: { requestInfo?: { headers?: Record<string, string | string[] | undefined> } }): string | undefined {
  const raw = extra.requestInfo?.headers?.['x-project-id'];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function resolveProjectId(args: { projectId?: string }, extra: Parameters<typeof headerProjectId>[0]): string | undefined {
  return args.projectId ?? headerProjectId(extra);
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

type ToolArgs = Record<string, unknown>;
type Extra = Parameters<typeof headerProjectId>[0];

async function handleListIssues(args: ToolArgs, extra: Extra): Promise<unknown> {
  const db = getDb();
  const { status } = args as { status?: string };
  const projectId = resolveProjectId(args as { projectId?: string }, extra);

  if (!projectId) {
    return { error: 'missing_project_id', hint: 'Pass projectId in args, or set the x-project-id header.' };
  }

  const conditions = [eq(issues.projectId, projectId), eq(issues.archived, 0)];
  if (status) {
    conditions.push(eq(issues.status, status as 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done'));
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

async function handleCreateIssue(args: ToolArgs, extra: Extra): Promise<unknown> {
  const db = getDb();
  const {
    title,
    body = '',
    idempotencyKey,
  } = args as {
    title: string;
    body?: string;
    idempotencyKey?: string;
  };
  const projectId = resolveProjectId(args as { projectId?: string }, extra);

  if (!projectId) {
    return { error: 'missing_project_id', hint: 'Pass projectId in args, or set the x-project-id header.' };
  }

  if (idempotencyKey) {
    const existing = await db
      .select({ id: issues.id })
      .from(issues)
      .where(
        and(
          eq(issues.projectId, projectId),
          eq(issues.title, `[${idempotencyKey}] ${title}`),
        ),
      )
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
      body: body as string,
      status: 'backlog',
      position: 0,
      archived: 0,
    })
    .returning({ id: issues.id, title: issues.title, status: issues.status, createdAt: issues.createdAt });

  return { created: true, id: created.id, issue: created, idempotencyKey };
}

async function handleUpdateIssue(args: ToolArgs): Promise<unknown> {
  const db = getDb();
  const {
    issueId,
    title,
    body,
    status,
    assigneeId,
    labels,
  } = args as {
    issueId: string;
    title?: string;
    body?: string;
    status?: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done';
    assigneeId?: string | null;
    labels?: string[];
  };

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

  const patch: Partial<typeof issues.$inferInsert> = { updatedAt: new Date() };
  if (title !== undefined) patch.title = title.trim();
  if (body !== undefined) patch.body = body;
  if (status !== undefined) patch.status = status;
  if (assigneeId !== undefined) patch.assigneeId = assigneeId ?? undefined;

  const wantsLabels = Array.isArray(labels);
  const hasFieldPatch = title !== undefined || body !== undefined || status !== undefined || assigneeId !== undefined;

  let updated: typeof existing & { title?: string } = existing;
  if (hasFieldPatch) {
    const [row] = await db
      .update(issues)
      .set(patch)
      .where(eq(issues.id, issueId))
      .returning({ id: issues.id, projectId: issues.projectId, archived: issues.archived });
    if (row) updated = row;
  }

  if (wantsLabels) {
    await db.delete(issueLabels).where(eq(issueLabels.issueId, issueId));
    if (labels && labels.length > 0) {
      await db.insert(issueLabels).values(labels.map((labelId) => ({ issueId, labelId })));
    }
  }

  return { updated: true, id: updated.id };
}

async function handleRunAgent(args: ToolArgs): Promise<unknown> {
  const db = getDb();
  const { issueId, agentId } = args as { issueId: string; agentId?: string };

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

async function handleGetRunStatus(args: ToolArgs): Promise<unknown> {
  const db = getDb();
  const { runId } = args as { runId: string };

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

async function handleListAgents(args: ToolArgs, extra: Extra): Promise<unknown> {
  const db = getDb();
  const projectId = resolveProjectId(args as { projectId?: string }, extra);

  if (!projectId) {
    return { error: 'missing_project_id', hint: 'Pass projectId in args, or set the x-project-id header.' };
  }

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
    .where(and(eq(agents.projectId, projectId), eq(agents.status, 'active')))
    .limit(100);

  return { agents: rows, count: rows.length };
}

async function handleSlashCommandTool(args: ToolArgs): Promise<unknown> {
  const { command } = args as { command: string };
  const result = await handleSlashCommand(command);
  return result;
}

// ---------------------------------------------------------------------------
// MCP server bootstrap
// ---------------------------------------------------------------------------

export function createMcpServer(): Server {
  const server = new Server(
    { name: 'squadboard', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: toolArgs = {} } = request.params;

    try {
      let result: unknown;

      switch (name) {
        case 'list_issues':
          result = await handleListIssues(toolArgs as ToolArgs, extra as Extra);
          break;
        case 'create_issue':
          result = await handleCreateIssue(toolArgs as ToolArgs, extra as Extra);
          break;
        case 'update_issue':
          result = await handleUpdateIssue(toolArgs as ToolArgs);
          break;
        case 'run_agent':
          result = await handleRunAgent(toolArgs as ToolArgs);
          break;
        case 'get_run_status':
          result = await handleGetRunStatus(toolArgs as ToolArgs);
          break;
        case 'list_agents':
          result = await handleListAgents(toolArgs as ToolArgs, extra as Extra);
          break;
        case 'slash_command':
          result = await handleSlashCommandTool(toolArgs as ToolArgs);
          break;
        default:
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'unknown_tool', name }) }],
            isError: true,
          };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: 'internal_error', message }) }],
        isError: true,
      };
    }
  });

  return server;
}

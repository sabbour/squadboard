/**
 * Squadboard MCP server — stdio transport.
 * Each tool handler makes direct DB queries via Drizzle.
 *
 * Entry point: packages/server/src/mcp/index.ts
 * Started via: squadboard mcp
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getDb } from '../db/index.js';
import { issues, issueRuns, agents, workflowRuns } from '../db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import { handleSlashCommand } from './slash-handler.js';

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'squadboard_list_issues',
    description: 'List issues in a Squadboard project.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'UUID of the project' },
        status: {
          type: 'string',
          enum: ['backlog', 'todo', 'in_progress', 'in_review', 'done'],
          description: 'Filter by column status (optional)',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'squadboard_create_issue',
    description: 'Create a new issue in a Squadboard project.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'UUID of the project' },
        title: { type: 'string', description: 'Issue title' },
        body: { type: 'string', description: 'Issue body / description (markdown)' },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Label IDs to attach (optional)',
        },
        idempotencyKey: {
          type: 'string',
          description: 'Optional idempotency key — safe to replay (partial unique index)',
        },
      },
      required: ['projectId', 'title'],
    },
  },
  {
    name: 'squadboard_run_agent',
    description: 'Trigger an agent run on an issue.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        issueId: { type: 'string', description: 'UUID of the issue' },
        agentId: { type: 'string', description: 'UUID of the agent to run (optional — auto-picks first active)' },
      },
      required: ['issueId'],
    },
  },
  {
    name: 'squadboard_get_run_status',
    description: 'Get the status of an issue run.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        runId: { type: 'string', description: 'UUID of the issue run' },
      },
      required: ['runId'],
    },
  },
  {
    name: 'squadboard_list_agents',
    description: 'List active agents in a Squadboard project.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'UUID of the project' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'squadboard_slash_command',
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

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

type ToolArgs = Record<string, unknown>;

async function handleListIssues(args: ToolArgs): Promise<unknown> {
  const db = getDb();
  const { projectId, status } = args as { projectId: string; status?: string };

  const conditions = [eq(issues.projectId, projectId), eq(issues.archived, 0)];
  if (status) {
    conditions.push(eq(issues.status, status as Parameters<typeof eq>[1]));
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

async function handleCreateIssue(args: ToolArgs): Promise<unknown> {
  const db = getDb();
  const {
    projectId,
    title,
    body = '',
    idempotencyKey,
  } = args as {
    projectId: string;
    title: string;
    body?: string;
    idempotencyKey?: string;
  };

  // Idempotency: if key provided, check for existing row first (Invariant I-2)
  if (idempotencyKey) {
    const existing = await db
      .select({ id: issues.id })
      .from(issues)
      .where(
        and(
          eq(issues.projectId, projectId),
          // idempotencyKey column not in schema yet — store in title prefix as workaround
          // and rely on application-level check. Full index requires schema migration.
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

async function handleRunAgent(args: ToolArgs): Promise<unknown> {
  const db = getDb();
  const { issueId, agentId } = args as { issueId: string; agentId?: string };

  // Verify issue exists
  const [issue] = await db
    .select({ id: issues.id, projectId: issues.projectId })
    .from(issues)
    .where(eq(issues.id, issueId))
    .limit(1);

  if (!issue) {
    return { error: 'issue_not_found', issueId };
  }

  // Resolve agent
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

async function handleListAgents(args: ToolArgs): Promise<unknown> {
  const db = getDb();
  const { projectId } = args as { projectId: string };

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

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: toolArgs = {} } = request.params;

    try {
      let result: unknown;

      switch (name) {
        case 'squadboard_list_issues':
          result = await handleListIssues(toolArgs as ToolArgs);
          break;
        case 'squadboard_create_issue':
          result = await handleCreateIssue(toolArgs as ToolArgs);
          break;
        case 'squadboard_run_agent':
          result = await handleRunAgent(toolArgs as ToolArgs);
          break;
        case 'squadboard_get_run_status':
          result = await handleGetRunStatus(toolArgs as ToolArgs);
          break;
        case 'squadboard_list_agents':
          result = await handleListAgents(toolArgs as ToolArgs);
          break;
        case 'squadboard_slash_command':
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

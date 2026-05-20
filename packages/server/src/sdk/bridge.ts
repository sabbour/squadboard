import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Agent } from '../db/schema.js';
import { getDb } from '../db/index.js';
import { issueRuns, projects as projectsTable } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { AgentRunTimeoutError, createAgentSession } from './squad-client.js';
import type { AgentSessionEvent } from './squad-client.js';
import { OutputStreamer } from './output-streamer.js';
import { CostTracker } from './cost-tracker.js';
import { BudgetGuard, BudgetExceededError } from './budget-guard.js';
import { BUILTIN_FALLBACK } from './model-defaults.js';
import { RunningIssueSessionImpl } from './issue-stream.js';
import {
  buildAgentSpawnPrompt,
  type SpawnMcpServerContext,
  type SpawnSkillContext,
} from './spawn-prompt.js';

export type { IssueRun } from '../db/schema.js';

/**
 * Regex for a plausible model id: starts with a lowercase letter, contains
 * only lowercase alphanum, dots, or hyphens, and is ≤40 chars.
 * Intentionally permissive for future model ids while catching parser garbage.
 */
const VALID_MODEL_RE = /^[a-z][a-z0-9.\-]{0,39}$/;

/**
 * Boundary validator for agent model strings arriving from the DB.
 * If the value looks like parser garbage (spaces, backticks, double-asterisks,
 * or > 40 chars), log a structured warning and return null so the resolution
 * chain falls through to project default or BUILTIN_FALLBACK.
 */
function validateModel(model: string | null | undefined, agentName: string): string | null {
  if (model == null) return null;
  const suspicious =
    model.includes(' ') ||
    model.includes('`') ||
    model.includes('**') ||
    model.length > 40 ||
    !VALID_MODEL_RE.test(model);
  if (suspicious) {
    console.warn(`[bridge] suspicious model rejected: ${agentName} ${model}`);
    return null;
  }
  return model;
}

function trimTrailingSeparators(value: string): string {
  return value.replace(/[\\/]+$/, '');
}

function teamRootFromSquadPath(projectSquadPath: string, workspacePath: string): string {
  const candidate = trimTrailingSeparators(projectSquadPath || workspacePath);
  if (!candidate) return workspacePath;
  return path.basename(candidate) === '.squad' ? path.dirname(candidate) : candidate;
}

function requesterName(): string {
  return (
    process.env.SQUADBOARD_REQUESTER_NAME ||
    process.env.GIT_AUTHOR_NAME ||
    process.env.USER ||
    process.env.USERNAME ||
    'Unknown requester'
  );
}

async function loadAssignedSpawnContext(
  projectId: string,
  agentId: string,
): Promise<{ assignedSkills: SpawnSkillContext[]; assignedMcpServers: SpawnMcpServerContext[] }> {
  const [skillsResult, mcpResult] = await Promise.allSettled([
    import('../services/skills.js').then((mod) => mod.listAgentSkills(projectId, agentId)),
    import('../services/mcp.js').then((mod) => mod.listAgentMcpServers(projectId, agentId)),
  ]);

  return {
    assignedSkills: skillsResult.status === 'fulfilled' ? skillsResult.value : [],
    assignedMcpServers: mcpResult.status === 'fulfilled' ? mcpResult.value : [],
  };
}

export interface AgentRunInput {
  issueRunId: string;
  projectId: string; // needed for budget guard
  agent: Agent;
  issueTitle: string;
  issueBody: string;
  workspacePath: string;
  projectSquadPath: string; // path to .squad/ directory
  workspaceStrategy?: string | null;
  timeoutMs?: number;
}

export interface AgentRunOutput {
  success: boolean;
  output: string;
  tokensUsed?: number;
  costUsd?: string;
  errorMessage?: string;
  budgetExceeded?: boolean;
  timedOut?: boolean;
}

function pickString(obj: unknown, ...keys: string[]): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const o = obj as Record<string, unknown>;
  for (const key of keys) {
    const value = o[key];
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
      const nested = pickString(value, ...keys);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function trimOutputSummary(output: string, max = 240): string {
  const oneLine = output.replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

function parseStructuredOutput(output: string): {
  structuredOutput?: unknown;
  structuredOutputSource?: 'json' | 'fenced-json';
} {
  const trimmed = output.trim();
  if (!trimmed) return {};
  try {
    return { structuredOutput: JSON.parse(trimmed), structuredOutputSource: 'json' };
  } catch {
    // Fall through to fenced JSON extraction.
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (!fenced?.[1]) return {};
  try {
    return { structuredOutput: JSON.parse(fenced[1]), structuredOutputSource: 'fenced-json' };
  } catch {
    return {};
  }
}

async function forwardAgentSessionEvent(
  session: RunningIssueSessionImpl,
  event: AgentSessionEvent,
): Promise<void> {
  const payload = event.payload;
  switch (event.type) {
    case 'session.created':
      await session.emit('issue.run.metric', {
        kind: 'sdk_session',
        status: 'running',
        ...payload,
      });
      return;
    case 'message_delta':
      await session.emit('issue.run.token', {
        kind: 'message_delta',
        delta: pickString(payload, 'delta', 'content', 'text') ?? '',
      });
      return;
    case 'reasoning_delta':
      await session.emit('issue.run.token', {
        kind: 'reasoning_delta',
        delta: pickString(payload, 'delta', 'content', 'text') ?? '',
      });
      return;
    case 'usage':
      await session.emit('issue.run.token', {
        kind: 'usage',
        ...payload,
      });
      return;
    case 'tool.call':
      await session.emit('issue.run.tool_call', payload);
      return;
    case 'tool.result':
      await session.emit('issue.run.tool_result', payload);
      return;
    case 'turn_start':
    case 'turn_end':
    case 'idle':
      await session.emit('issue.run.metric', {
        kind: 'activity',
        phase: event.type,
        ...payload,
      });
      return;
    case 'error':
      await session.emit('issue.run.error', {
        message: pickString(payload, 'message', 'error') ?? 'SDK session error',
        ...payload,
      });
      return;
  }
}

// ---------------------------------------------------------------------------
// Invariant 1 — the ONE function the stepper calls for an agent_run step.
// Engine reads task.assignee directly from the agent record and calls
// SquadClient.createSession() directly — SquadCoordinator is never invoked.
// ---------------------------------------------------------------------------
export async function executeAgentRun(input: AgentRunInput): Promise<AgentRunOutput> {
  const db = getDb();
  const streamer = new OutputStreamer(input.issueRunId, db);
  const tracker = new CostTracker(input.issueRunId, db);
  const startTime = Date.now();

  // Budget guard check (opt-in: no-op if project has no budget configured)
  try {
    await BudgetGuard.check(input.projectId);
  } catch (err: unknown) {
    if (err instanceof BudgetExceededError) {
      return {
        success: false,
        output: '',
        errorMessage: err.message,
        budgetExceeded: true,
      };
    }
    throw err;
  }

  // JIS-T3: Create the running session BEFORE the try block so that dispose()
  // is always reachable in finally, even if the SDK call itself throws.
  const session = new RunningIssueSessionImpl({
    runId: input.issueRunId,
    projectId: input.projectId,
    sdkClient: null, // one-shot bridge runs have no interactive SDK client
  });

  try {
    // Emit start event so WS clients see the run begin immediately.
    await session.emit('issue.run.start', {
      agentName: input.agent.name,
      taskTitle: input.issueTitle,
    }).catch(() => {});

    // 1. Resolve agent charter from disk.
    const charter = await readFile(input.agent.charterPath, 'utf8').catch(() => '');

    // 2. Build session context.
    const assignedContext = await loadAssignedSpawnContext(input.projectId, input.agent.id);
    const spawnPrompt = buildAgentSpawnPrompt({
      agentName: input.agent.name,
      agentRole: input.agent.role,
      charter,
      teamRoot: teamRootFromSquadPath(input.projectSquadPath, input.workspacePath),
      currentDateTime: new Date().toISOString(),
      requesterName: requesterName(),
      workspacePath: input.workspacePath,
      workspaceMode: input.workspaceStrategy ?? 'dir',
      taskTitle: input.issueTitle,
      taskBody: input.issueBody,
      assignedSkills: assignedContext.assignedSkills,
      assignedMcpServers: assignedContext.assignedMcpServers,
    });

    // 3. Look up project default model (auto-resolution chain).
    const [projectRow] = await db
      .select({ defaultModel: projectsTable.defaultModel })
      .from(projectsTable)
      .where(eq(projectsTable.id, input.projectId));

    // 4. Call SquadClient.createSession() directly (bypass SquadCoordinator).
    const result = await createAgentSession({
      agentName: input.agent.name,
      charterPath: input.agent.charterPath,
      workspacePath: input.workspacePath,
      squadPath: input.projectSquadPath,
      task: `Begin the assigned issue run now: ${input.issueTitle}`,
      systemPrompt: spawnPrompt,
      agentModel: validateModel(input.agent.model ?? null, input.agent.name),
      projectDefaultModel: projectRow?.defaultModel ?? null,
      onEvent: (event) => forwardAgentSessionEvent(session, event),
      timeoutMs: input.timeoutMs,
    });

    // Emit turn event with the agent's response text.
    await session.emit('issue.run.turn', {
      agentName: input.agent.name,
      content: result.output,
    }).catch(() => {});

    // 5. Stream output to DB.
    await streamer.write(result.output);
    await streamer.flush();

    // 6. Record costs with granular input/output split, using resolved model id
    // so cost tracker always has a real pricing key (never 'auto'/null).
    const modelId = result.resolvedModel || BUILTIN_FALLBACK;
    if (result.inputTokens != null && result.outputTokens != null) {
      await tracker.recordCost(result.inputTokens, result.outputTokens, modelId);
      // Emit metric event with token split.
      await session.emit('issue.run.metric', {
        agentName: input.agent.name,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        model: modelId,
      }).catch(() => {});
    } else {
      await tracker.record(result.tokensUsed, result.costUsd);
    }

    const durationMs = Date.now() - startTime;

    // Emit finish event with summary metrics.
    await session.emit('issue.run.finish', {
      agentName: input.agent.name,
      status: 'completed',
      durationMs,
      cost: result.costUsd,
      outputAvailable: Boolean(result.output),
      outputSummary: trimOutputSummary(result.output),
      ...parseStructuredOutput(result.output),
      tokenCounts: {
        input: result.inputTokens,
        output: result.outputTokens,
        total: result.tokensUsed,
      },
    }).catch(() => {});

    // Mark run success.
    await db
      .update(issueRuns)
      .set({ status: 'completed' })
      .where(eq(issueRuns.id, input.issueRunId));

    return {
      success: true,
      output: result.output,
      tokensUsed: result.tokensUsed,
      costUsd: result.costUsd,
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Emit error event — catch any secondary error so we don't obscure the original.
    await session.emit('issue.run.error', {
      message: errorMessage,
      errorMessage,
      status: err instanceof AgentRunTimeoutError ? 'timed_out' : 'failed',
    }).catch(() => {});

    if (err instanceof AgentRunTimeoutError) {
      return { success: false, output: '', errorMessage, timedOut: true };
    }

    await db
      .update(issueRuns)
      .set({ status: 'failed', errorMessage })
      .where(eq(issueRuns.id, input.issueRunId));
    return { success: false, output: '', errorMessage };
  } finally {
    // Always clean up the session to unregister from activeIssueSessions.
    await session.dispose().catch((e) => {
      console.warn(`[bridge] session dispose failed for run ${input.issueRunId}:`, e);
    });
  }
}

// ---------------------------------------------------------------------------
// Test/local-hacking override — forces an immediate offline briefing without
// hitting any LLM backend. Mirrors the offline-briefing path in squad-client
// but resolves instantly (no subprocess spawning, no 2 s delay).
// ---------------------------------------------------------------------------
export async function executeAgentRunStub(input: AgentRunInput): Promise<AgentRunOutput> {
  const output =
    `# Agent Task Briefing — ${input.agent.name} (forced-stub)\n\n` +
    `**Workspace:** \`${input.workspacePath}\`\n\n` +
    `## Task\n${input.issueTitle}\n\n${input.issueBody}`;

  return {
    success: true,
    output,
    tokensUsed: Math.ceil(output.length / 4),
    costUsd: '0.000',
  };
}

import { readFile } from 'node:fs/promises';
import type { Agent } from '../db/schema.js';
import { getDb } from '../db/index.js';
import { issueRuns } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { createAgentSession } from './squad-client.js';
import { OutputStreamer } from './output-streamer.js';
import { CostTracker } from './cost-tracker.js';

export type { IssueRun } from '../db/schema.js';

export interface AgentRunInput {
  issueRunId: string;
  agent: Agent;
  issueTitle: string;
  issueBody: string;
  workspacePath: string;
  projectSquadPath: string; // path to .squad/ directory
}

export interface AgentRunOutput {
  success: boolean;
  output: string;
  tokensUsed?: number;
  costUsd?: string;
  errorMessage?: string;
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

  try {
    // 1. Resolve agent charter from disk.
    const charter = await readFile(input.agent.charterPath, 'utf8').catch(() => '');

    // 2. Build session context.
    const task = `# ${input.issueTitle}\n\n${input.issueBody}`;

    // 3. Call SquadClient.createSession() directly (bypass SquadCoordinator).
    const result = await createAgentSession({
      agentName: input.agent.name,
      charterPath: input.agent.charterPath,
      workspacePath: input.workspacePath,
      squadPath: input.projectSquadPath,
      task,
    });

    // 4. Stream output to DB.
    await streamer.write(result.output);
    await streamer.flush();

    // 5. Record costs.
    await tracker.record(result.tokensUsed, result.costUsd);

    // Mark run success.
    await db
      .update(issueRuns)
      .set({ status: 'success' })
      .where(eq(issueRuns.id, input.issueRunId));

    return {
      success: true,
      output: result.output,
      tokensUsed: result.tokensUsed,
      costUsd: result.costUsd,
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await db
      .update(issueRuns)
      .set({ status: 'failed', errorMessage })
      .where(eq(issueRuns.id, input.issueRunId));
    return { success: false, output: '', errorMessage };
  }
}

// ---------------------------------------------------------------------------
// Demo 4 stub — used when @sabbour/squad-sdk is not installed.
// The squad-client module calls this automatically; this export is provided
// so callers can force-stub in tests or local hacking.
// ---------------------------------------------------------------------------
export async function executeAgentRunStub(input: AgentRunInput): Promise<AgentRunOutput> {
  await new Promise<void>((resolve) => setTimeout(resolve, 2000));

  const output =
    `Agent ${input.agent.name} processed issue: ${input.issueTitle}\n` +
    `Workspace: ${input.workspacePath}\n` +
    `[stub output — real SDK integration in production]`;

  return {
    success: true,
    output,
    tokensUsed: 150,
    costUsd: '0.002',
  };
}

import { readFile } from 'node:fs/promises';
import { getDb } from '../db/index.js';
import { issueRuns } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { createAgentSession } from './squad-client.js';
import { OutputStreamer } from './output-streamer.js';
import { CostTracker } from './cost-tracker.js';
import { BudgetGuard, BudgetExceededError } from './budget-guard.js';
// ---------------------------------------------------------------------------
// Invariant 1 — the ONE function the stepper calls for an agent_run step.
// Engine reads task.assignee directly from the agent record and calls
// SquadClient.createSession() directly — SquadCoordinator is never invoked.
// ---------------------------------------------------------------------------
export async function executeAgentRun(input) {
    const db = getDb();
    const streamer = new OutputStreamer(input.issueRunId, db);
    const tracker = new CostTracker(input.issueRunId, db);
    // Budget guard check (opt-in: no-op if project has no budget configured)
    try {
        await BudgetGuard.check(input.projectId);
    }
    catch (err) {
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
        // 5. Record costs with granular input/output split.
        const modelId = input.agent.model ?? 'claude-sonnet-4';
        if (result.inputTokens != null && result.outputTokens != null) {
            await tracker.recordCost(result.inputTokens, result.outputTokens, modelId);
        }
        else {
            await tracker.record(result.tokensUsed, result.costUsd);
        }
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
    }
    catch (err) {
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
export async function executeAgentRunStub(input) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const output = `Agent ${input.agent.name} processed issue: ${input.issueTitle}\n` +
        `Workspace: ${input.workspacePath}\n` +
        `[stub output — real SDK integration in production]`;
    return {
        success: true,
        output,
        tokensUsed: 150,
        costUsd: '0.002',
    };
}
//# sourceMappingURL=bridge.js.map
import type { Agent } from '../db/schema.js';
export type { IssueRun } from '../db/schema.js';
export interface AgentRunInput {
    issueRunId: string;
    projectId: string;
    agent: Agent;
    issueTitle: string;
    issueBody: string;
    workspacePath: string;
    projectSquadPath: string;
}
export interface AgentRunOutput {
    success: boolean;
    output: string;
    tokensUsed?: number;
    costUsd?: string;
    errorMessage?: string;
    budgetExceeded?: boolean;
}
export declare function executeAgentRun(input: AgentRunInput): Promise<AgentRunOutput>;
export declare function executeAgentRunStub(input: AgentRunInput): Promise<AgentRunOutput>;
//# sourceMappingURL=bridge.d.ts.map
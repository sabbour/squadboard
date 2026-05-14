export interface SessionOptions {
    agentName: string;
    charterPath: string;
    workspacePath: string;
    squadPath: string;
    task: string;
    model?: string;
}
export interface SessionResult {
    output: string;
    tokensUsed: number;
    costUsd: string;
    inputTokens?: number;
    outputTokens?: number;
}
export declare function createAgentSession(options: SessionOptions): Promise<SessionResult>;
//# sourceMappingURL=squad-client.d.ts.map
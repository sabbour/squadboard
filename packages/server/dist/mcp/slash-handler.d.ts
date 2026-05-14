export interface SlashResult {
    ok: boolean;
    markdown: string;
    data?: unknown;
}
/**
 * Parse and execute a /squadboard slash command string.
 * Supported: /squadboard list [--project <id>] [--status <status>]
 *            /squadboard create <title> [--project <id>]
 *            /squadboard run <issueId> [--agent <agentId>]
 *            /squadboard status <runId>
 *            /squadboard agents [--project <id>]
 */
export declare function handleSlashCommand(input: string): Promise<SlashResult>;
//# sourceMappingURL=slash-handler.d.ts.map
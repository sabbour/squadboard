export interface RoutingRule {
    priority: number;
    pattern: string;
    matchType: 'label' | 'keyword' | 'assignee' | 'catchall';
    agentName: string;
    rawRule: string;
}
/**
 * Parse .squad/routing.md and return all routing rules in file order (priority).
 *
 * Strategy:
 *   - Find every markdown table (pipe-delimited rows).
 *   - Detect header row to locate the pattern column and agent column.
 *   - Emit one RoutingRule per data row, skipping rows with no agent or
 *     where the agent cell looks like explanatory text (e.g. "Triage: …").
 */
export declare function parseRoutingFile(routingMdPath: string): Promise<RoutingRule[]>;
/**
 * Returns true if the given routing rule matches the issue.
 *
 * - 'label'    → issue has a label whose name includes the pattern (case-insensitive)
 * - 'catchall' → always matches
 * - 'keyword'  → pattern words appear in the issue title or body (case-insensitive)
 * - 'assignee' → matches issue.assignee (not used in current routing.md, reserved)
 */
export declare function matchRule(rule: RoutingRule, issue: {
    title: string;
    labels: string[];
    body?: string;
}): boolean;
//# sourceMappingURL=routing-compiler.d.ts.map
/**
 * router.ts — Routing engine: Tier 1 (deterministic), Tier 2 (keyword score), Tier 3 (LLM specifier)
 *
 * Tier 1 — deterministic rule match from routing.md (Demo 5)
 * Tier 2 — keyword/label scoring against agent charter keywords (Demo 8)
 * Tier 3 — LLM specifier desugared to a `specifier_run` issueRun (Demo 8, Invariant 1)
 *
 * Invariant 1: The routing tier never calls LLM directly. Tier 3 creates an
 * issueRuns row with kind='specifier_run' and calls executeAgentRun() — the one
 * function that is allowed to call SquadClient.createSession().
 *
 * Hot-reload is restart-only for v1 (non-goal per PRD).
 */
import { schema } from '../db/index.js';
/**
 * Load and cache routing rules from .squad/routing.md for a project.
 * Also refreshes the agent keyword cache (Tier-2 prerequisite).
 */
export declare function loadRoutingRules(projectId: string, squadPath: string): Promise<void>;
/**
 * Read all active agents for a project, extract keywords from their charters,
 * persist to `agent_keywords` table, and update the in-memory cache.
 */
export declare function refreshAgentKeywords(projectId: string): Promise<void>;
/**
 * Match an issue against cached routing rules (in priority order).
 * Returns null when no rule matches → fall through to Tier 2.
 */
export declare function resolveRoute(projectId: string, issue: {
    title: string;
    labels: string[];
    body?: string;
}): Promise<{
    agentName: string;
    rule: typeof schema.routingRules.$inferSelect;
} | null>;
export interface Tier2Match {
    agentId: string;
    agentName: string;
    score: number;
    reasoning: string;
}
/**
 * Score each active agent against the issue using keyword overlap and label matching.
 *
 * Score formula:
 *   (keyword_matches * 2 + label_matches) / (total_keywords + 1)
 *
 * Returns the highest-scoring agent if score > 0, otherwise null (→ Tier 3).
 */
export declare function resolveRouteTier2(projectId: string, issue: {
    title: string;
    labels: string[];
    body?: string;
}): Promise<Tier2Match | null>;
export interface Tier3Match {
    agentId: string;
    agentName: string;
    reasoning: string;
    specifierRunId: string;
}
/**
 * Tier-3 LLM routing: creates a `specifier_run` issueRun and calls executeAgentRun().
 *
 * Invariant 1 compliance: LLM work flows through executeAgentRun → createAgentSession().
 * The issueRun is persisted with kind='specifier_run' so the audit trail is complete.
 *
 * Output schema (Invariant 4): expected JSON `{ "assignee": "<agent-name>", "reasoning": "…" }`
 * If parsing fails → failure_reason='output_schema_violation' → fall back to first active agent.
 *
 * @param issueId  If null (test simulation), no issueRun row is created; returns stub.
 */
export declare function resolveRouteTier3(projectId: string, issue: {
    title: string;
    labels: string[];
    body?: string;
}, issueId: string | null): Promise<Tier3Match | null>;
export interface FullRouteResult {
    tier: 1 | 2 | 3 | null;
    agentName: string | null;
    agentId: string | null;
    score: number | null;
    reasoning: string | null;
    matchedRule: string | null;
    specifierRunId: string | null;
}
/**
 * Run the full three-tier routing pipeline and log the decision.
 *
 * @param issueId  Real issue UUID for production routing; null for simulation (POST /test).
 */
export declare function resolveRouteFull(projectId: string, issue: {
    title: string;
    labels: string[];
    body?: string;
}, issueId: string | null): Promise<FullRouteResult>;
/**
 * Create an issue_run for a routing-resolved assignment.
 *
 * Inserts with kind='agent_run' (Invariant 1: routing desugars to agent_run).
 * Includes routing audit fields so the tier is visible per-run.
 */
export declare function createRoutedRun(issueId: string, agentId: string, resolvedByRule: string, routingTier?: 1 | 2 | 3, routingScore?: number | null, routingReasoning?: string | null): Promise<string>;
//# sourceMappingURL=router.d.ts.map
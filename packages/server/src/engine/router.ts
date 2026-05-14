/**
 * router.ts — Tier 1 routing engine (Demo 5)
 *
 * Invariant 1: Routing desugars to issue_runs with kind='agent_run'.
 * The routing tier never spawns its own workers — it creates issue_runs rows
 * with the resolved agent, then the stepper picks them up on the next tick.
 *
 * Hot-reload is restart-only for v1 (non-goal per PRD).
 */

import { eq, and } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { parseRoutingFile, matchRule } from '../services/routing-compiler.js';
import type { RoutingRule as ParsedRoutingRule } from '../services/routing-compiler.js';

// ---------------------------------------------------------------------------
// loadRoutingRules
// ---------------------------------------------------------------------------

/**
 * Load and cache routing rules from .squad/routing.md for a project.
 *
 * Clears any previously cached rules for the project, then inserts the
 * freshly parsed set. Hot-reload requires a process restart (v1 non-goal).
 */
export async function loadRoutingRules(projectId: string, squadPath: string): Promise<void> {
  const routingMdPath = `${squadPath}/routing.md`;
  let parsed: ParsedRoutingRule[] = [];

  try {
    parsed = await parseRoutingFile(routingMdPath);
  } catch (err: unknown) {
    // routing.md is optional — if absent, routing simply produces no matches
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      console.log(`[router] no routing.md at ${routingMdPath} — routing disabled for project ${projectId}`);
    } else {
      console.error(`[router] failed to parse routing.md for project ${projectId}:`, err);
    }
    parsed = [];
  }

  const db = getDb();
  const { routingRules } = schema;

  // Replace all cached rules atomically (clear + insert)
  await db.delete(routingRules).where(eq(routingRules.projectId, projectId));

  if (parsed.length > 0) {
    await db.insert(routingRules).values(
      parsed.map((r) => ({
        projectId,
        priority: r.priority,
        pattern: r.pattern,
        matchType: r.matchType,
        agentName: r.agentName,
        rawRule: r.rawRule,
        loadedAt: new Date(),
      })),
    );
    console.log(`[router] loaded ${parsed.length} routing rule(s) for project ${projectId}`);
  }
}

// ---------------------------------------------------------------------------
// resolveRoute
// ---------------------------------------------------------------------------

/**
 * Match an issue against cached routing rules (in priority order).
 *
 * Match order:
 *   1. label   — issue has a label whose name contains rule.pattern
 *   2. keyword — issue title/body contains rule.pattern (case-insensitive)
 *   3. catchall — rule.matchType === 'catchall'
 *
 * Returns null when no rule matches → Tier 2/3 escalation handled in Demo 8.
 */
export async function resolveRoute(
  projectId: string,
  issue: { title: string; labels: string[]; body?: string },
): Promise<{ agentName: string; rule: typeof schema.routingRules.$inferSelect } | null> {
  const db = getDb();
  const { routingRules } = schema;

  const rules = await db
    .select()
    .from(routingRules)
    .where(eq(routingRules.projectId, projectId))
    .orderBy(routingRules.priority);

  for (const rule of rules) {
    const parsedRule: ParsedRoutingRule = {
      priority: rule.priority,
      pattern: rule.pattern,
      matchType: rule.matchType as ParsedRoutingRule['matchType'],
      agentName: rule.agentName,
      rawRule: rule.rawRule,
    };

    if (matchRule(parsedRule, issue)) {
      return { agentName: rule.agentName, rule };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// createRoutedRun
// ---------------------------------------------------------------------------

/**
 * Create an issue_run for a routing-resolved assignment.
 *
 * Inserts with kind='agent_run' (Invariant 1: routing desugars to agent_run).
 * The stepper picks it up on the next dispatcher tick.
 *
 * @returns The new issueRunId.
 */
export async function createRoutedRun(
  issueId: string,
  agentId: string,
  resolvedByRule: string,
): Promise<string> {
  const db = getDb();
  const { issueRuns } = schema;

  const [run] = await db
    .insert(issueRuns)
    .values({
      issueId,
      agentId,
      kind: 'agent_run',   // Invariant 1: routing desugars to agent_run
      status: 'pending',
      output: `[auto-routed by rule: ${resolvedByRule}]`,
    })
    .returning({ id: issueRuns.id });

  console.log(`[router] created issue_run ${run.id} for issue ${issueId} → agent ${agentId} (rule: ${resolvedByRule})`);
  return run.id;
}

/**
 * sweeps/pickup-todos.ts — W29 MC-7
 *
 * Scans issues in the "todo" column that have no pending or running issue_run
 * and auto-dispatches them so the Stepper (claimAndRun) can pick them up.
 *
 * Assignment strategy (per-project, per-issue):
 *   1. Tier-1 coordinator dispatch (dispatchViaCoordinator) — when
 *      COORDINATOR_DISPATCH_ENABLED is true (default). Uses the LLM coordinator
 *      to pick the best agent. Falls through to tier-2 on skip/ambiguous/error.
 *   2. Tier-2 keyword scoring (resolveRouteTier2) — routes to the best-matching
 *      active agent if score > 0.
 *   3. Tier-3 least-loaded fallback — picks the active agent with the fewest
 *      pending+running issue_runs, breaking ties alphabetically. This avoids
 *      the "first alphabetically = always Fenster" anti-pattern.
 *
 * Items already covered by a pending/running run are skipped (idempotent).
 * Items with no active agents in their project are skipped with a warning.
 *
 * Runs every 10 s.
 */
import type { Sweep, SweepResult } from '../heartbeat.js';
import { getDb, schema } from '../../db/index.js';
import { eq, and, sql, asc, inArray, gte } from 'drizzle-orm';
import { resolveRouteTier2 } from '../router.js';
import { dispatchViaCoordinator } from '../../coordinator/index.js';
import { isCoordinatorDispatchEnabled } from '../../config/coordinator-env.js';

/** Minimum number of recent failures before a (issue, agent) tuple is blocked. */
const CIRCUIT_BREAKER_MIN_FAILURES = 3;
/** Rolling window (ms) for counting recent failures. */
const CIRCUIT_BREAKER_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

export const pickupTodosSweep: Sweep = {
  id: 'pickup-todos',
  intervalMs: 10_000,
  enabled: true,

  async run(): Promise<SweepResult> {
    const db = getDb();
    const { issues, issueRuns, agents, projects } = schema;

    let acted = 0;
    let errors = 0;

    try {
      // Find all todo issues across all projects.
      const todoIssues = await db
        .select({
          id: issues.id,
          projectId: issues.projectId,
          title: issues.title,
          body: issues.body,
          status: issues.status,
          createdAt: issues.createdAt,
        })
        .from(issues)
        .where(and(eq(issues.status, 'todo'), eq(issues.archived, 0)));

      if (todoIssues.length === 0) return { acted: 0, errors: 0 };

      // Find which of those already have a pending or running issue_run.
      const coveredRunRows = await db
        .select({ issueId: issueRuns.issueId })
        .from(issueRuns)
        .where(
          and(
            inArray(
              issueRuns.issueId,
              todoIssues.map((i) => i.id),
            ),
            inArray(issueRuns.status, ['pending', 'running']),
          ),
        );

      const coveredIds = new Set(coveredRunRows.map((r) => r.issueId));

      // Filter to uncovered issues.
      const unattended = todoIssues.filter((i) => !coveredIds.has(i.id));
      if (unattended.length === 0) return { acted: 0, errors: 0 };

      // Group by project so we fetch active agents once per project.
      const byProject = new Map<string, typeof unattended>();
      for (const issue of unattended) {
        if (!byProject.has(issue.projectId)) byProject.set(issue.projectId, []);
        byProject.get(issue.projectId)!.push(issue);
      }

      const coordinatorEnabled = isCoordinatorDispatchEnabled();

      for (const [projectId, projectIssues] of byProject) {
        // Fetch active agents for this project (with fields needed for coordinator).
        const activeAgents = await db
          .select({
            id: agents.id,
            name: agents.name,
            role: agents.role,
            charterContent: agents.charterContent,
            charterHash: agents.charterHash,
          })
          .from(agents)
          .where(and(eq(agents.projectId, projectId), eq(agents.status, 'active')))
          .orderBy(asc(agents.name));

        if (activeAgents.length === 0) {
          console.warn(`[sweep:pickup-todos] project ${projectId} has no active agents — skipping ${projectIssues.length} todo item(s)`);
          continue;
        }

        // Build agent name → id map for coordinator decision resolution.
        const agentByName = new Map(activeAgents.map((a) => [a.name, a.id]));

        // Coordinator-specific project data — only fetched when coordinator is enabled.
        let projectName: string = projectId;
        let busyAgentIds = new Set<string>();

        if (coordinatorEnabled) {
          const [projectRow] = await db
            .select({ id: projects.id, name: projects.name })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);

          projectName = projectRow?.name ?? projectId;

          // Determine which agents are currently busy (pending/running runs in this project).
          const busyAgentRows = await db
            .select({ agentId: issueRuns.agentId })
            .from(issueRuns)
            .where(
              and(
                inArray(
                  issueRuns.agentId,
                  activeAgents.map((a) => a.id),
                ),
                inArray(issueRuns.status, ['pending', 'running']),
              ),
            );
          busyAgentIds = new Set(busyAgentRows.map((r) => r.agentId));
        }

        for (const issue of projectIssues) {
          try {
            let targetAgentId: string | null = null;
            let routingTier: 1 | 2 | 3 | null = null;
            let routingReasoning: string | null = null;

            // ----------------------------------------------------------------
            // Tier 1: Coordinator dispatch (MC-7)
            // ----------------------------------------------------------------
            if (coordinatorEnabled && issue.createdAt) {
              // Fetch last 5 completed/failed/cancelled runs for this issue.
              const recentRunRows = await db
                .select({
                  agentId: issueRuns.agentId,
                  status: issueRuns.status,
                  startedAt: issueRuns.startedAt,
                  completedAt: issueRuns.completedAt,
                })
                .from(issueRuns)
                .where(
                  and(
                    eq(issueRuns.issueId, issue.id),
                    inArray(issueRuns.status, ['completed', 'failed', 'cancelled']),
                  ),
                )
                .orderBy(asc(issueRuns.createdAt))
                .limit(5);

              // Build agent id → name map for run history.
              const agentIdToName = new Map(activeAgents.map((a) => [a.id, a.name]));

              const recentRuns = recentRunRows.map((r) => {
                const outcome: 'success' | 'failed' | 'abandoned' =
                  r.status === 'completed' ? 'success' :
                  r.status === 'failed' ? 'failed' : 'abandoned';
                const durationMs =
                  r.startedAt && r.completedAt
                    ? r.completedAt.getTime() - r.startedAt.getTime()
                    : 0;
                return {
                  issueId: issue.id,
                  agentName: agentIdToName.get(r.agentId) ?? r.agentId,
                  outcome,
                  durationMs,
                };
              });

              try {
                const result = await dispatchViaCoordinator({
                  issue: {
                    id: issue.id,
                    title: issue.title,
                    body: issue.body ?? null,
                    labels: [],
                    column: issue.status,
                    parentId: null,
                    priority: null,
                    createdAt: issue.createdAt.toISOString(),
                  },
                  candidateAgents: activeAgents.map((a) => ({
                    name: a.name,
                    role: a.role,
                    charterHash: a.charterHash ?? '',
                    charterContent: a.charterContent,
                    capabilities: [],
                    available: !busyAgentIds.has(a.id),
                  })),
                  project: {
                    id: projectId,
                    name: projectName,
                    rules: '',
                  },
                  recentRuns,
                });

                const decision = result.decision;

                if (decision.kind === 'dispatch') {
                  const resolvedId = agentByName.get(decision.agent);
                  if (resolvedId) {
                    targetAgentId = resolvedId;
                    routingTier = 1;
                    routingReasoning = decision.rationale ?? 'coordinator dispatch';
                  } else {
                    console.warn(
                      `[sweep:pickup-todos] coordinator returned unknown agent '${decision.agent}' for issue ${issue.id} — falling through to tier-2`,
                    );
                  }
                } else if (decision.kind === 'skip') {
                  console.log(
                    `[sweep:pickup-todos] coordinator skipped issue ${issue.id}: ${decision.reason}`,
                  );
                  continue;
                } else {
                  // kind === 'ambiguous': fall through to tier-2 keyword scoring.
                }
              } catch (coordinatorErr) {
                console.error(
                  `[sweep:pickup-todos] coordinator error for issue ${issue.id} — falling through to tier-2:`,
                  coordinatorErr,
                );
              }
            }

            // ----------------------------------------------------------------
            // Tier 2: keyword scoring — fallback when coordinator not used,
            // returned ambiguous, threw, or resolved unknown agent.
            // ----------------------------------------------------------------
            if (!targetAgentId) {
              const tier2 = await resolveRouteTier2(projectId, {
                title: issue.title,
                labels: [],
                body: issue.body ?? '',
              });

              if (tier2 && tier2.score > 0) {
                targetAgentId = tier2.agentId;
                routingTier = 2;
                routingReasoning = tier2.reasoning;
              } else {
                // ----------------------------------------------------------------
                // Tier 3: least-loaded fallback.
                // ----------------------------------------------------------------
                const [leastLoaded] = await db
                  .select({ id: agents.id })
                  .from(agents)
                  .where(and(eq(agents.projectId, projectId), eq(agents.status, 'active')))
                  .orderBy(
                    asc(
                      sql<number>`(
                        SELECT COUNT(*) FROM issue_runs ir
                        WHERE ir.agent_id = ${agents.id}
                          AND ir.status IN ('pending', 'running')
                      )`,
                    ),
                    asc(agents.name),
                  )
                  .limit(1);

                if (leastLoaded) {
                  targetAgentId = leastLoaded.id;
                  routingTier = 3;
                  routingReasoning = 'pickup-todos: least-loaded fallback';
                }
              }
            }

            if (!targetAgentId) continue;

            // Circuit breaker: skip if this (issue, agent) tuple has ≥ N failures
            // in the last M minutes to prevent infinite failure loops.
            const windowStart = new Date(Date.now() - CIRCUIT_BREAKER_WINDOW_MS);
            const recentFailures = await db
              .select({ id: issueRuns.id })
              .from(issueRuns)
              .where(
                and(
                  eq(issueRuns.issueId, issue.id),
                  eq(issueRuns.agentId, targetAgentId),
                  eq(issueRuns.status, 'failed'),
                  gte(issueRuns.createdAt, windowStart),
                ),
              );

            if (recentFailures.length >= CIRCUIT_BREAKER_MIN_FAILURES) {
              console.log(
                `[sweep:pickup-todos] circuit-breaker tripped for issue ${issue.id} agent ${targetAgentId}`,
              );
              continue;
            }

            await db.insert(issueRuns).values({
              issueId: issue.id,
              agentId: targetAgentId,
              kind: 'agent_run',
              status: 'pending',
              output: '[auto-dispatched by pickup-todos sweep]',
              routingTier,
              routingReasoning,
            });

            acted += 1;
            console.log(`[sweep:pickup-todos] dispatched issue ${issue.id} → agent ${targetAgentId} (tier=${routingTier ?? 'fallback'})`);
          } catch (issueErr) {
            errors += 1;
            console.error(`[sweep:pickup-todos] failed to dispatch issue ${issue.id}:`, issueErr);
          }
        }
      }
    } catch (err) {
      errors += 1;
      console.error('[sweep:pickup-todos] sweep error:', err);
    }

    return { acted, errors };
  },
};

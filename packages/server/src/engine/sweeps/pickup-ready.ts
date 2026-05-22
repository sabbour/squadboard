/**
 * sweeps/pickup-ready.ts — W29 MC-7
 *
 * Scans issues in a ready column that have no pending or running issue_run
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
 * Runs every 30 s by default.
 */
import type { Sweep, SweepResult } from '../heartbeat.js';
import { getDb, schema } from '../../db/index.js';
import { eq, and, sql, asc, inArray, gte } from 'drizzle-orm';
import { logRoutingDecision, resolveRouteTier2 } from '../router.js';
import {
  applyDeterministicPrefilters,
  buildCoordinatorInput,
  buildDeterministicCoordinatorMeta,
  capabilityMapFromAgentKeywords,
  dispatchViaCoordinator,
  filterBlockedAgents,
} from '../../coordinator/index.js';
import { isCoordinatorDispatchEnabled } from '../../config/coordinator-env.js';
import { persistCoordinatorDecision } from '../../services/coordinator-decision-log.js';
import { persistCoordinatorRoutingDecision } from '../../services/coordinator-routing-log.js';
import { emitSignal } from '../../services/ceremony-signal-emitter.js';
import type { CoordinatorDecision, CoordinatorCallMeta } from '../../coordinator/types.js';

/** Minimum number of recent failures before a (issue, agent) tuple is blocked. */
const CIRCUIT_BREAKER_MIN_FAILURES = 3;
/** Rolling window (ms) for counting recent failures. */
const CIRCUIT_BREAKER_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

function isParentComplete(row: { parentStatus: string; parentArchived?: number | null }): boolean {
  if (row.parentArchived === 1) return true;
  return ['done', 'completed', 'cancelled'].includes(row.parentStatus.toLowerCase());
}

async function logPickupRoutingDecision(input: {
  projectId: string;
  issueId: string;
  tier: 1 | 2 | 3 | null;
  resolvedAgent: string | null;
  matchedRule: string | null;
  score?: number | null;
  reasoning: string | null;
}): Promise<void> {
  try {
    await logRoutingDecision({
      projectId: input.projectId,
      issueId: input.issueId,
      tier: input.tier,
      resolvedAgent: input.resolvedAgent,
      matchedRule: input.matchedRule,
      score: input.score ?? null,
      reasoning: input.reasoning,
      specifierRunId: null,
    });
  } catch (err) {
    console.warn(`[sweep:pickup-ready] failed to log routing decision for issue ${input.issueId}:`, err);
  }
}

async function markWorkflowRunsCompleted(workflowRunIds: string[]): Promise<void> {
  if (workflowRunIds.length === 0) return;
  const db = getDb();
  const now = new Date();
  await db
    .update(schema.stepRuns)
    .set({ status: 'completed', updatedAt: now })
    .where(inArray(schema.stepRuns.workflowRunId, workflowRunIds));
  await db
    .update(schema.workflowRuns)
    .set({ status: 'completed', updatedAt: now })
    .where(inArray(schema.workflowRuns.id, workflowRunIds));
}

async function recordWorkPickupWorkflowRun(input: {
  projectId: string;
  issueId: string;
  issueTitle: string;
  issueStatus: string;
  issueRunId: string;
  agentId: string;
  agentName: string | null;
  routingTier: 1 | 2 | 3 | null;
  routingScore: number | null;
  matchedRule: string | null;
}): Promise<void> {
  try {
    const result = await emitSignal({
      projectId: input.projectId,
      signalName: 'board.ready',
      anchorIssueId: input.issueId,
      contextPayload: {
        issueId: input.issueId,
        issueTitle: input.issueTitle,
        issueStatus: input.issueStatus,
        issueRunId: input.issueRunId,
        agentId: input.agentId,
        agentName: input.agentName,
        routingTier: input.routingTier,
        routingScore: input.routingScore,
        matchedRule: input.matchedRule,
      },
    });

    await markWorkflowRunsCompleted(result.workflowRunIds);

    if (result.errors > 0) {
      console.warn(
        `[sweep:pickup-ready] board.ready signal for issue ${input.issueId} had ${result.errors} error(s)`,
      );
    }
  } catch (err) {
    console.warn(`[sweep:pickup-ready] failed to record Work Pickup workflow run for issue ${input.issueId}:`, err);
  }
}

export const pickupReadySweep: Sweep = {
  id: 'pickup-ready',
  label: 'Ready pickup',
  description: 'Finds Ready cards without active runs, routes them, and queues an agent run.',
  scope: 'project',
  intervalMs: 30_000,
  enabled: true,

  async run(): Promise<SweepResult> {
    const db = getDb();
    const {
      issues,
      issueRuns,
      agents,
      projects,
      issueLabels,
      labels,
      agentKeywords,
      issueLinks,
      routingRules,
    } = schema;

    let acted = 0;
    let errors = 0;
    const touchedProjectIds = new Set<string>();

    try {
      // Find all issues in project columns marked semantic='ready'. Custom
      // ready columns opt into the same automatic pickup behavior through column_meta.
      const maybeSchema = schema as typeof schema & { columnMeta?: typeof schema.columnMeta };
      const readyIssues = maybeSchema.columnMeta
        ? await db
            .select({
              id: issues.id,
              projectId: issues.projectId,
              title: issues.title,
              body: issues.body,
              status: issues.status,
              createdAt: issues.createdAt,
            })
            .from(issues)
            .innerJoin(
              maybeSchema.columnMeta,
              and(
                eq(maybeSchema.columnMeta.projectId, issues.projectId),
                eq(maybeSchema.columnMeta.columnId, issues.status),
              ),
            )
            .where(and(eq(maybeSchema.columnMeta.semantic, 'ready'), eq(issues.archived, 0)))
        : await db
            .select({
              id: issues.id,
              projectId: issues.projectId,
              title: issues.title,
              body: issues.body,
              status: issues.status,
              createdAt: issues.createdAt,
            })
            .from(issues)
            .where(and(eq(issues.status, 'ready'), eq(issues.archived, 0)));

      if (readyIssues.length === 0) return { acted: 0, errors: 0 };

      // Find which of those already have a pending or running issue_run.
      const coveredRunRows = await db
        .select({ issueId: issueRuns.issueId })
        .from(issueRuns)
        .where(
          and(
            inArray(
              issueRuns.issueId,
               readyIssues.map((i) => i.id),
            ),
            inArray(issueRuns.status, ['pending', 'running']),
          ),
        );

      const coveredIds = new Set(coveredRunRows.map((r) => r.issueId));

      // Filter to uncovered issues.
      const unattended = readyIssues.filter((i) => !coveredIds.has(i.id));
      if (unattended.length === 0) return { acted: 0, errors: 0 };

      // Group by project so we fetch active agents once per project.
      const byProject = new Map<string, typeof unattended>();
      for (const issue of unattended) {
        if (!byProject.has(issue.projectId)) byProject.set(issue.projectId, []);
        byProject.get(issue.projectId)!.push(issue);
      }
      const projectIds = Array.from(byProject.keys());

      const coordinatorEnabled = isCoordinatorDispatchEnabled();

      for (const [projectId, projectIssues] of byProject) {
        touchedProjectIds.add(projectId);
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
          console.warn(`[sweep:pickup-ready] project ${projectId} has no active agents — skipping ${projectIssues.length} ready item(s)`);
          continue;
        }

        // Build agent name → id map for coordinator decision resolution.
        const agentByName = new Map(activeAgents.map((a) => [a.name, a.id]));

        const projectIssueIds = projectIssues.map((issue) => issue.id);
        const activeAgentIds = activeAgents.map((agent) => agent.id);

        const [projectRow] = await db
          .select({ id: projects.id, name: projects.name, description: projects.description })
          .from(projects)
          .where(eq(projects.id, projectId))
          .limit(1);

        const projectInfo = projectRow ?? { id: projectId, name: projectId, description: null };

        // Determine which agents are currently busy (pending/running runs in this project).
        const busyAgentRows = await db
          .select({ agentId: issueRuns.agentId })
          .from(issueRuns)
          .where(
            and(
              inArray(issueRuns.agentId, activeAgentIds),
              inArray(issueRuns.status, ['pending', 'running']),
            ),
          );
        const busyAgentIds = new Set(busyAgentRows.map((r) => r.agentId));

        const agentKeywordRows = await db
          .select({
            agentId: agentKeywords.agentId,
            keywords: agentKeywords.keywords,
            focusAreas: agentKeywords.focusAreas,
          })
          .from(agentKeywords)
          .where(inArray(agentKeywords.agentId, activeAgentIds));
        const agentCapabilities = capabilityMapFromAgentKeywords(agentKeywordRows);

        const labelRows = await db
          .select({ issueId: issueLabels.issueId, name: labels.name })
          .from(issueLabels)
          .innerJoin(labels, eq(issueLabels.labelId, labels.id))
          .where(inArray(issueLabels.issueId, projectIssueIds));
        const labelsByIssue = new Map<string, string[]>();
        for (const row of labelRows) {
          const values = labelsByIssue.get(row.issueId) ?? [];
          values.push(row.name);
          labelsByIssue.set(row.issueId, values);
        }

        const parentRows = await db
          .select({
            childIssueId: issueLinks.childIssueId,
            parentIssueId: issueLinks.parentIssueId,
            linkType: issueLinks.linkType,
            parentStatus: issues.status,
            parentArchived: issues.archived,
          })
          .from(issueLinks)
          .innerJoin(issues, eq(issueLinks.parentIssueId, issues.id))
          .where(inArray(issueLinks.childIssueId, projectIssueIds));
        const parentIssueIdsByChild = new Map<string, string[]>();
        const blockedParentIssueIdsByChild = new Map<string, string[]>();
        for (const row of parentRows) {
          const parentIds = parentIssueIdsByChild.get(row.childIssueId) ?? [];
          parentIds.push(row.parentIssueId);
          parentIssueIdsByChild.set(row.childIssueId, parentIds);

          if (row.linkType === 'fan_out' && !isParentComplete(row)) {
            const blockedIds = blockedParentIssueIdsByChild.get(row.childIssueId) ?? [];
            blockedIds.push(row.parentIssueId);
            blockedParentIssueIdsByChild.set(row.childIssueId, blockedIds);
          }
        }

        const routingRuleRows = await db
          .select({ rawRule: routingRules.rawRule, priority: routingRules.priority })
          .from(routingRules)
          .where(eq(routingRules.projectId, projectId))
          .orderBy(asc(routingRules.priority));
        const projectRules = routingRuleRows.map((row) => row.rawRule).join('\n');

        for (const issue of projectIssues) {
          try {
            let targetAgentId: string | null = null;
            let targetAgentName: string | null = null;
            let routingTier: 1 | 2 | 3 | null = null;
            let routingScore: number | null = null;
            let routingReasoning: string | null = null;
            let matchedRule: string | null = null;
            let decisionLogged = false;
            // MC-10: captured when coordinator dispatches, for persistence after insert.
            let capturedCoordinatorDecision: CoordinatorDecision | null = null;
            let capturedCoordinatorMeta: CoordinatorCallMeta | null = null;

            const issueLabelNames = labelsByIssue.get(issue.id) ?? [];
            const windowStart = new Date(Date.now() - CIRCUIT_BREAKER_WINDOW_MS);
            const failureRows = await db
              .select({ agentId: issueRuns.agentId })
              .from(issueRuns)
              .where(
                and(
                  eq(issueRuns.issueId, issue.id),
                  inArray(issueRuns.agentId, activeAgentIds),
                  eq(issueRuns.status, 'failed'),
                  gte(issueRuns.createdAt, windowStart),
                ),
              );
            const failureCounts = new Map<string, number>();
            for (const row of failureRows) {
              failureCounts.set(row.agentId, (failureCounts.get(row.agentId) ?? 0) + 1);
            }
            const blockedAgentIds = new Set(
              activeAgents
                .filter((agent) => (failureCounts.get(agent.id) ?? 0) >= CIRCUIT_BREAKER_MIN_FAILURES)
                .map((agent) => agent.id),
            );
            const blockedAgentNames = new Set(
              activeAgents
                .filter((agent) => blockedAgentIds.has(agent.id))
                .map((agent) => agent.name),
            );

            const buildInput = (recentRunRows: Array<{
              agentId: string;
              status: string;
              startedAt?: Date | null;
              completedAt?: Date | null;
            }> = []) => buildCoordinatorInput({
              issue,
              labels: issueLabelNames,
              project: projectInfo,
              agents: activeAgents,
              busyAgentIds,
              recentRuns: recentRunRows,
              parentIssueIds: parentIssueIdsByChild.get(issue.id) ?? [],
              blockedParentIssueIds: blockedParentIssueIdsByChild.get(issue.id) ?? [],
              agentCapabilities,
              projectRules,
            });

            let coordinatorInput = buildInput();
            const filtered = filterBlockedAgents(coordinatorInput, blockedAgentNames);
            coordinatorInput = filtered.input;
            const deterministicDecision = filtered.decision ?? applyDeterministicPrefilters(coordinatorInput);

            if (deterministicDecision) {
              await persistCoordinatorRoutingDecision({
                projectId,
                issueId: issue.id,
                decision: deterministicDecision,
                matchedRule: 'coordinator:deterministic-prefilter',
                db,
              });

              if (deterministicDecision.kind === 'dispatch') {
                const resolvedId = agentByName.get(deterministicDecision.agent);
                if (resolvedId) {
                  targetAgentId = resolvedId;
                  targetAgentName = deterministicDecision.agent;
                  routingTier = 1;
                  routingScore = deterministicDecision.confidence;
                  routingReasoning = deterministicDecision.rationale;
                  matchedRule = 'coordinator:deterministic-prefilter';
                  decisionLogged = true;
                  capturedCoordinatorDecision = deterministicDecision;
                  capturedCoordinatorMeta = buildDeterministicCoordinatorMeta(coordinatorInput);
                }
              } else {
                console.log(
                  `[sweep:pickup-ready] deterministic coordinator decision for issue ${issue.id}: ${deterministicDecision.kind}`,
                );
                continue;
              }
            }

            // ----------------------------------------------------------------
            // Tier 1: Coordinator dispatch (MC-7)
            // ----------------------------------------------------------------
            if (!targetAgentId && coordinatorEnabled && issue.createdAt) {
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
                    inArray(issueRuns.status, ['completed', 'failed', 'cancelled', 'timed_out']),
                  ),
                )
                .orderBy(asc(issueRuns.createdAt))
                .limit(5);

              coordinatorInput = filterBlockedAgents(buildInput(recentRunRows), blockedAgentNames).input;

              try {
                const result = await dispatchViaCoordinator(coordinatorInput);
                const decision = result.decision;

                if (decision.kind === 'dispatch') {
                  const resolvedId = agentByName.get(decision.agent);
                  if (resolvedId) {
                    targetAgentId = resolvedId;
                    targetAgentName = decision.agent;
                    routingTier = 1;
                    routingScore = decision.confidence;
                    routingReasoning = decision.rationale ?? 'coordinator dispatch';
                    matchedRule = 'coordinator:llm';
                    await persistCoordinatorRoutingDecision({
                      projectId,
                      issueId: issue.id,
                      decision,
                      matchedRule,
                      db,
                    });
                    decisionLogged = true;
                    capturedCoordinatorDecision = decision;
                    capturedCoordinatorMeta = result.meta;
                  } else {
                    console.warn(
                      `[sweep:pickup-ready] coordinator returned unknown agent '${decision.agent}' for issue ${issue.id} — falling through to tier-2`,
                    );
                  }
                } else if (decision.kind === 'skip') {
                  await persistCoordinatorRoutingDecision({
                    projectId,
                    issueId: issue.id,
                    decision,
                    matchedRule: 'coordinator:llm',
                    db,
                  });
                  console.log(
                    `[sweep:pickup-ready] coordinator skipped issue ${issue.id}: ${decision.reason}`,
                  );
                  continue;
                } else {
                  await persistCoordinatorRoutingDecision({
                    projectId,
                    issueId: issue.id,
                    decision,
                    matchedRule: 'coordinator:llm',
                    db,
                  });
                  // kind === 'ambiguous': fall through to tier-2 keyword scoring.
                }
              } catch (coordinatorErr) {
                console.error(
                  `[sweep:pickup-ready] coordinator error for issue ${issue.id} — falling through to tier-2:`,
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
                labels: issueLabelNames,
                body: issue.body ?? '',
              });

              if (tier2 && tier2.score > 0) {
                targetAgentId = tier2.agentId;
                targetAgentName = tier2.agentName;
                routingTier = 2;
                routingScore = tier2.score;
                routingReasoning = tier2.reasoning;
                matchedRule = 'keyword-score';
              } else {
                // ----------------------------------------------------------------
                // Tier 3: least-loaded fallback.
                // ----------------------------------------------------------------
                const [leastLoaded] = await db
                  .select({ id: agents.id, name: agents.name })
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
                  targetAgentName = leastLoaded.name;
                  routingTier = 3;
                  routingReasoning = 'pickup-ready: least-loaded fallback';
                  matchedRule = 'pickup-ready:least-loaded-fallback';
                }
              }
            }

            if (!targetAgentId) continue;

            if (blockedAgentIds.has(targetAgentId)) {
              const decision: CoordinatorDecision = {
                kind: 'skip',
                reason: `Circuit breaker blocked agent ${targetAgentId} for issue ${issue.id}; leaving queued for retry.`,
              };
              await persistCoordinatorRoutingDecision({
                projectId,
                issueId: issue.id,
                decision,
                matchedRule: 'coordinator:circuit-breaker',
                db,
              });
              console.log(
                `[sweep:pickup-ready] circuit-breaker tripped for issue ${issue.id} agent ${targetAgentId}`,
              );
              continue;
            }

            const [insertedRun] = await db.insert(issueRuns).values({
              issueId: issue.id,
              agentId: targetAgentId,
              kind: 'agent_run',
              status: 'pending',
              output: '[auto-dispatched by pickup-ready sweep]',
              routingTier,
              routingScore: routingScore != null ? String(routingScore) : null,
              routingReasoning,
            }).returning({ id: issueRuns.id });

            // Set the issue assignee so {{ assignee }} resolves in downstream
            // ceremony steps (e.g. Simple Review's route/agent_run steps).
            await db
              .update(schema.issues)
              .set({ assigneeId: targetAgentId, updatedAt: new Date() })
              .where(eq(schema.issues.id, issue.id));

            if (!decisionLogged) {
              await logPickupRoutingDecision({
                projectId,
                issueId: issue.id,
                tier: routingTier,
                resolvedAgent: targetAgentName,
                matchedRule,
                score: routingScore,
                reasoning: routingReasoning,
              });
            }

            // MC-10: persist coordinator decision on the newly-created run.
            if (insertedRun && capturedCoordinatorDecision && capturedCoordinatorMeta) {
              await persistCoordinatorDecision(insertedRun.id, capturedCoordinatorDecision, capturedCoordinatorMeta);
            }

            if (insertedRun) {
              await recordWorkPickupWorkflowRun({
                projectId,
                issueId: issue.id,
                issueTitle: issue.title,
                issueStatus: issue.status,
                issueRunId: insertedRun.id,
                agentId: targetAgentId,
                agentName: targetAgentName,
                routingTier,
                routingScore,
                matchedRule,
              });
            }

            acted += 1;
            console.log(`[sweep:pickup-ready] dispatched issue ${issue.id} → agent ${targetAgentId} (tier=${routingTier ?? 'fallback'})`);
          } catch (issueErr) {
            errors += 1;
            console.error(`[sweep:pickup-ready] failed to dispatch issue ${issue.id}:`, issueErr);
          }
        }
      }
    } catch (err) {
      errors += 1;
      console.error('[sweep:pickup-ready] sweep error:', err);
    }

    return { acted, errors, projectIds: Array.from(touchedProjectIds) };
  },
};

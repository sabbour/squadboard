import { getDb, schema } from '../db/index.js';
import type { CoordinatorDecision } from '../coordinator/types.js';

export interface PersistCoordinatorRoutingDecisionParams {
  projectId: string;
  issueId: string;
  decision: CoordinatorDecision;
  matchedRule: string;
  db?: ReturnType<typeof getDb>;
}

function decisionReason(decision: CoordinatorDecision): string {
  if (decision.kind === 'dispatch') return decision.rationale;
  if (decision.kind === 'ambiguous') return decision.question;
  return decision.reason;
}

export async function persistCoordinatorRoutingDecision(
  params: PersistCoordinatorRoutingDecisionParams,
): Promise<void> {
  const database = params.db ?? getDb();

  try {
    await database.insert(schema.routingLog).values({
      projectId: params.projectId,
      issueId: params.issueId,
      tier: params.decision.kind === 'dispatch' ? 1 : undefined,
      resolvedAgent: params.decision.kind === 'dispatch' ? params.decision.agent : undefined,
      matchedRule: params.matchedRule,
      score: params.decision.kind === 'dispatch' ? String(params.decision.confidence) : undefined,
      reasoning: decisionReason(params.decision),
      decidedAt: new Date(),
    });
  } catch (err) {
    console.warn(
      `[coordinator-routing-log] failed to persist decision for issue ${params.issueId}:`,
      err,
    );
  }
}


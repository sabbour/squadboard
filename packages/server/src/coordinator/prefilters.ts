import type { CoordinatorDecision, CoordinatorInput } from './types.js';
import { hashCoordinatorInput } from './hash.js';
import type { CoordinatorCallMeta } from './types.js';

export const LOW_CONFIDENCE_FLOOR = 0.4;
export const CONFIDENCE_CONTENTION_DELTA = 0.15;

const HUMAN_ONLY_TERMS = [
  'publish-mcp-auth',
  'code-signing',
  'billing configuration',
  'org-level secret',
  'org-level secrets',
];

function issueText(issue: Pick<CoordinatorInput['issue'], 'title' | 'body'>): string {
  return `${issue.title} ${issue.body ?? ''}`.toLowerCase();
}

function normalizedWords(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

export function resolveNamedAgent(
  issue: Pick<CoordinatorInput['issue'], 'title' | 'body'>,
  candidateAgents: CoordinatorInput['candidateAgents'],
): CoordinatorDecision | null {
  const text = issueText(issue);

  for (const agent of candidateAgents) {
    const name = agent.name.toLowerCase();
    const patterns = [`@${name}`, `assign to ${name}`, `${name}:`];
    if (patterns.some((pattern) => text.includes(pattern))) {
      return {
        kind: 'dispatch',
        agent: agent.name,
        rationale: `Issue explicitly names ${agent.name}.`,
        confidence: 1,
      };
    }
  }

  return null;
}

export function isHumanOnlyOperation(issue: Pick<CoordinatorInput['issue'], 'title' | 'body'>): boolean {
  const text = issueText(issue);
  return HUMAN_ONLY_TERMS.some((term) => text.includes(term));
}

export function isThinIssue(issue: Pick<CoordinatorInput['issue'], 'title' | 'body' | 'labels'>): boolean {
  return (
    (issue.body == null || issue.body.trim() === '') &&
    issue.labels.length === 0 &&
    normalizedWords(issue.title).length < 5
  );
}

export function isBacklogGated(
  issue: Pick<CoordinatorInput['issue'], 'column' | 'labels'>,
  candidateAgents: CoordinatorInput['candidateAgents'],
): boolean {
  if (!['backlog', 'Backlog'].includes(issue.column)) return false;
  if (issue.labels.length === 0) return true;

  const labels = issue.labels.map((label) => label.toLowerCase());
  return !candidateAgents.some((agent) => {
    const capabilities = agent.capabilities.map((capability) => capability.toLowerCase());
    return labels.some((label) =>
      capabilities.some((capability) => capability.includes(label) || label.includes(capability)),
    );
  });
}

export function applyDeterministicPrefilters(input: CoordinatorInput): CoordinatorDecision | null {
  const namedAgent = resolveNamedAgent(input.issue, input.candidateAgents);
  if (namedAgent) return namedAgent;

  if (input.issue.blockedParentIds?.length) {
    return {
      kind: 'skip',
      reason: `Parent issue ${input.issue.blockedParentIds.join(', ')} has not completed; dependency is not ready.`,
    };
  }

  if (isHumanOnlyOperation(input.issue)) {
    return {
      kind: 'skip',
      reason: 'Requires a human owner for credentials, signing, billing, or organization-level secrets; automated dispatch is not allowed.',
    };
  }

  const availableAgents = input.candidateAgents.filter((agent) => agent.available);
  if (availableAgents.length === 0) {
    return {
      kind: 'ambiguous',
      suggestedAgents: input.candidateAgents.map((agent) => agent.name),
      question: 'All candidate agents are busy. Should this wait or queue behind one of them?',
    };
  }

  if (isBacklogGated(input.issue, availableAgents)) {
    return {
      kind: 'skip',
      reason: 'Backlog item has no label/capability match; leaving it for triage.',
    };
  }

  if (isThinIssue(input.issue)) {
    return {
      kind: 'ambiguous',
      suggestedAgents: [],
      question: 'Issue has no body, no labels, and a very short title. Please add context before routing.',
    };
  }

  return null;
}

export function buildDeterministicCoordinatorMeta(input: CoordinatorInput): CoordinatorCallMeta {
  return {
    model: 'deterministic-prefilter',
    promptTokens: 0,
    completionTokens: 0,
    durationMs: 0,
    cacheHit: false,
    inputHash: hashCoordinatorInput(input),
  };
}

export function filterBlockedAgents(
  input: CoordinatorInput,
  blockedAgentNames: ReadonlySet<string>,
): { input: CoordinatorInput; decision: CoordinatorDecision | null } {
  if (blockedAgentNames.size === 0) return { input, decision: null };

  const candidateAgents = input.candidateAgents.filter((agent) => !blockedAgentNames.has(agent.name));
  if (candidateAgents.length > 0) {
    return { input: { ...input, candidateAgents }, decision: null };
  }

  return {
    input,
    decision: {
      kind: 'skip',
      reason: `All candidate agents are circuit-breaker blocked for issue ${input.issue.id}; leaving queued for retry.`,
    },
  };
}

function plausibleCandidateNames(input: CoordinatorInput, selectedAgent: string): string[] {
  const available = input.candidateAgents
    .filter((agent) => agent.available)
    .map((agent) => agent.name);
  const fallback = input.candidateAgents.map((agent) => agent.name);
  const candidates = available.length > 0 ? available : fallback;
  return Array.from(new Set([selectedAgent, ...candidates.filter((name) => name !== selectedAgent)]));
}

export function applyDeterministicPostprocessing(
  input: CoordinatorInput,
  decision: CoordinatorDecision,
): CoordinatorDecision {
  if (decision.kind !== 'dispatch') return decision;

  if (decision.confidence < LOW_CONFIDENCE_FLOOR) {
    return {
      kind: 'ambiguous',
      suggestedAgents: plausibleCandidateNames(input, decision.agent),
      question: `Best fit ${decision.agent} scored ${decision.confidence.toFixed(2)}, below the 0.40 floor. Please clarify scope before dispatch.`,
    };
  }

  return decision;
}

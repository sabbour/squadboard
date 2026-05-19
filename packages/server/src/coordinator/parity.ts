export type ParityDomain =
  | 'dispatch'
  | 'scribe'
  | 'intake'
  | 'spawn'
  | 'ralph'
  | 'setup'
  | 'ceremony'
  | 'lifecycle';

export type DeterminismClass = 'pure-rule' | 'judgment-required' | 'external-state';

export type ParityTargetHome =
  | 'server-deterministic'
  | 'server-llm'
  | 'squadboard-sdk'
  | 'squadboard-ui'
  | 'cli-only'
  | 'deferred';

export interface ParityRule {
  id: string;
  domain: ParityDomain;
  title: string;
  preambleTitle?: string;
  determinism: DeterminismClass;
  currentHome: string;
  targetHome: ParityTargetHome;
  inScope: boolean;
  notes: string;
  thresholds?: Readonly<Record<string, number>>;
  limitation?: string;
}

export const PARITY_RULES: readonly ParityRule[] = [
  {
    id: 'R-13',
    domain: 'dispatch',
    title: 'Named-agent keyword',
    determinism: 'pure-rule',
    currentHome: 'coordinator preamble / LLM',
    targetHome: 'server-deterministic',
    inScope: true,
    notes: 'Move to prefilter; exact candidate name matching has no LLM value.',
    thresholds: { confidence: 1 },
  },
  {
    id: 'R-14',
    domain: 'dispatch',
    title: 'Exact label match',
    determinism: 'pure-rule',
    currentHome: 'coordinator preamble / fixed in pickup-ready with real labels',
    targetHome: 'server-deterministic',
    inScope: true,
    notes: 'Requires real issue labels and agent capabilities.',
    thresholds: { confidence: 0.9 },
  },
  {
    id: 'R-15',
    domain: 'dispatch',
    title: 'Exclusive charter claim',
    determinism: 'judgment-required',
    currentHome: 'coordinator LLM',
    targetHome: 'server-llm',
    inScope: true,
    notes: 'Keep in LLM; explicit vs implied ownership is semantic.',
    thresholds: { confidence: 0.85 },
  },
  {
    id: 'R-16',
    domain: 'dispatch',
    title: 'Role-fit heuristic',
    determinism: 'judgment-required',
    currentHome: 'coordinator LLM',
    targetHome: 'server-llm',
    inScope: true,
    notes: 'Keep in LLM; dominant cue detection is semantic.',
    thresholds: { confidence: 0.75 },
  },
  {
    id: 'R-17',
    domain: 'dispatch',
    title: 'Parent-run gate',
    preambleTitle: 'Parent-run not finished',
    determinism: 'pure-rule',
    currentHome: 'coordinator preamble / fixed in pickup-ready through issue_links',
    targetHome: 'server-deterministic',
    inScope: true,
    notes: 'Use issue_links as canonical parent/child model.',
  },
  {
    id: 'R-18',
    domain: 'dispatch',
    title: 'Unavailable agents',
    determinism: 'pure-rule',
    currentHome: 'coordinator preamble / LLM',
    targetHome: 'server-deterministic',
    inScope: true,
    notes: 'Filter busy agents before the LLM call.',
  },
  {
    id: 'R-19',
    domain: 'dispatch',
    title: 'Backlog gate',
    determinism: 'pure-rule',
    currentHome: 'coordinator preamble / partially dead because labels are empty',
    targetHome: 'server-deterministic',
    inScope: true,
    notes: 'Requires labels and capabilities.',
  },
  {
    id: 'R-20',
    domain: 'dispatch',
    title: 'Human-only operations',
    determinism: 'pure-rule',
    currentHome: 'coordinator preamble / LLM',
    targetHome: 'server-deterministic',
    inScope: true,
    notes: 'Hard string blocklist for credentials, signing, billing, and organization-level secrets.',
  },
  {
    id: 'R-21',
    domain: 'dispatch',
    title: 'Low-confidence floor',
    determinism: 'pure-rule',
    currentHome: 'coordinator LLM prompt',
    targetHome: 'server-deterministic',
    inScope: true,
    notes: 'Apply deterministically to LLM-produced confidence.',
    thresholds: { floor: 0.4 },
  },
  {
    id: 'R-22',
    domain: 'dispatch',
    title: 'Near-tie routing',
    determinism: 'pure-rule',
    currentHome: 'coordinator LLM prompt',
    targetHome: 'server-deterministic',
    inScope: true,
    notes: 'Current decision schema exposes only the selected agent confidence; apply deterministic near-tie checks once candidate scores are available.',
    thresholds: { contentionDelta: 0.15 },
    limitation: 'CoordinatorDecision has no candidate score list, so the server cannot compare the selected agent against close runner-up scores deterministically.',
  },
  {
    id: 'R-23',
    domain: 'dispatch',
    title: 'Recent failure escalation and circuit breaker',
    preambleTitle: 'Recent failure escalation',
    determinism: 'pure-rule',
    currentHome: 'LLM prompt plus silent post-dispatch veto',
    targetHome: 'server-deterministic',
    inScope: true,
    notes: 'Hard circuit breaker must run before dispatch and persist a visible skip.',
    thresholds: { confidencePenalty: 0.15 },
  },
  {
    id: 'R-24',
    domain: 'dispatch',
    title: 'Thin issue fallback',
    determinism: 'pure-rule',
    currentHome: 'coordinator preamble / LLM',
    targetHome: 'server-deterministic',
    inScope: true,
    notes: 'Structural issue check.',
  },
  {
    id: 'R-37',
    domain: 'scribe',
    title: 'Archive oversized decisions.md',
    determinism: 'pure-rule',
    currentHome: 'squadboard SDK',
    targetHome: 'squadboard-sdk',
    inScope: true,
    notes: 'SDK is intended source of implementation; add drift test against driver spec.',
  },
  {
    id: 'R-38',
    domain: 'scribe',
    title: 'Merge decisions inbox',
    determinism: 'pure-rule',
    currentHome: 'squadboard SDK',
    targetHome: 'squadboard-sdk',
    inScope: true,
    notes: 'Daemon/UI/coordinator paths should all call the SDK.',
  },
  {
    id: 'R-39',
    domain: 'scribe',
    title: 'Write orchestration logs',
    determinism: 'pure-rule',
    currentHome: 'squadboard SDK',
    targetHome: 'squadboard-sdk',
    inScope: true,
    notes: 'Depends on spawn manifest fidelity.',
  },
  {
    id: 'R-40',
    domain: 'scribe',
    title: 'Write session log',
    determinism: 'pure-rule',
    currentHome: 'squadboard SDK',
    targetHome: 'squadboard-sdk',
    inScope: true,
    notes: 'Depends on close-out wiring.',
  },
  {
    id: 'R-41',
    domain: 'scribe',
    title: 'Cross-agent history updates',
    determinism: 'pure-rule',
    currentHome: 'squadboard SDK',
    targetHome: 'squadboard-sdk',
    inScope: true,
    notes: 'Requires accurate spawn manifest.',
  },
  {
    id: 'R-42',
    domain: 'scribe',
    title: 'Summarize oversized histories',
    determinism: 'pure-rule',
    currentHome: 'squadboard SDK',
    targetHome: 'squadboard-sdk',
    inScope: true,
    notes: 'SDK gate should be drift-tested.',
  },
  {
    id: 'R-43',
    domain: 'scribe',
    title: 'Commit Scribe files',
    determinism: 'external-state',
    currentHome: 'squadboard SDK',
    targetHome: 'squadboard-sdk',
    inScope: true,
    notes: 'Git side effect with path allowlist.',
  },
  {
    id: 'R-44',
    domain: 'scribe',
    title: 'Write health report',
    determinism: 'pure-rule',
    currentHome: 'squadboard SDK',
    targetHome: 'squadboard-sdk',
    inScope: true,
    notes: 'Server/UI close-out path should surface the report.',
  },
  {
    id: 'R-45',
    domain: 'intake',
    title: 'Dogfood directive capture addendum',
    determinism: 'external-state',
    currentHome: 'CLI prompt only / dormant in live sessions',
    targetHome: 'server-deterministic',
    inScope: true,
    notes: 'Call MCP capture fail-open after markdown/DB capture.',
  },
  {
    id: 'R-31',
    domain: 'spawn',
    title: 'Spawn template context',
    determinism: 'pure-rule',
    currentHome: 'CLI prompt only',
    targetHome: 'server-deterministic',
    inScope: true,
    notes: 'Server run bridge needs the same context blocks and response order.',
  },
  {
    id: 'R-58',
    domain: 'ralph',
    title: 'Ralph work monitor loop',
    determinism: 'external-state',
    currentHome: 'CLI prompt only',
    targetHome: 'server-deterministic',
    inScope: true,
    notes: 'Opt-in project monitor with GitHub/PR/CI/review sweeps.',
    limitation: 'First slice: server records/prioritizes live GitHub, CI, review, auto-merge, and draft candidates, but only assigned-issue pickup performs a live side effect; other GitHub actions are planned/audited for follow-up.',
  },
  {
    id: 'R-56',
    domain: 'ceremony',
    title: 'Before/after ceremony triggers',
    determinism: 'judgment-required',
    currentHome: 'CLI prompt plus separate Squadboard ceremony engine',
    targetHome: 'server-llm',
    inScope: true,
    notes: 'Unify source of truth and keep LLM only for trigger-condition interpretation.',
  },
];

export interface ParitySummary {
  total: number;
  inScope: number;
  byDomain: Record<ParityDomain, number>;
  byTargetHome: Record<ParityTargetHome, number>;
}

export function summarizeParityRules(rules: readonly ParityRule[] = PARITY_RULES): ParitySummary {
  const byDomain = {} as Record<ParityDomain, number>;
  const byTargetHome = {} as Record<ParityTargetHome, number>;
  let inScope = 0;

  for (const rule of rules) {
    if (rule.inScope) inScope += 1;
    byDomain[rule.domain] = (byDomain[rule.domain] ?? 0) + 1;
    byTargetHome[rule.targetHome] = (byTargetHome[rule.targetHome] ?? 0) + 1;
  }

  return {
    total: rules.length,
    inScope,
    byDomain,
    byTargetHome,
  };
}

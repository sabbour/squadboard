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

import { readFile } from 'node:fs/promises';
import { eq, and, asc, desc, count, avg, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { parseRoutingFile, matchRule } from '../services/routing-compiler.js';
import { executeAgentRun } from '../sdk/bridge.js';
import type { RoutingRule as ParsedRoutingRule } from '../services/routing-compiler.js';

// ---------------------------------------------------------------------------
// In-memory keyword cache (refreshed on loadRoutingRules / agent sync)
// ---------------------------------------------------------------------------

interface AgentKeywordCache {
  keywords: string[];   // lowercased tokens from Skills/Expertise sections
  focusAreas: string[]; // lowercased focus area tags for label matching
}

// projectId → agentId → keywords
const _keywordCache = new Map<string, Map<string, AgentKeywordCache>>();

// ---------------------------------------------------------------------------
// loadRoutingRules
// ---------------------------------------------------------------------------

/**
 * Load and cache routing rules from .squad/routing.md for a project.
 * Also refreshes the agent keyword cache (Tier-2 prerequisite).
 */
export async function loadRoutingRules(projectId: string, squadPath: string): Promise<void> {
  const routingMdPath = `${squadPath}/routing.md`;
  let parsed: ParsedRoutingRule[] = [];

  try {
    parsed = await parseRoutingFile(routingMdPath);
  } catch (err: unknown) {
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

  // Refresh Tier-2 keyword cache alongside routing rules
  await refreshAgentKeywords(projectId);
}

// ---------------------------------------------------------------------------
// Charter keyword extraction (Tier 2)
// ---------------------------------------------------------------------------

/**
 * Extract routing-relevant keywords from a charter.md file.
 *
 * Targets:
 *   - **Expertise:** … lines (comma-separated values)
 *   - **Skills:** … lines
 *   - **Focus:** … lines
 *   - ## What I Own / ## Skills section bodies (word-tokenised)
 *
 * Returns { keywords, focusAreas } both lowercased.
 */
function extractCharterKeywords(charterContent: string): AgentKeywordCache {
  const keywords: Set<string> = new Set();
  const focusAreas: Set<string> = new Set();
  const lines = charterContent.split('\n');

  let inSkillsSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Section boundary detection
    if (/^##\s+(skills|expertise|what i own|focus areas?)/i.test(trimmed)) {
      inSkillsSection = true;
      continue;
    }
    if (/^##\s+/.test(trimmed) && inSkillsSection) {
      inSkillsSection = false;
    }

    // Inline field: **Expertise:** foo, bar, baz
    const fieldMatch = trimmed.match(/^\*\*(expertise|skills?|focus areas?|specialt(?:y|ies)|owns?|handles?)\*\*:?\s*(.+)/i);
    if (fieldMatch) {
      const values = fieldMatch[2].split(/[,;/|]+/);
      for (const v of values) {
        const token = v.replace(/[*`[\]()]/g, '').trim().toLowerCase();
        if (token.length > 2) keywords.add(token);
      }
      continue;
    }

    // Inside a skills/expertise section — tokenise significant words
    if (inSkillsSection && trimmed.length > 0 && !trimmed.startsWith('#')) {
      const words = trimmed.split(/[\s,;/|()[\]`*]+/).filter((w) => w.length > 3);
      for (const w of words) {
        const token = w.toLowerCase().replace(/[^a-z0-9+#._-]/g, '');
        if (token.length > 3) keywords.add(token);
      }
    }

    // Label-style focus areas: backtick strings or `squad:xxx` patterns
    const labelMatches = trimmed.matchAll(/`([a-z][a-z0-9:_-]+)`/gi);
    for (const m of labelMatches) {
      focusAreas.add(m[1].toLowerCase());
    }
  }

  return {
    keywords: [...keywords],
    focusAreas: [...focusAreas],
  };
}

/**
 * Read all active agents for a project, extract keywords from their charters,
 * persist to `agent_keywords` table, and update the in-memory cache.
 */
export async function refreshAgentKeywords(projectId: string): Promise<void> {
  const db = getDb();
  const { agents, agentKeywords } = schema;

  const projectAgents = await db
    .select()
    .from(agents)
    .where(and(eq(agents.projectId, projectId), eq(agents.status, 'active')));

  const projectCache = new Map<string, AgentKeywordCache>();

  for (const agent of projectAgents) {
    let charterContent = '';
    try {
      charterContent = await readFile(agent.charterPath, 'utf8');
    } catch {
      // Charter missing — agent gets empty keywords (won't match Tier-2, still eligible for Tier-3)
    }

    const extracted = extractCharterKeywords(charterContent);
    projectCache.set(agent.id, extracted);

    // Persist to DB (upsert)
    await db
      .insert(agentKeywords)
      .values({
        agentId: agent.id,
        keywords: JSON.stringify(extracted.keywords),
        focusAreas: JSON.stringify(extracted.focusAreas),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: agentKeywords.agentId,
        set: {
          keywords: JSON.stringify(extracted.keywords),
          focusAreas: JSON.stringify(extracted.focusAreas),
          updatedAt: new Date(),
        },
      });
  }

  _keywordCache.set(projectId, projectCache);
  console.log(`[router] refreshed keywords for ${projectAgents.length} agent(s) in project ${projectId}`);
}

// ---------------------------------------------------------------------------
// resolveRoute — Tier 1
// ---------------------------------------------------------------------------

/**
 * Match an issue against cached routing rules (in priority order).
 * Returns null when no rule matches → fall through to Tier 2.
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
// resolveRouteTier2 — keyword/label scoring
// ---------------------------------------------------------------------------

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
export async function resolveRouteTier2(
  projectId: string,
  issue: { title: string; labels: string[]; body?: string },
): Promise<Tier2Match | null> {
  const db = getDb();
  const { agents, agentKeywords } = schema;

  // Ensure the cache is warm (may be cold on first call after restart)
  let projectCache = _keywordCache.get(projectId);
  if (!projectCache) {
    await refreshAgentKeywords(projectId);
    projectCache = _keywordCache.get(projectId) ?? new Map();
  }

  const activeAgents = await db
    .select()
    .from(agents)
    .where(and(eq(agents.projectId, projectId), eq(agents.status, 'active')))
    .orderBy(asc(agents.name));

  if (activeAgents.length === 0) return null;

  const haystack = `${issue.title} ${issue.body ?? ''}`.toLowerCase();
  const issueLabels = issue.labels.map((l) => l.toLowerCase());

  let best: Tier2Match | null = null;

  for (const agent of activeAgents) {
    // Pull from in-memory cache first; fall back to DB row
    let cached = projectCache.get(agent.id);
    if (!cached) {
      const [dbRow] = await db
        .select()
        .from(agentKeywords)
        .where(eq(agentKeywords.agentId, agent.id));
      if (dbRow) {
        cached = {
          keywords: JSON.parse(dbRow.keywords) as string[],
          focusAreas: JSON.parse(dbRow.focusAreas) as string[],
        };
        projectCache.set(agent.id, cached);
      } else {
        cached = { keywords: [], focusAreas: [] };
      }
    }

    const { keywords, focusAreas } = cached;
    const totalKeywords = keywords.length;

    let keywordMatches = 0;
    let labelMatches = 0;
    const matchedKeywords: string[] = [];
    const matchedLabels: string[] = [];

    for (const kw of keywords) {
      if (kw.length > 2 && haystack.includes(kw)) {
        keywordMatches++;
        matchedKeywords.push(kw);
      }
    }

    for (const fa of focusAreas) {
      if (issueLabels.some((l) => l.includes(fa) || fa.includes(l))) {
        labelMatches++;
        matchedLabels.push(fa);
      }
    }

    const score = (keywordMatches * 2 + labelMatches) / (totalKeywords + 1);

    if (score > 0 && (!best || score > best.score)) {
      const reasonParts: string[] = [];
      if (matchedKeywords.length) reasonParts.push(`keywords: [${matchedKeywords.slice(0, 5).join(', ')}]`);
      if (matchedLabels.length) reasonParts.push(`labels: [${matchedLabels.join(', ')}]`);

      best = {
        agentId: agent.id,
        agentName: agent.name,
        score: parseFloat(score.toFixed(4)),
        reasoning: `tier2 score=${score.toFixed(4)} ${reasonParts.join(' ')}`,
      };
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// resolveRouteTier3 — LLM specifier (Invariant 1)
// ---------------------------------------------------------------------------

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
export async function resolveRouteTier3(
  projectId: string,
  issue: { title: string; labels: string[]; body?: string },
  issueId: string | null,
): Promise<Tier3Match | null> {
  const db = getDb();
  const { agents, issueRuns, issues } = schema;

  const activeAgents = await db
    .select()
    .from(agents)
    .where(and(eq(agents.projectId, projectId), eq(agents.status, 'active')))
    .orderBy(asc(agents.name));  // deterministic ordering prevents first-alphabetical bias

  if (activeAgents.length === 0) return null;

  // If no real issue, this is a test/simulation path — return null so callers
  // receive the "all tiers exhausted / human triage" result rather than an
  // arbitrary agent assignment.
  if (!issueId) {
    return null;
  }

  // Build the routing prompt
  const agentList = activeAgents
    .map((a) => `- ${a.name}: ${a.role}`)
    .join('\n');

  const routingTask =
    `You are a routing agent. Given the issue below, select the best agent from the list.\n` +
    `Respond with valid JSON only: { "assignee": "<agent-name>", "reasoning": "<one sentence>" }\n\n` +
    `## Issue\nTitle: ${issue.title}\nBody: ${issue.body ?? '(none)'}\nLabels: ${issue.labels.join(', ') || '(none)'}\n\n` +
    `## Available Agents\n${agentList}`;

  // Pick the first active agent as the "routing agent" executor
  const routingAgent = activeAgents[0];

  // Get project path for workspace
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));

  if (!project) return null;

  // Create the specifier_run issueRun (Invariant 1 + AC Demo8-Durability-1)
  const [specifierRun] = await db
    .insert(issueRuns)
    .values({
      issueId,
      agentId: routingAgent.id,
      kind: 'specifier_run',
      status: 'pending',
      routingTier: 3,
      output: '[specifier_run pending]',
    })
    .returning({ id: issueRuns.id });

  // Invariant 1: all LLM work goes through executeAgentRun
  const result = await executeAgentRun({
    issueRunId: specifierRun.id,
    projectId,
    agent: routingAgent,
    issueTitle: `[ROUTING] ${issue.title}`,
    issueBody: routingTask,
    workspacePath: project.path,
    projectSquadPath: project.path,
  });

  if (!result.success) {
    // Tier-3 failure — mark specifier_run failed and return null so resolveRouteFull
    // logs "all tiers exhausted / human triage" rather than assigning an arbitrary agent.
    await db
      .update(issueRuns)
      .set({
        status: 'failed',
        errorMessage: result.errorMessage ?? 'specifier_run failed',
        updatedAt: new Date(),
      })
      .where(eq(issueRuns.id, specifierRun.id));

    console.warn(`[router] tier3 specifier_run failed for issue — routing to human triage (${result.errorMessage ?? 'unknown'})`);
    return null;
  }

  // Invariant 4: output schema validation — parse { assignee, reasoning }
  let assignee: string | null = null;
  let reasoning = '';

  try {
    // Extract JSON from output (LLM may wrap it in markdown fences)
    const jsonMatch = result.output.match(/\{[\s\S]*"assignee"[\s\S]*\}/);
    if (!jsonMatch) throw new Error('no JSON object found in output');

    const parsed = JSON.parse(jsonMatch[0]) as { assignee?: string; reasoning?: string };

    if (typeof parsed.assignee !== 'string' || !parsed.assignee.trim()) {
      throw new Error('output_schema_violation: assignee field missing or not a string');
    }

    assignee = parsed.assignee.trim();
    reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : '';
  } catch (validationErr) {
    // Invariant 4: schema violation → failure_reason recorded, route to human triage
    const failureReason = `output_schema_violation: ${validationErr instanceof Error ? validationErr.message : String(validationErr)}`;
    await db
      .update(issueRuns)
      .set({ status: 'failed', errorMessage: failureReason, updatedAt: new Date() })
      .where(eq(issueRuns.id, specifierRun.id));

    console.warn(`[router] tier3 output schema violation — routing to human triage: ${failureReason}`);
    return null;
  }

  // Resolve agent by name; if name not found, return null (human triage) rather
  // than silently routing to an arbitrary first agent.
  const resolvedAgent = activeAgents.find(
    (a) => a.name.toLowerCase() === assignee!.toLowerCase(),
  );
  if (!resolvedAgent) {
    await db
      .update(issueRuns)
      .set({ status: 'failed', errorMessage: `agent '${assignee}' not found in project`, updatedAt: new Date() })
      .where(eq(issueRuns.id, specifierRun.id));
    console.warn(`[router] tier3 resolved agent '${assignee}' not found — routing to human triage`);
    return null;
  }

  await db
    .update(issueRuns)
    .set({
      status: 'completed',
      routingReasoning: reasoning,
      updatedAt: new Date(),
    })
    .where(eq(issueRuns.id, specifierRun.id));

  return {
    agentId: resolvedAgent.id,
    agentName: resolvedAgent.name,
    reasoning,
    specifierRunId: specifierRun.id,
  };
}

// ---------------------------------------------------------------------------
// logRoutingDecision
// ---------------------------------------------------------------------------

interface RoutingDecision {
  projectId: string;
  issueId: string | null;
  tier: number | null;
  resolvedAgent: string | null;
  matchedRule: string | null;
  score: number | null;
  reasoning: string | null;
  specifierRunId: string | null;
}

async function logRoutingDecision(decision: RoutingDecision): Promise<void> {
  const db = getDb();
  await db.insert(schema.routingLog).values({
    projectId: decision.projectId,
    issueId: decision.issueId ?? undefined,
    tier: decision.tier ?? undefined,
    resolvedAgent: decision.resolvedAgent ?? undefined,
    matchedRule: decision.matchedRule ?? undefined,
    score: decision.score != null ? String(decision.score) : undefined,
    reasoning: decision.reasoning ?? undefined,
    specifierRunId: decision.specifierRunId ?? undefined,
    decidedAt: new Date(),
  });
}

// ---------------------------------------------------------------------------
// resolveRouteFull — tries Tier 1 → 2 → 3, logs decision
// ---------------------------------------------------------------------------

export interface FullRouteResult {
  tier: 1 | 2 | 3 | null;  // null = all tiers missed (human triage)
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
export async function resolveRouteFull(
  projectId: string,
  issue: { title: string; labels: string[]; body?: string },
  issueId: string | null,
): Promise<FullRouteResult> {
  // --- Tier 1: deterministic rule match ---
  const tier1 = await resolveRoute(projectId, issue);
  if (tier1) {
    const result: FullRouteResult = {
      tier: 1,
      agentName: tier1.agentName,
      agentId: null, // Tier-1 resolves by name; caller looks up agentId
      score: null,
      reasoning: `tier1: matched rule "${tier1.rule.rawRule}"`,
      matchedRule: tier1.rule.rawRule,
      specifierRunId: null,
    };
    await logRoutingDecision({
      projectId,
      issueId,
      tier: 1,
      resolvedAgent: tier1.agentName,
      matchedRule: tier1.rule.rawRule,
      score: null,
      reasoning: result.reasoning,
      specifierRunId: null,
    });
    return result;
  }

  // --- Tier 2: keyword/label scoring ---
  const tier2 = await resolveRouteTier2(projectId, issue);
  if (tier2) {
    const result: FullRouteResult = {
      tier: 2,
      agentName: tier2.agentName,
      agentId: tier2.agentId,
      score: tier2.score,
      reasoning: tier2.reasoning,
      matchedRule: 'keyword-score',
      specifierRunId: null,
    };
    await logRoutingDecision({
      projectId,
      issueId,
      tier: 2,
      resolvedAgent: tier2.agentName,
      matchedRule: 'keyword-score',
      score: tier2.score,
      reasoning: tier2.reasoning,
      specifierRunId: null,
    });
    return result;
  }

  // --- Tier 3: LLM specifier ---
  const tier3 = await resolveRouteTier3(projectId, issue, issueId);
  if (tier3) {
    const result: FullRouteResult = {
      tier: 3,
      agentName: tier3.agentName,
      agentId: tier3.agentId,
      score: null,
      reasoning: tier3.reasoning,
      matchedRule: 'llm-specifier',
      specifierRunId: tier3.specifierRunId || null,
    };
    await logRoutingDecision({
      projectId,
      issueId,
      tier: 3,
      resolvedAgent: tier3.agentName,
      matchedRule: 'llm-specifier',
      score: null,
      reasoning: tier3.reasoning,
      specifierRunId: tier3.specifierRunId || null,
    });
    return result;
  }

  // --- All tiers missed: human triage ---
  await logRoutingDecision({
    projectId,
    issueId,
    tier: null,
    resolvedAgent: null,
    matchedRule: null,
    score: null,
    reasoning: 'all tiers exhausted — human triage required',
    specifierRunId: null,
  });

  return {
    tier: null,
    agentName: null,
    agentId: null,
    score: null,
    reasoning: 'all tiers exhausted — human triage required',
    matchedRule: null,
    specifierRunId: null,
  };
}

// ---------------------------------------------------------------------------
// createRoutedRun
// ---------------------------------------------------------------------------

/**
 * Create an issue_run for a routing-resolved assignment.
 *
 * Inserts with kind='agent_run' (Invariant 1: routing desugars to agent_run).
 * Includes routing audit fields so the tier is visible per-run.
 */
export async function createRoutedRun(
  issueId: string,
  agentId: string,
  resolvedByRule: string,
  routingTier?: 1 | 2 | 3,
  routingScore?: number | null,
  routingReasoning?: string | null,
): Promise<string> {
  const db = getDb();
  const { issueRuns } = schema;

  const [run] = await db
    .insert(issueRuns)
    .values({
      issueId,
      agentId,
      kind: 'agent_run',
      status: 'pending',
      output: `[auto-routed by rule: ${resolvedByRule}]`,
      routingTier: routingTier ?? null,
      routingScore: routingScore != null ? String(routingScore) : null,
      routingReasoning: routingReasoning ?? null,
    })
    .returning({ id: issueRuns.id });

  console.log(`[router] created issue_run ${run.id} for issue ${issueId} → agent ${agentId} (tier ${routingTier ?? '?'}, rule: ${resolvedByRule})`);
  return run.id;
}

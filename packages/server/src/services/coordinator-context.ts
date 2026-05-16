/**
 * services/coordinator-context.ts — W28 J5
 *
 * Builds the CoordinatorContext injected into every Consult turn.
 * Mirrors the @bradygaster/squad-sdk SquadCoordinator pattern:
 *   - teamRoster    = raw .squad/team.md
 *   - activeAgents  = DB query (status=active)
 *   - config        = SquadConfig summary (defaultModel/defaultTier/rules count)
 *
 * System-prompt layout:
 *   1. Always-on squadboard meta preamble (~150 tokens)
 *   2. Coordinator identity (.github/agents/squad.agent.md or SDK template)
 *   3. Team roster (never truncated)
 *   4. Active agents (never truncated)
 *   5. Config summary (never truncated)
 *   === SQUADBOARD VIEW === (board/runs/inbox — capped within 8K variable budget)
 *   === DECISIONS (last 10) === (capped)
 *   === ORCHESTRATION LOG (last 5) === (capped, truncated first)
 *
 * 8K token cap: applies to variable sections (decisions + log + squadboard view).
 * Never-truncated: meta + identity + team.md + activeAgents + config.
 *
 * Privacy: redacts env-style secrets, Slack tokens, GitHub PATs, Bearer headers.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { getDb, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Token approximation
// ---------------------------------------------------------------------------

/** Approximation: 1 token ≈ 4 chars. No tiktoken dependency. */
export function tokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Privacy redaction
// ---------------------------------------------------------------------------

const REDACT_PATTERNS: Array<[RegExp, string]> = [
  // env-style KEY=<long base64/hex/opaque value> (allow hyphens, underscores, dots in value)
  [/\b[A-Z][A-Z0-9_]{3,}\s*=\s*[A-Za-z0-9+/=._\-]{20,}\b/g, '[REDACTED]'],
  // Slack tokens
  [/xox[a-zA-Z]-[A-Za-z0-9-]{20,}/g, '[REDACTED]'],
  // GitHub PATs
  [/ghp_[A-Za-z0-9]{36,}/g, '[REDACTED]'],
  [/github_pat_[A-Za-z0-9_]{36,}/g, '[REDACTED]'],
  // Bearer tokens in Authorization headers
  [/Bearer [A-Za-z0-9._\-]{20,}/g, '[REDACTED]'],
];

export function redact(text: string): { text: string; count: number } {
  let count = 0;
  let result = text;
  for (const [pattern, replacement] of REDACT_PATTERNS) {
    result = result.replace(pattern, () => {
      count++;
      return replacement;
    });
  }
  return { text: result, count };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContextSection {
  name: string;
  content: string;
  tokens: number;
  truncated: boolean;
}

/** SquadConfig-compatible summary for DirectResponseHandler. */
export interface SquadConfigSummary {
  version: string;
  models: {
    defaultModel: string;
    defaultTier: string;
    fallbackChains: { premium: string[]; standard: string[]; fast: string[] };
    respectTierCeiling: boolean;
  };
  routing: { rules: unknown[] };
}

/** SDK CoordinatorContext shape for DirectResponseHandler. */
export interface SdkCoordinatorContext {
  sessionId: string;
  config: SquadConfigSummary;
  teamRoster?: string;
  activeAgents?: string[];
  metadata?: Record<string, unknown>;
}

export interface CoordinatorContextResult {
  sessionId: string;
  /** Full assembled system prompt (meta preamble + identity + supplementary). */
  systemPrompt: string;
  /** Supplementary context block only (below identity, for injection). */
  supplementaryBlock: string;
  sections: ContextSection[];
  totalTokens: number;
  /** Tokens in variable sections (decisions + log + squadboard view). */
  variableTokens: number;
  truncationLog: string[];
  redactionCount: number;
  sdkContext: SdkCoordinatorContext;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VARIABLE_SECTION_BUDGET = 8192; // tokens for decisions + log + squadboard view
const DECISIONS_TAIL = 10;            // last N decision entries to include
const ORCH_LOG_TAIL = 5;              // last N orchestration-log files to include

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

async function safeRead(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function safeReadDir(dirPath: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath);
    return entries.sort(); // lexicographic = chronological for ISO-prefixed filenames
  } catch {
    return [];
  }
}

/** Trim decisions.md to the last N entries separated by `---` horizontal rules. */
function trimDecisions(raw: string, maxEntries: number): string {
  const parts = raw.split(/\n---+\n/);
  if (parts.length <= maxEntries + 1) return raw;
  const header = parts[0]; // "# Squad Decisions\n..."
  const tail = parts.slice(-(maxEntries));
  return [header, '*(older entries omitted)*', ...tail].join('\n\n---\n\n');
}

// ---------------------------------------------------------------------------
// Config loader
// ---------------------------------------------------------------------------

async function loadSquadConfigSummary(workspacePath: string): Promise<SquadConfigSummary> {
  const configPath = path.join(workspacePath, '.squad', 'config.json');
  const raw = await safeRead(configPath);
  let parsed: Record<string, unknown> = {};
  if (raw) {
    try { parsed = JSON.parse(raw) as Record<string, unknown>; } catch { /* ignore */ }
  }

  // Build minimal SquadConfig-compatible summary with sensible defaults.
  return {
    version: String((parsed as Record<string, unknown>).version ?? '1'),
    models: {
      defaultModel: 'gpt-5.4',
      defaultTier: 'standard',
      fallbackChains: { premium: [], standard: ['gpt-5.4'], fast: ['gpt-5.4-mini'] },
      respectTierCeiling: true,
    },
    routing: { rules: [] },
  };
}

// ---------------------------------------------------------------------------
// Active agents query
// ---------------------------------------------------------------------------

async function queryActiveAgents(projectId: string | null): Promise<string[]> {
  try {
    const db = getDb();
    let query = db
      .select({ name: schema.agents.name })
      .from(schema.agents)
      .where(eq(schema.agents.status, 'active'));
    if (projectId) {
      query = db
        .select({ name: schema.agents.name })
        .from(schema.agents)
        .where(eq(schema.agents.projectId, projectId));
    }
    const rows = await query;
    return rows.map((r) => r.name);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Meta preamble
// ---------------------------------------------------------------------------

function buildMetaPreamble(sessionId: string, agentCount: number, ts: string): string {
  return [
    `<!-- squadboard-coordinator-meta: session=${sessionId} ts=${ts} -->`,
    `**Squadboard Coordinator Context** | Wave W28 | SDK @bradygaster/squad-sdk v0.9.4`,
    `Active agents: ${agentCount} | Refresh: per-turn | Cap: 8K variable tokens`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export async function buildCoordinatorContext(
  sessionId: string,
  projectId: string | null = null,
  workspacePath: string = process.cwd(),
): Promise<CoordinatorContextResult> {
  const ts = new Date().toISOString();
  const sections: ContextSection[] = [];
  const truncationLog: string[] = [];
  let totalRedactionCount = 0;

  // ── 1. Identity (squad.agent.md) — never truncated ──────────────────────
  const identityPath = path.join(workspacePath, '.github', 'agents', 'squad.agent.md');
  const identityRaw = await safeRead(identityPath);
  const identityContent = identityRaw ?? [
    '# Squad Coordinator',
    'You are the Squad Coordinator. Route work to specialist agents, enforce handoffs,',
    'and surface project state to the user.',
  ].join('\n');
  sections.push({
    name: 'Coordinator Identity (squad.agent.md)',
    content: identityContent,
    tokens: tokenCount(identityContent),
    truncated: false,
  });

  // ── 2. Team roster — never truncated ────────────────────────────────────
  const teamPath = path.join(workspacePath, '.squad', 'team.md');
  const teamRaw = await safeRead(teamPath) ?? '_No team.md found._';
  const { text: teamContent, count: teamRedactions } = redact(teamRaw);
  totalRedactionCount += teamRedactions;
  sections.push({
    name: 'Team Roster (.squad/team.md)',
    content: teamContent,
    tokens: tokenCount(teamContent),
    truncated: false,
  });

  // ── 3. Active agents — never truncated ──────────────────────────────────
  const activeAgents = await queryActiveAgents(projectId);
  const agentsContent = activeAgents.length > 0
    ? `Active agents: ${activeAgents.join(', ')}`
    : 'No active agents found in DB.';
  sections.push({
    name: 'Active Agents (DB)',
    content: agentsContent,
    tokens: tokenCount(agentsContent),
    truncated: false,
  });

  // ── 4. Meta preamble — never truncated ──────────────────────────────────
  const metaContent = buildMetaPreamble(sessionId, activeAgents.length, ts);
  // Insert at front of sections array for ordering in prompt
  sections.unshift({
    name: 'Squadboard Meta Preamble',
    content: metaContent,
    tokens: tokenCount(metaContent),
    truncated: false,
  });

  // ── 5. Config summary — never truncated ─────────────────────────────────
  const config = await loadSquadConfigSummary(workspacePath);
  const configContent = [
    `**Config v${config.version}** | Model: ${config.models.defaultModel} (${config.models.defaultTier} tier) | Routing rules: ${config.routing.rules.length}`,
  ].join('\n');
  sections.push({
    name: 'Squad Config',
    content: configContent,
    tokens: tokenCount(configContent),
    truncated: false,
  });

  // ── Variable sections (budget: VARIABLE_SECTION_BUDGET tokens) ───────────

  // ── 6. Decisions (last 10) ───────────────────────────────────────────────
  const decisionsPath = path.join(workspacePath, '.squad', 'decisions.md');
  const decisionsRaw = await safeRead(decisionsPath);
  let decisionsContent: string;
  let decisionsSection: ContextSection;
  if (decisionsRaw) {
    const { text: redacted, count: rCount } = redact(decisionsRaw);
    totalRedactionCount += rCount;
    decisionsContent = trimDecisions(redacted, DECISIONS_TAIL);
    decisionsSection = {
      name: `Decisions (last ${DECISIONS_TAIL})`,
      content: decisionsContent,
      tokens: tokenCount(decisionsContent),
      truncated: decisionsContent.length < redacted.length,
    };
  } else {
    decisionsSection = {
      name: 'Decisions',
      content: '_No decisions.md found._',
      tokens: tokenCount('_No decisions.md found._'),
      truncated: false,
    };
  }

  // ── 7. Orchestration log (last 5 files) ──────────────────────────────────
  const orchLogDir = path.join(workspacePath, '.squad', 'orchestration-log');
  const orchFiles = await safeReadDir(orchLogDir);
  const recentOrchFiles = orchFiles.filter((f) => f.endsWith('.md')).slice(-ORCH_LOG_TAIL);
  const orchParts: string[] = [];
  for (const fname of recentOrchFiles) {
    const content = await safeRead(path.join(orchLogDir, fname));
    if (content) {
      const { text: redacted, count: rCount } = redact(content);
      totalRedactionCount += rCount;
      orchParts.push(`### ${fname}\n${redacted}`);
    }
  }
  const orchContent = orchParts.length > 0
    ? orchParts.join('\n\n---\n\n')
    : '_No orchestration log entries found._';
  const orchSection: ContextSection = {
    name: `Orchestration Log (last ${ORCH_LOG_TAIL} files)`,
    content: orchContent,
    tokens: tokenCount(orchContent),
    truncated: false,
  };

  // ── 8. Squadboard view ───────────────────────────────────────────────────
  const squadboardViewContent = await buildSquadboardView(projectId, workspacePath);
  const { text: sqRedacted, count: sqCount } = redact(squadboardViewContent);
  totalRedactionCount += sqCount;
  const squadboardSection: ContextSection = {
    name: 'Squadboard View',
    content: sqRedacted,
    tokens: tokenCount(sqRedacted),
    truncated: false,
  };

  // ── Apply 8K variable budget with truncation order ───────────────────────
  // Truncation order: orchestration-log → decisions tail → inbox → board tails
  let variableTokens =
    orchSection.tokens + decisionsSection.tokens + squadboardSection.tokens;

  if (variableTokens > VARIABLE_SECTION_BUDGET) {
    const SUFFIX_TOKENS = 15; // conservative buffer for truncation suffix strings

    // Step 1: truncate orchestration log (drop oldest entries)
    if (orchSection.tokens > 0 && variableTokens > VARIABLE_SECTION_BUDGET) {
      const allowed = Math.max(
        0,
        VARIABLE_SECTION_BUDGET - decisionsSection.tokens - squadboardSection.tokens - SUFFIX_TOKENS,
      );
      if (orchSection.tokens > allowed + SUFFIX_TOKENS) {
        const allowedChars = allowed * 4;
        orchSection.content = orchSection.content.slice(0, allowedChars) + '\n\n*(truncated)*';
        orchSection.tokens = tokenCount(orchSection.content);
        orchSection.truncated = true;
        truncationLog.push(`Truncated orchestration-log to ~${allowed} tokens`);
        variableTokens = orchSection.tokens + decisionsSection.tokens + squadboardSection.tokens;
      }
    }

    // Step 2: truncate decisions tail (remove oldest decisions)
    if (variableTokens > VARIABLE_SECTION_BUDGET && decisionsSection.tokens > 0) {
      const allowed = Math.max(
        0,
        VARIABLE_SECTION_BUDGET - orchSection.tokens - squadboardSection.tokens - SUFFIX_TOKENS,
      );
      if (decisionsSection.tokens > allowed + SUFFIX_TOKENS) {
        const allowedChars = allowed * 4;
        decisionsSection.content =
          decisionsSection.content.slice(0, allowedChars) + '\n\n*(older decisions truncated)*';
        decisionsSection.tokens = tokenCount(decisionsSection.content);
        decisionsSection.truncated = true;
        truncationLog.push(`Truncated decisions tail to ~${allowed} tokens`);
        variableTokens = orchSection.tokens + decisionsSection.tokens + squadboardSection.tokens;
      }
    }

    // Step 3: truncate squadboard view (board tails)
    if (variableTokens > VARIABLE_SECTION_BUDGET && squadboardSection.tokens > 0) {
      const allowed = Math.max(
        0,
        VARIABLE_SECTION_BUDGET - orchSection.tokens - decisionsSection.tokens - SUFFIX_TOKENS,
      );
      if (squadboardSection.tokens > allowed + SUFFIX_TOKENS) {
        const allowedChars = allowed * 4;
        squadboardSection.content =
          squadboardSection.content.slice(0, allowedChars) + '\n\n*(board view truncated)*';
        squadboardSection.tokens = tokenCount(squadboardSection.content);
        squadboardSection.truncated = true;
        truncationLog.push(`Truncated squadboard view to ~${allowed} tokens`);
        variableTokens = orchSection.tokens + decisionsSection.tokens + squadboardSection.tokens;
      }
    }
  }

  sections.push(decisionsSection, orchSection, squadboardSection);

  // ── Assemble supplementary block ─────────────────────────────────────────
  const supplementaryBlock = [
    '\n\n---\n## Team Roster\n',
    teamContent,
    '\n\n---\n## Active Agents\n',
    agentsContent,
    '\n\n---\n## Configuration\n',
    configContent,
    '\n\n---\n## Squadboard View\n',
    squadboardSection.content,
    '\n\n---\n## Decisions\n',
    decisionsSection.content,
    '\n\n---\n## Orchestration Log\n',
    orchSection.content,
  ].join('');

  // ── Assemble full system prompt ───────────────────────────────────────────
  const systemPrompt = [
    metaContent,
    '\n\n---\n',
    identityContent,
    supplementaryBlock,
  ].join('');

  const totalTokens = sections.reduce((s, sec) => s + sec.tokens, 0);

  return {
    sessionId,
    systemPrompt,
    supplementaryBlock,
    sections,
    totalTokens,
    variableTokens,
    truncationLog,
    redactionCount: totalRedactionCount,
    sdkContext: {
      sessionId,
      config,
      teamRoster: teamContent,
      activeAgents,
      metadata: { projectId, wave: 'W28', ts },
    },
  };
}

// ---------------------------------------------------------------------------
// Squadboard view — lightweight snapshot
// ---------------------------------------------------------------------------

async function buildSquadboardView(
  projectId: string | null,
  workspacePath: string,
): Promise<string> {
  const parts: string[] = ['**Squadboard View**'];

  // Inbox snapshot — .squad/decisions/inbox/ directory
  try {
    const inboxDir = path.join(workspacePath, '.squad', 'decisions', 'inbox');
    const inboxFiles = await safeReadDir(inboxDir);
    const recent = inboxFiles.filter((f) => f.endsWith('.md')).slice(-5);
    if (recent.length > 0) {
      parts.push('\n**Inbox (recent):**');
      for (const f of recent) {
        parts.push(`- ${f}`);
      }
    }
  } catch { /* ignore */ }

  // Agent summary from DB (best-effort; doesn't need projectId)
  if (projectId) {
    try {
      const db = getDb();
      const activeAgentRows = await db
        .select({ name: schema.agents.name, role: schema.agents.role })
        .from(schema.agents)
        .where(eq(schema.agents.projectId, projectId));
      if (activeAgentRows.length > 0) {
        parts.push('\n**Project agents:**');
        for (const a of activeAgentRows.slice(0, 8)) {
          parts.push(`- ${a.name} (${a.role})`);
        }
      }
    } catch { /* ignore if schema not available */ }
  }

  return parts.join('\n');
}

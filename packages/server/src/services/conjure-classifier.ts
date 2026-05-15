/**
 * services/conjure-classifier.ts — Phase 1 Conjure intent classifier.
 *
 * Conjure replaces the old free-form Capture inbox: the user types ANY
 * prose ("I need a tool that summarizes PDFs", "fix the login button on
 * Safari") and Conjure routes them to the right creation flow with a
 * pre-filled draft.
 *
 * Strategy = HYBRID (Option C from Hockney's spec):
 *   1. Rule-based scoring runs first (fast, deterministic, free).
 *   2. If top score >= CONFIDENCE_THRESHOLD → return immediately.
 *   3. Otherwise, optionally call the LLM (`runFormulator`) to disambiguate;
 *      the LLM call is wrapped in try/catch so a missing SDK / model never
 *      breaks the surface — we degrade to the best rule-based candidate.
 *
 * Phase 1 surfaces 6 intents (per Ahmed's task brief):
 *   project | issue | team | agent | skill | tool
 *
 * Phase 2 will likely re-introduce inbox-item / consult / ceremony /
 * mcp-server / project-template — see decision doc for the roadmap.
 */

import { extractJsonObject, runFormulator } from './formulator.js';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type ConjureIntent =
  | 'project'
  | 'issue'
  | 'team'
  | 'agent'
  | 'skill'
  | 'tool';

export const ALL_INTENTS: ConjureIntent[] = [
  'project',
  'issue',
  'team',
  'agent',
  'skill',
  'tool',
];

export interface ConjureContext {
  /** The project the user is currently viewing, if any. */
  currentProjectId?: string | null;
  /** Display name of the current project (helps the LLM choose). */
  currentProjectName?: string | null;
}

export interface ConjureRequest {
  prompt: string;
  context?: ConjureContext | null;
  /**
   * Optional intent the user already picked (e.g. via a chip / kind picker).
   * When set, the rule scorer boosts that intent so the response respects
   * the user's choice unless the prompt strongly contradicts it.
   */
  hint?: ConjureIntent | null;
  /**
   * If false, never call the LLM (rule-based only). Defaults to true.
   * The LLM is also skipped automatically when rule-based confidence is
   * already above CONFIDENCE_THRESHOLD.
   */
  useLlm?: boolean;
}

export interface ConjureRouting {
  /**
   * Path template the client navigates to. May contain `:projectId`
   * placeholders the client substitutes from its current context.
   */
  destination: string;
  /** Hint to the client about how to render the create flow. */
  presentation: 'modal' | 'page';
  /**
   * Up to 2 alternative intents (ranked by confidence) the user can
   * override to via the UI ("not what you meant?" chips).
   */
  fallbacks: ConjureIntent[];
}

export interface ConjureResponse {
  intent: ConjureIntent;
  confidence: number;
  draft: Record<string, unknown>;
  routing: ConjureRouting;
  rationale: string;
  /** Which path produced the result — useful for logs + UI debugging. */
  strategy: 'rule-based' | 'llm';
}

// ---------------------------------------------------------------------------
// Rule-based scorer
// ---------------------------------------------------------------------------

/** A weighted signal: when the regex matches the prompt, add `weight` to the
 * intent's score. Patterns use word boundaries; case-insensitive at scoring
 * time. */
interface Signal {
  pattern: RegExp;
  weight: number;
}

const SIGNALS: Record<ConjureIntent, Signal[]> = {
  project: [
    { pattern: /\b(new\s+)?project\b/i, weight: 3 },
    { pattern: /\b(build|create|spin\s*up|start|launch)\s+(a|an|the|my)?\s*(new\s+)?(app|application|cli|website|site|service|platform|system|product|tool\s*chain|prototype|mvp)\b/i, weight: 3 },
    { pattern: /\bI\s+(want|need)\s+to\s+(build|make|create|ship)\b/i, weight: 2 },
    { pattern: /\b(MVP|prototype|monorepo|codebase|repo|repository)\b/i, weight: 2 },
    { pattern: /\b(app|application|website|platform|product)\b/i, weight: 1 },
  ],
  issue: [
    { pattern: /\b(bug|defect|broken|breaks|crash(?:es|ed|ing)?|regression|hotfix)\b/i, weight: 3 },
    { pattern: /\b(fix|resolve|debug|patch|repair)\s+(the|a|an|this|my|our)\b/i, weight: 3 },
    { pattern: /\b(does\s*n['’]?t|doesn'?t|won'?t|can'?t|cannot|fails?\s*to)\s+(work|load|render|start|build|run|compile|save|open)\b/i, weight: 3 },
    { pattern: /\b(error|exception|stack\s*trace|500|404|NPE|undefined)\b/i, weight: 2 },
    { pattern: /\b(safari|chrome|firefox|edge|mobile|ios|android)\b/i, weight: 1 },
    { pattern: /\b(button|link|input|form|page|modal|dropdown|nav|navbar)\b/i, weight: 1 },
    { pattern: /\b(todo|task|ticket|issue)\b/i, weight: 2 },
  ],
  team: [
    { pattern: /\b(I\s+need\s+a|hire\s+(me\s+)?a|put\s+together\s+a|assemble\s+a|cast\s+a)\s*(new\s+)?(team|squad|crew|cast|group|posse|panel|cohort)\b/i, weight: 4 },
    { pattern: /\b(team|squad|crew|cast|cohort)\b/i, weight: 2 },
    { pattern: /\b(hire|recruit|staff|build\s+a\s+team|build\s+me\s+a\s+team)\b/i, weight: 3 },
    { pattern: /\b(frontend|backend|full[-\s]?stack|design|qa|devops|security)\s+(team|group|crew|squad)\b/i, weight: 3 },
    { pattern: /\b\d+\s+(engineers?|developers?|designers?|people)\b/i, weight: 2 },
  ],
  agent: [
    { pattern: /\b(an?|one|single)\s+(ai\s+)?agent\b/i, weight: 4 },
    { pattern: /\bagent\s+(that|who|to|for|which)\b/i, weight: 3 },
    { pattern: /\b(an?\s+)?(ai|bot|copilot|assistant|persona|character)\s+(that|who|which|to|for)\b/i, weight: 3 },
    { pattern: /\b(watch(?:es|ing)?|monitor(?:s|ing)?|review(?:s|ing)?|automate(?:s|d)?)\s+(the|my|our|all)\b/i, weight: 2 },
    { pattern: /\b(role|persona)\b/i, weight: 1 },
    { pattern: /\b(hire|create|add)\s+(an?|one)\s+(ai|agent|bot|assistant)\b/i, weight: 3 },
  ],
  skill: [
    { pattern: /\b(reusable|shared)\s+(pattern|recipe|playbook|prompt|instruction|guide)\b/i, weight: 4 },
    { pattern: /\b(skill|how[-\s]?to|playbook|recipe|guide|cheat[-\s]?sheet)\b/i, weight: 3 },
    { pattern: /\b(pattern|template)\s+for\s+(handling|doing|writing|reviewing)\b/i, weight: 3 },
    { pattern: /\b(instruction|prompt)s?\s+for\s+(an?\s+)?agent\b/i, weight: 3 },
    { pattern: /\b(claude|copilot)\s+skill\b/i, weight: 4 },
  ],
  tool: [
    { pattern: /\b(MCP\s+server|model\s+context\s+protocol)\b/i, weight: 4 },
    { pattern: /\b(a|an)\s+(custom\s+)?(tool|script|utility|cli\s+command|function|helper)\b/i, weight: 3 },
    { pattern: /\btool\s+(that|to|for|which)\b/i, weight: 3 },
    { pattern: /\bscript\s+(that|to|for|which)\b/i, weight: 3 },
    { pattern: /\b(summarize|summarise|extract|parse|fetch|crawl|scrape|convert|transform|generate|format)\s+(pdf|html|json|markdown|csv|xml|file|files|docs|images?)\b/i, weight: 3 },
    { pattern: /\b(API|endpoint|webhook|integration)\b/i, weight: 1 },
    { pattern: /\b(function|callable|action)\s+the\s+(agent|model|llm)\s+can\s+call\b/i, weight: 4 },
  ],
};

interface RuleScore {
  intent: ConjureIntent;
  rawScore: number;
  matched: string[];
}

/** Run the rule-based scorer over `prompt`. Returns scores for ALL intents,
 * sorted by score desc. Pure / deterministic. */
function scorePromptByRules(prompt: string, hint?: ConjureIntent | null): RuleScore[] {
  const text = prompt;
  const scores: RuleScore[] = ALL_INTENTS.map((intent) => {
    let raw = 0;
    const matched: string[] = [];
    for (const sig of SIGNALS[intent]) {
      if (sig.pattern.test(text)) {
        raw += sig.weight;
        matched.push(sig.pattern.source);
      }
    }
    return { intent, rawScore: raw, matched };
  });

  if (hint && ALL_INTENTS.includes(hint)) {
    for (const s of scores) {
      if (s.intent === hint) {
        s.rawScore = s.rawScore * 1.5 + 1;
        s.matched.unshift('(user hint)');
      }
    }
  }

  scores.sort((a, b) => b.rawScore - a.rawScore);
  return scores;
}

/** Convert a raw score to a 0..1 confidence using a soft saturation curve. */
function rawScoreToConfidence(raw: number): number {
  if (raw <= 0) return 0;
  const c = raw / (raw + 2.5);
  return Math.min(1, Math.max(0, c));
}

/** When all intents score 0 we still need to pick something — default to
 * `issue` per the team's locked-in design (board captures default to
 * issues when no clear signal exists). */
const AMBIGUOUS_DEFAULT: ConjureIntent = 'issue';

/** Confidence at or above this skips the LLM disambiguation call. */
const CONFIDENCE_THRESHOLD = 0.55;

// ---------------------------------------------------------------------------
// Draft builders
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'the','a','an','and','or','but','if','then','else','of','on','in','for','to','from','with','at','by','about','as','i','we','you','it','this','that','these','those','my','our','your','their','need','want','build','create','make','add','want','one','some','any',
]);

function firstSentence(prompt: string): string {
  const m = prompt.match(/[^.!?\n]{1,160}([.!?]|\n|$)/);
  return (m ? m[0] : prompt).trim().replace(/[.!?]\s*$/, '');
}

function toKebab(s: string, max = 30): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !STOPWORDS.has(w))
    .slice(0, 4)
    .join('-')
    .slice(0, max) || 'untitled';
}

function imperativeTitle(prompt: string, max = 80): string {
  const sentence = firstSentence(prompt);
  const cleaned = sentence
    .replace(/^\s*(I\s+(want|need|would\s+like)\s+to|please|can\s+you|could\s+you|let['’]?s)\s+/i, '')
    .replace(/^\s*the\s+/i, '')
    .trim();
  const truncated = cleaned.length > max ? cleaned.slice(0, max - 1).trimEnd() + '…' : cleaned;
  return truncated.charAt(0).toUpperCase() + truncated.slice(1);
}

function detectKeywords(prompt: string, candidates: string[]): string[] {
  const lower = prompt.toLowerCase();
  return candidates.filter((c) => lower.includes(c.toLowerCase()));
}

function buildIssueDraft(prompt: string): Record<string, unknown> {
  const title = imperativeTitle(prompt);
  const labels = detectKeywords(prompt, ['bug', 'ui', 'backend', 'frontend', 'docs', 'performance', 'security']);
  if (/\b(bug|broken|breaks|crash|regression|hotfix|fix)\b/i.test(prompt) && !labels.includes('bug')) {
    labels.unshift('bug');
  }
  const priority = /\b(urgent|asap|production|blocker|critical|p0|p1)\b/i.test(prompt)
    ? 'high'
    : /\b(minor|nit|cleanup|nice\s*to\s*have)\b/i.test(prompt)
      ? 'low'
      : 'medium';
  return {
    title,
    body: prompt.trim(),
    suggestedLabels: labels,
    suggestedPriority: priority,
  };
}

function buildProjectDraft(prompt: string): Record<string, unknown> {
  const name = toKebab(firstSentence(prompt));
  const description = imperativeTitle(prompt, 200);
  const tags: string[] = [];
  if (/\bcli\b/i.test(prompt)) tags.push('cli');
  if (/\bweb(site)?|app(lication)?\b/i.test(prompt)) tags.push('web');
  if (/\bmobile|ios|android\b/i.test(prompt)) tags.push('mobile');
  if (/\bapi|backend|server\b/i.test(prompt)) tags.push('backend');
  return {
    name,
    description,
    suggestedTags: tags,
  };
}

function buildTeamDraft(prompt: string): Record<string, unknown> {
  const lower = prompt.toLowerCase();
  const roles: string[] = [];
  if (/frontend|react|ui|ux|design/i.test(prompt)) roles.push('Frontend Developer');
  if (/backend|api|server|database/i.test(prompt)) roles.push('Backend Developer');
  if (/devops|infra|deploy|ci|cd|kubernetes|docker/i.test(prompt)) roles.push('DevOps Engineer');
  if (/qa|test|quality/i.test(prompt)) roles.push('QA Engineer');
  if (/design(er)?|figma|wireframe|mock/i.test(prompt)) roles.push('Designer');
  if (/security|auth|owasp|pen[-\s]?test/i.test(prompt)) roles.push('Security Engineer');
  if (roles.length === 0) {
    roles.push('Backend Developer', 'Frontend Developer');
  }
  let universe: string | null = null;
  for (const u of ['ocean11', 'usual-suspects', 'parks-rec', 'parks-and-rec', 'office']) {
    if (lower.includes(u)) {
      universe = u;
      break;
    }
  }
  let projectType = 'web-app';
  if (/cli|command\s*line/i.test(prompt)) projectType = 'cli';
  else if (/api|service|backend/i.test(prompt) && !/frontend|ui/i.test(prompt)) projectType = 'api-service';
  else if (/mobile|ios|android/i.test(prompt)) projectType = 'mobile-app';
  return {
    universe,
    roles,
    teamSize: Math.max(roles.length, 3),
    projectType,
  };
}

function buildAgentDraft(prompt: string): Record<string, unknown> {
  const sentence = firstSentence(prompt);
  const role = imperativeTitle(sentence.replace(/^(an?|one)\s+(ai\s+)?agent\s+(that|who|which|to|for)\s+/i, ''), 40);
  const expertise = detectKeywords(prompt, [
    'TypeScript', 'Python', 'React', 'Node', 'AWS', 'Postgres', 'Docker',
    'Kubernetes', 'CI', 'security', 'testing', 'linting', 'docs', 'review',
  ]);
  const suggestedModel =
    /\b(complex|reasoning|hard|deep|opus)\b/i.test(prompt) ? 'claude-opus-4.6'
      : /\b(cheap|fast|simple|haiku)\b/i.test(prompt) ? 'claude-haiku-4.5'
        : 'auto';
  return {
    name: toKebab(role || 'agent'),
    role: role || 'AI Agent',
    expertise: expertise.length > 0 ? expertise : ['general'],
    suggestedModel,
  };
}

function buildSkillDraft(prompt: string): Record<string, unknown> {
  const sentence = firstSentence(prompt);
  const cleaned = sentence
    .replace(/^\s*(a|an)\s+(reusable\s+)?(pattern|skill|how[-\s]?to|recipe|guide|playbook)\s+(for|on|to)\s+/i, '')
    .trim();
  return {
    name: toKebab(cleaned || 'skill'),
    description: imperativeTitle(cleaned || sentence, 120),
    body: prompt.trim(),
  };
}

function buildToolDraft(prompt: string): Record<string, unknown> {
  const sentence = firstSentence(prompt);
  const cleaned = sentence
    .replace(/^\s*(a|an)\s+(custom\s+)?(tool|script|utility|function|mcp\s+server)\s+(that|to|for|which)\s+/i, '')
    .trim();
  // Very rough parameter inference: if prompt mentions a common input type,
  // sketch a tiny JSON-Schema fragment so the user has something to edit.
  const properties: Record<string, { type: string; description: string }> = {};
  if (/\bpdf\b/i.test(prompt)) properties['pdfUrl'] = { type: 'string', description: 'URL of the PDF file' };
  if (/\bhtml|webpage|website\b/i.test(prompt)) properties['url'] = { type: 'string', description: 'URL to fetch' };
  if (/\btext|prose\b/i.test(prompt)) properties['text'] = { type: 'string', description: 'Input text' };
  if (Object.keys(properties).length === 0) {
    properties['input'] = { type: 'string', description: 'Tool input' };
  }
  const suggestedSchema = {
    type: 'object',
    properties,
    required: Object.keys(properties),
  };
  return {
    name: toKebab(cleaned || 'tool'),
    description: imperativeTitle(cleaned || sentence, 120),
    suggestedSchema,
    isMcpServer: /\bmcp\b/i.test(prompt),
  };
}

const DRAFT_BUILDERS: Record<ConjureIntent, (prompt: string) => Record<string, unknown>> = {
  project: buildProjectDraft,
  issue: buildIssueDraft,
  team: buildTeamDraft,
  agent: buildAgentDraft,
  skill: buildSkillDraft,
  tool: buildToolDraft,
};

// ---------------------------------------------------------------------------
// Routing table (intent → destination + presentation)
// ---------------------------------------------------------------------------

const ROUTING_TABLE: Record<ConjureIntent, { destination: string; presentation: 'modal' | 'page' }> = {
  // The client substitutes :projectId from its current context. When the
  // user is in the global (no-project) layer, the client SHOULD prompt for
  // a project first OR fall back to the project picker.
  project: { destination: '/projects/new', presentation: 'page' },
  issue:   { destination: '/projects/:projectId/board?conjure=issue', presentation: 'modal' },
  team:    { destination: '/projects/:projectId/agents?conjure=team', presentation: 'page' },
  agent:   { destination: '/projects/:projectId/agents?conjure=agent', presentation: 'modal' },
  skill:   { destination: '/projects/:projectId/skills?conjure=skill', presentation: 'page' },
  tool:    { destination: '/projects/:projectId/tools?conjure=tool', presentation: 'page' },
};

function buildRouting(intent: ConjureIntent, scores: RuleScore[]): ConjureRouting {
  const base = ROUTING_TABLE[intent];
  const fallbacks = scores
    .filter((s) => s.intent !== intent && s.rawScore > 0)
    .slice(0, 2)
    .map((s) => s.intent);
  return {
    destination: base.destination,
    presentation: base.presentation,
    fallbacks,
  };
}

// ---------------------------------------------------------------------------
// LLM disambiguation (Option C — only fires when rule-based is uncertain)
// ---------------------------------------------------------------------------

const LLM_SYSTEM_MESSAGE =
  'You are an intent classifier for Squadboard. Given a user prompt, decide ' +
  'which of these 6 kinds of artifact they want to create: project, issue, ' +
  'team, agent, skill, tool. Return JSON only — no prose, no fences.';

function buildLlmPrompt(prompt: string, ctx: ConjureContext | null | undefined): string {
  const project = ctx?.currentProjectName
    ? `User is in project: "${ctx.currentProjectName}".`
    : 'User is not currently in a project.';
  return `${project}

USER PROMPT:
"""
${prompt.trim()}
"""

Choose ONE of: project | issue | team | agent | skill | tool

Definitions:
- project   = a new app / system / codebase / MVP to build
- issue     = a bug, fix, or work item to track on the kanban board
- team      = hiring / assembling a multi-agent cast
- agent     = a single AI agent / role / persona
- skill     = a reusable instruction / pattern / how-to / playbook
- tool      = a callable function, script, or MCP server

Return EXACTLY this JSON shape:
{
  "intent": "<one of the 6>",
  "confidence": <number 0..1>,
  "rationale": "<one short sentence>"
}`;
}

interface LlmResult {
  intent: ConjureIntent;
  confidence: number;
  rationale: string;
}

async function classifyWithLlm(
  prompt: string,
  ctx: ConjureContext | null | undefined,
): Promise<LlmResult | null> {
  try {
    const { raw } = await runFormulator({
      prompt: buildLlmPrompt(prompt, ctx),
      projectId: ctx?.currentProjectId ?? null,
      systemMessage: LLM_SYSTEM_MESSAGE,
    });
    const parsed = extractJsonObject(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    const intent = obj['intent'];
    if (typeof intent !== 'string' || !ALL_INTENTS.includes(intent as ConjureIntent)) {
      return null;
    }
    const conf = typeof obj['confidence'] === 'number' ? Math.min(1, Math.max(0, obj['confidence'])) : 0.6;
    const rationale = typeof obj['rationale'] === 'string' ? obj['rationale'].trim() : 'Classified by LLM.';
    return { intent: intent as ConjureIntent, confidence: conf, rationale };
  } catch (err) {
    console.warn('[conjure] LLM disambiguation failed, falling back to rule-based:', (err as Error).message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export async function classifyAndDraft(req: ConjureRequest): Promise<ConjureResponse> {
  const prompt = (req.prompt ?? '').trim();
  if (!prompt) {
    throw Object.assign(new Error('prompt is required'), { status: 400 });
  }
  if (prompt.length > 10_000) {
    throw Object.assign(new Error('prompt exceeds 10,000 characters'), { status: 413 });
  }

  const useLlm = req.useLlm !== false;
  const scores = scorePromptByRules(prompt, req.hint ?? null);
  const top = scores[0]!;
  const ruleConfidence = rawScoreToConfidence(top.rawScore);

  const allZero = scores.every((s) => s.rawScore === 0);
  const ruleIntent: ConjureIntent = allZero ? AMBIGUOUS_DEFAULT : top.intent;

  // Fast path: rule-based is confident enough — return immediately.
  if (ruleConfidence >= CONFIDENCE_THRESHOLD) {
    const draft = DRAFT_BUILDERS[ruleIntent](prompt);
    return {
      intent: ruleIntent,
      confidence: ruleConfidence,
      draft,
      routing: buildRouting(ruleIntent, scores),
      rationale: `Rule-based match (score=${top.rawScore.toFixed(1)}, ${top.matched.length} signal${top.matched.length === 1 ? '' : 's'} hit).`,
      strategy: 'rule-based',
    };
  }

  // Slow path: ambiguous → ask the LLM. Wrapped: missing SDK / model never
  // breaks the surface — we degrade to the best rule-based candidate.
  if (useLlm) {
    const llm = await classifyWithLlm(prompt, req.context ?? null);
    if (llm) {
      const draft = DRAFT_BUILDERS[llm.intent](prompt);
      return {
        intent: llm.intent,
        confidence: llm.confidence,
        draft,
        routing: buildRouting(llm.intent, scores),
        rationale: llm.rationale,
        strategy: 'llm',
      };
    }
  }

  // Final fallback: best rule guess (or AMBIGUOUS_DEFAULT) with a low
  // confidence so the client UI knows to surface the fallback chips.
  const draft = DRAFT_BUILDERS[ruleIntent](prompt);
  return {
    intent: ruleIntent,
    confidence: allZero ? 0.2 : ruleConfidence,
    draft,
    routing: buildRouting(ruleIntent, scores),
    rationale: allZero
      ? `Prompt was ambiguous — defaulted to "${AMBIGUOUS_DEFAULT}". User can override via fallbacks.`
      : `Rule-based best guess (low confidence, ${top.matched.length} signal${top.matched.length === 1 ? '' : 's'} hit).`,
    strategy: 'rule-based',
  };
}

// ---------------------------------------------------------------------------
// Test-only exports — let unit tests reach the rule scorer without spinning
// up the SDK. Not part of the documented API.
// ---------------------------------------------------------------------------

export const __test__ = {
  scorePromptByRules,
  rawScoreToConfidence,
  buildRouting,
  DRAFT_BUILDERS,
  CONFIDENCE_THRESHOLD,
  AMBIGUOUS_DEFAULT,
};

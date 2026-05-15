/**
 * services/hire-formulator.ts — AI-formulated agent + team drafts.
 *
 * Mirrors the Formulate UX from inbox/skills/tools but for the hire flows.
 * The user pastes a brief prose description ("I need a frontend dev who
 * knows React and TypeScript") and the model returns a structured form
 * payload the user can review and accept.
 *
 *   formulateAgentDraft(projectId, draft)   — fills HireAgentModal step 1
 *   formulateTeamDraft(projectId, draft)    — fills HireTeamModal configure step
 *
 * Neither call persists anything. The user always confirms before the
 * existing POST /agents (or POST /agents/team/propose) endpoint runs.
 */

import {
  extractJsonObject,
  runFormulator,
  type ResolveModelResult,
} from './formulator.js';
import { listUniverses } from './casting-engine.js';

// ---------------------------------------------------------------------------
// Agent formulator
// ---------------------------------------------------------------------------

const AVAILABLE_MODELS = ['auto', 'claude-sonnet-4.6', 'claude-haiku-4.5', 'claude-opus-4.6'];
const KEBAB_RE = /^[a-z][a-z0-9-]*$/;

export interface FormulatedAgentDraft {
  name: string;
  role: string;
  expertise: string[];
  model: string;
}

export interface FormulateAgentResult {
  agent: FormulatedAgentDraft;
  modelUsed: ResolveModelResult;
}

function buildAgentPrompt(draft: string, existingNames: string[]): string {
  const existing = existingNames.length
    ? existingNames.slice(0, 50).map((n) => `- ${n}`).join('\n')
    : '(no existing agents yet)';

  return [
    "You are an agent formulator for an agent-driven kanban board. The user described an AI teammate they want to hire — turn that description into a clean, structured agent draft.",
    '',
    'Existing agent names in this project (avoid collisions, never reuse):',
    existing,
    '',
    'Available model identifiers:',
    AVAILABLE_MODELS.map((m) => `- ${m}`).join('\n'),
    '',
    "User's draft:",
    '"""',
    draft,
    '"""',
    '',
    'Respond ONLY with a JSON object (no prose, no markdown fence) matching:',
    '{',
    '  "name": string,        // kebab-case, ≤30 chars, unique vs existing names',
    '  "role": string,        // 1-3 word job title (e.g. "Frontend Developer", "Backend Engineer")',
    '  "expertise": string[], // 2-6 short tags (e.g. ["React", "TypeScript", "Jest"])',
    '  "model": string        // one of the available model identifiers above',
    '}',
    '',
    'Guidelines:',
    '- name: derive from role + specialty (e.g. "react-frontend", "auth-backend"). Lowercase, hyphen-separated.',
    '- role: human-friendly title in title case.',
    '- expertise: concrete technologies/frameworks the agent should know.',
    '- model: prefer "auto" unless the draft clearly asks for a specific tier (sonnet for code, haiku for cheap, opus for hard).',
  ].join('\n');
}

function normalizeAgentDraft(parsed: unknown, existingNames: Set<string>): FormulatedAgentDraft {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('LLM payload was not a JSON object');
  }
  const p = parsed as Record<string, unknown>;

  let name = typeof p.name === 'string' ? p.name.trim().toLowerCase() : '';
  name = name.replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!name || !KEBAB_RE.test(name)) throw new Error('LLM produced an invalid agent name');
  if (existingNames.has(name)) {
    let n = 2;
    while (existingNames.has(`${name}-${n}`)) n++;
    name = `${name}-${n}`;
  }

  const role = typeof p.role === 'string' ? p.role.trim() : '';
  if (!role) throw new Error('LLM payload missing `role`');

  const expertiseRaw = Array.isArray(p.expertise) ? p.expertise : [];
  const expertise = expertiseRaw
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);

  let model = typeof p.model === 'string' ? p.model.trim() : 'auto';
  if (!AVAILABLE_MODELS.includes(model)) model = 'auto';

  return {
    name: name.slice(0, 30),
    role: role.slice(0, 60),
    expertise,
    model,
  };
}

export async function formulateAgentDraft(
  projectId: string,
  draft: string,
  existingAgentNames: string[],
): Promise<FormulateAgentResult> {
  const trimmed = (draft ?? '').trim();
  if (!trimmed) {
    throw Object.assign(new Error('draft is required'), { status: 400 });
  }

  const prompt = buildAgentPrompt(trimmed, existingAgentNames);
  const { raw, modelUsed } = await runFormulator({ prompt, projectId });
  console.log(
    `[agents] formulating draft (${trimmed.length} chars) with model=${modelUsed.model} (via ${modelUsed.via})`,
  );

  const parsed = extractJsonObject(raw);
  const agent = normalizeAgentDraft(parsed, new Set(existingAgentNames));
  return { agent, modelUsed };
}

// ---------------------------------------------------------------------------
// Team formulator — fills the HireTeamModal configure form (universe,
// teamSize, requiredRoles) from a prose description. The actual cast still
// runs through the existing /agents/team/propose endpoint.
// ---------------------------------------------------------------------------

const VALID_ROLES = [
  // SDK base roles
  'lead',
  'developer',
  'tester',
  'reviewer',
  'devops',
  'security',
  'designer',
  'prompt-engineer',
  'scribe',
  // Squadboard-extended non-tech roles (Wave 10 D1)
  'pm',
  'designer-nontech',
  'founder',
  'sales',
  'marketing',
  'customer-success',
  'research',
] as const;
type ValidRole = (typeof VALID_ROLES)[number];

export interface FormulatedTeamDraft {
  universe: string;
  teamSize: number;
  requiredRoles: ValidRole[];
  rationale: string;
}

export interface FormulateTeamResult {
  team: FormulatedTeamDraft;
  modelUsed: ResolveModelResult;
}

function buildTeamPrompt(draft: string, universes: { id: string; label: string; characterCount: number }[]): string {
  const universeList = universes.map((u) => `- ${u.id} (${u.label}, ${u.characterCount} characters)`).join('\n');

  return [
    "You are a team formulator for an agent-driven kanban board. The user described the team they want to hire — pick a fictional universe to draw character names from, suggest a team size, and pick the required roles.",
    '',
    'Available universes (id — label):',
    universeList,
    '',
    'Available roles:',
    [
      '- Tech (SDK): lead, developer, tester, reviewer, devops, security, designer (frontend), prompt-engineer, scribe',
      '- Non-tech: pm, designer-nontech (brand/UX), founder, sales, marketing, customer-success, research',
    ].join('\n'),
    '',
    "User's draft:",
    '"""',
    draft,
    '"""',
    '',
    'Respond ONLY with a JSON object (no prose, no markdown fence) matching:',
    '{',
    '  "universe": string,         // one of the universe ids above',
    '  "teamSize": number,         // integer 3-9',
    '  "requiredRoles": string[],  // 1-5 roles from the list above',
    '  "rationale": string         // ≤2 sentences explaining your choices',
    '}',
    '',
    'Guidelines:',
    '- universe: pick one whose tone matches the draft. Available ids: "usual-suspects" (heist crew, generic default), "oceans-eleven" (slick ensemble), "the-office" (workplace comedy, office/business context), "seinfeld" (observational comedy, NYC professional), "the-simpsons" (satirical everyman, suburban or civic context), "parks-and-rec" (optimistic civic/government, idealistic team context). Default to "usual-suspects" if the draft is generic.',
    '- teamSize: prefer 4-6 for a typical product team; 3 for a tight crew; 7-9 for ambitious efforts. Never less than 3.',
    '- requiredRoles: always include "lead". Add roles based on the draft (e.g. mention of UI → designer, mention of testing → tester, mention of infra → devops).',
    '- Do NOT include "scribe" unless the draft explicitly mentions documentation or memory.',
  ].join('\n');
}

function normalizeTeamDraft(parsed: unknown): FormulatedTeamDraft {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('LLM payload was not a JSON object');
  }
  const p = parsed as Record<string, unknown>;

  const universe = typeof p.universe === 'string' && p.universe.trim() ? p.universe.trim() : 'usual-suspects';

  let teamSize = typeof p.teamSize === 'number' ? Math.round(p.teamSize) : 5;
  if (!Number.isFinite(teamSize)) teamSize = 5;
  if (teamSize < 3) teamSize = 3;
  if (teamSize > 9) teamSize = 9;

  const rolesRaw = Array.isArray(p.requiredRoles) ? p.requiredRoles : [];
  const requiredRoles = Array.from(
    new Set(
      rolesRaw
        .filter((x): x is string => typeof x === 'string')
        .map((s) => s.trim() as ValidRole)
        .filter((r) => (VALID_ROLES as readonly string[]).includes(r)),
    ),
  ) as ValidRole[];
  // Always ensure 'lead' is present.
  if (!requiredRoles.includes('lead')) requiredRoles.unshift('lead');

  const rationale = typeof p.rationale === 'string' ? p.rationale.trim() : '';

  return { universe, teamSize, requiredRoles, rationale: rationale.slice(0, 280) };
}

export async function formulateTeamDraft(
  projectId: string,
  draft: string,
): Promise<FormulateTeamResult> {
  const trimmed = (draft ?? '').trim();
  if (!trimmed) {
    throw Object.assign(new Error('draft is required'), { status: 400 });
  }

  const universes = listUniverses();
  const prompt = buildTeamPrompt(trimmed, universes);
  const { raw, modelUsed } = await runFormulator({ prompt, projectId });
  console.log(
    `[team] formulating draft (${trimmed.length} chars) with model=${modelUsed.model} (via ${modelUsed.via})`,
  );

  const parsed = extractJsonObject(raw);
  const team = normalizeTeamDraft(parsed);

  // Coerce the universe to a valid id, falling back to 'usual-suspects' if the
  // model picked one that doesn't exist (e.g. an internal name).
  const validIds = new Set<string>(universes.map((u) => u.id as string));
  if (!validIds.has(team.universe)) {
    team.universe = validIds.has('usual-suspects')
      ? 'usual-suspects'
      : (universes[0]?.id as string | undefined) ?? team.universe;
  }

  return { team, modelUsed };
}

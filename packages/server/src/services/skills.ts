/**
 * services/skills.ts — Phase 13
 *
 * CRUD + per-agent assignment for the project-scoped Skills registry.
 * A "skill" is a prompt-augmentation snippet (`promptAddendum`) that gets
 * prepended to an agent's effective system prompt when the skill is
 * assigned. Skills can be cloned from the bundled curated library
 * (`data/curated-skills.json`), authored from scratch, or AI-formulated
 * from a brief draft via `formulateSkill` (see the bottom of this file).
 */

import { and, eq, inArray } from 'drizzle-orm';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, schema } from '../db/index.js';
import {
  extractJsonObject,
  runFormulator,
  type ResolveModelResult,
} from './formulator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CURATED_PATH = path.resolve(__dirname, '..', 'data', 'curated-skills.json');

export interface CuratedSkill {
  key: string;
  name: string;
  description: string;
  category: string;
  promptAddendum: string;
}

let _curatedCache: CuratedSkill[] | null = null;

export async function loadCuratedSkills(): Promise<CuratedSkill[]> {
  if (_curatedCache) return _curatedCache;
  const raw = await fs.readFile(CURATED_PATH, 'utf8');
  const parsed = JSON.parse(raw) as CuratedSkill[];
  _curatedCache = parsed;
  return parsed;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export interface CreateSkillInput {
  key: string;
  name: string;
  description?: string | null;
  category?: string | null;
  promptAddendum: string;
  curatedKey?: string | null;
}

export interface UpdateSkillInput {
  key?: string;
  name?: string;
  description?: string | null;
  category?: string | null;
  promptAddendum?: string;
}

export async function listSkills(projectId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.skills)
    .where(eq(schema.skills.projectId, projectId))
    .orderBy(schema.skills.category, schema.skills.name);
}

export async function getSkill(projectId: string, skillId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.skills)
    .where(and(eq(schema.skills.projectId, projectId), eq(schema.skills.id, skillId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createSkill(projectId: string, input: CreateSkillInput) {
  const db = getDb();
  const [row] = await db
    .insert(schema.skills)
    .values({
      projectId,
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      category: input.category ?? null,
      promptAddendum: input.promptAddendum,
      curatedKey: input.curatedKey ?? null,
    })
    .returning();
  return row;
}

export async function updateSkill(projectId: string, skillId: string, input: UpdateSkillInput) {
  const db = getDb();
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.key !== undefined) patch.key = input.key;
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.category !== undefined) patch.category = input.category;
  if (input.promptAddendum !== undefined) patch.promptAddendum = input.promptAddendum;

  const [row] = await db
    .update(schema.skills)
    .set(patch)
    .where(and(eq(schema.skills.projectId, projectId), eq(schema.skills.id, skillId)))
    .returning();
  return row ?? null;
}

export async function deleteSkill(projectId: string, skillId: string): Promise<boolean> {
  const db = getDb();
  const result = await db
    .delete(schema.skills)
    .where(and(eq(schema.skills.projectId, projectId), eq(schema.skills.id, skillId)))
    .returning({ id: schema.skills.id });
  return result.length > 0;
}

/**
 * Clone a curated skill into the project's skills registry. Idempotent:
 * if a skill with the same `key` already exists in the project, returns
 * the existing row instead of creating a duplicate.
 */
export async function cloneCuratedSkill(projectId: string, curatedKey: string) {
  const curated = await loadCuratedSkills();
  const entry = curated.find((c) => c.key === curatedKey);
  if (!entry) {
    const err = new Error(`Curated skill not found: ${curatedKey}`);
    (err as Error & { status?: number }).status = 404;
    throw err;
  }

  const db = getDb();
  const existing = await db
    .select()
    .from(schema.skills)
    .where(and(eq(schema.skills.projectId, projectId), eq(schema.skills.key, entry.key)))
    .limit(1);
  if (existing[0]) return existing[0];

  return createSkill(projectId, {
    key: entry.key,
    name: entry.name,
    description: entry.description,
    category: entry.category,
    promptAddendum: entry.promptAddendum,
    curatedKey: entry.key,
  });
}

// ---------------------------------------------------------------------------
// Agent assignment
// ---------------------------------------------------------------------------

export async function listAgentSkills(projectId: string, agentId: string) {
  const db = getDb();
  return db
    .select({
      id: schema.skills.id,
      projectId: schema.skills.projectId,
      key: schema.skills.key,
      name: schema.skills.name,
      description: schema.skills.description,
      category: schema.skills.category,
      promptAddendum: schema.skills.promptAddendum,
      curatedKey: schema.skills.curatedKey,
      createdAt: schema.skills.createdAt,
      updatedAt: schema.skills.updatedAt,
      assignedAt: schema.agentSkills.assignedAt,
    })
    .from(schema.agentSkills)
    .innerJoin(schema.skills, eq(schema.agentSkills.skillId, schema.skills.id))
    .where(and(eq(schema.agentSkills.agentId, agentId), eq(schema.skills.projectId, projectId)))
    .orderBy(schema.skills.category, schema.skills.name);
}

export async function assignSkillsToAgent(
  projectId: string,
  agentId: string,
  skillIds: string[],
): Promise<{ assigned: string[]; skipped: string[] }> {
  if (skillIds.length === 0) return { assigned: [], skipped: [] };
  const db = getDb();

  // Validate that every skillId actually belongs to this project.
  const valid = await db
    .select({ id: schema.skills.id })
    .from(schema.skills)
    .where(and(eq(schema.skills.projectId, projectId), inArray(schema.skills.id, skillIds)));
  const validIds = new Set(valid.map((r) => r.id));
  const skipped = skillIds.filter((id) => !validIds.has(id));

  if (validIds.size === 0) return { assigned: [], skipped };

  const inserted = await db
    .insert(schema.agentSkills)
    .values(Array.from(validIds).map((skillId) => ({ agentId, skillId })))
    .onConflictDoNothing()
    .returning({ skillId: schema.agentSkills.skillId });

  return { assigned: inserted.map((r) => r.skillId), skipped };
}

export async function unassignSkillFromAgent(
  agentId: string,
  skillId: string,
): Promise<boolean> {
  const db = getDb();
  const result = await db
    .delete(schema.agentSkills)
    .where(and(eq(schema.agentSkills.agentId, agentId), eq(schema.agentSkills.skillId, skillId)))
    .returning({ skillId: schema.agentSkills.skillId });
  return result.length > 0;
}

// ---------------------------------------------------------------------------
// AI Formulator — turn a brief draft into a structured skill draft the user
// can review + accept. Returns a CreateSkillInput-shaped payload (NOT
// persisted) plus the model that produced it.
// ---------------------------------------------------------------------------

export interface FormulatedSkillDraft {
  key: string;
  name: string;
  description: string;
  category: string;
  promptAddendum: string;
}

export interface FormulateSkillResult {
  skill: FormulatedSkillDraft;
  modelUsed: ResolveModelResult;
}

const KEBAB_RE = /^[a-z][a-z0-9-]*$/;

function buildSkillPrompt(draft: string, existingKeys: string[]): string {
  const existing = existingKeys.length
    ? existingKeys.slice(0, 50).map((k) => `- ${k}`).join('\n')
    : '(no existing skills yet)';

  return [
    "You are a skill formulator for an agent-driven kanban board. A 'skill' is a reusable prompt-augmentation snippet that specialises an AI agent. The user gave a brief, raw idea — your job is to turn it into a clean, well-structured skill draft.",
    '',
    'Existing skill keys in this project (avoid collisions, never reuse):',
    existing,
    '',
    "User's draft:",
    '"""',
    draft,
    '"""',
    '',
    'Respond ONLY with a JSON object (no prose, no markdown fence) matching:',
    '{',
    '  "key": string,             // kebab-case, ≤40 chars, unique vs the existing keys above',
    '  "name": string,            // human-readable, ≤60 chars',
    '  "description": string,     // 1 sentence, ≤140 chars',
    '  "category": string,        // 1-2 word grouping (e.g. "review", "git", "writing")',
    '  "promptAddendum": string   // markdown — the actual prompt fragment that will be injected',
    '}',
    '',
    'Guidelines for promptAddendum:',
    '- 4-12 short bullet points or 1-3 short paragraphs. Imperative voice ("Use X.", "Avoid Y.").',
    '- Concrete, actionable rules — not abstract goals.',
    '- Mention the trigger ("When the user asks for X…") if context-specific.',
  ].join('\n');
}

function normalizeSkillDraft(parsed: unknown, existingKeys: Set<string>): FormulatedSkillDraft {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('LLM payload was not a JSON object');
  }
  const p = parsed as Record<string, unknown>;

  let key = typeof p.key === 'string' ? p.key.trim().toLowerCase() : '';
  // Coerce to kebab-case if the model returned something close.
  key = key.replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!key || !KEBAB_RE.test(key)) throw new Error('LLM produced an invalid skill key');
  // De-duplicate by suffixing -2, -3, … if needed.
  if (existingKeys.has(key)) {
    let n = 2;
    while (existingKeys.has(`${key}-${n}`)) n++;
    key = `${key}-${n}`;
  }

  const name = typeof p.name === 'string' ? p.name.trim() : '';
  if (!name) throw new Error('LLM payload missing `name`');

  const description = typeof p.description === 'string' ? p.description.trim() : '';
  const category = typeof p.category === 'string' ? p.category.trim().toLowerCase() : '';
  const promptAddendum = typeof p.promptAddendum === 'string' ? p.promptAddendum.trim() : '';
  if (!promptAddendum) throw new Error('LLM payload missing `promptAddendum`');

  return {
    key: key.slice(0, 40),
    name: name.slice(0, 60),
    description: description.slice(0, 140),
    category: category.slice(0, 30),
    promptAddendum,
  };
}

export async function formulateSkill(
  projectId: string,
  draft: string,
): Promise<FormulateSkillResult> {
  const trimmed = (draft ?? '').trim();
  if (!trimmed) {
    throw Object.assign(new Error('draft is required'), { status: 400 });
  }

  const existing = await listSkills(projectId);
  const existingKeys = existing.map((s) => s.key);

  const prompt = buildSkillPrompt(trimmed, existingKeys);
  const { raw, modelUsed } = await runFormulator({ prompt, projectId });
  console.log(
    `[skills] formulating draft (${trimmed.length} chars) with model=${modelUsed.model} (via ${modelUsed.via})`,
  );

  const parsed = extractJsonObject(raw);
  const skill = normalizeSkillDraft(parsed, new Set(existingKeys));
  return { skill, modelUsed };
}

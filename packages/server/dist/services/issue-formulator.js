/**
 * services/issue-formulator.ts — AI-formulated issue drafts.
 *
 * Mirrors the Formulate UX from inbox/skills/tools/agents/team but for issues
 * created directly on the board (not via the inbox capture flow).
 *
 * The user pastes a brief prose description ("we need to add OAuth login with
 * Google and GitHub") and the model returns a structured issue draft (title,
 * body, suggested column, suggested labels) the user can review, tweak, and
 * accept. Nothing is persisted by this call — `POST /issues` still creates
 * the row when the user clicks Create.
 */
import { extractJsonObject, runFormulator, } from './formulator.js';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
const VALID_COLUMNS = ['backlog', 'todo', 'in_progress', 'in_review', 'done'];
// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------
function buildIssuePrompt(draft, existingLabels) {
    const labelList = existingLabels.length
        ? existingLabels.slice(0, 30).map((l) => `- ${l}`).join('\n')
        : '(no labels exist yet — only suggest names if absolutely necessary)';
    return [
        'You are an issue formulator for an agent-driven kanban board. The user described a piece of work — turn it into a clean, structured issue draft the team can act on.',
        '',
        'Existing label vocabulary (prefer reusing these; only invent new ones if no existing label fits):',
        labelList,
        '',
        'Available columns:',
        VALID_COLUMNS.map((c) => `- ${c}`).join('\n'),
        '',
        "User's draft:",
        '"""',
        draft,
        '"""',
        '',
        'Respond ONLY with a JSON object (no prose, no markdown fence) matching:',
        '{',
        '  "title": string,             // ≤120 chars, imperative ("Add OAuth login")',
        '  "body": string,              // Markdown. Brief problem statement + acceptance criteria as bullets',
        '  "suggestedColumn": string,   // one of the columns above (default "todo" if uncertain)',
        '  "suggestedLabels": string[], // 0-4 label names from the existing vocabulary; reuse exact spelling',
        '  "rationale": string          // ≤1 sentence: why these choices',
        '}',
        '',
        'Guidelines:',
        '- title: imperative voice, no trailing period. Strip filler ("we need to", "please").',
        '- body: 2-4 sentence problem statement, then a short ## Acceptance Criteria bullet list. Keep it tight.',
        '- suggestedColumn: "backlog" if exploratory; "todo" if ready to work; "in_progress" only if the draft says it\'s already started.',
        '- suggestedLabels: prefer EXISTING labels by exact name. Examples that look like an existing label: bug, feature, docs, ui, backend.',
        '- Never include the user\'s raw draft verbatim in the body — restate cleanly.',
    ].join('\n');
}
// ---------------------------------------------------------------------------
// Normalize / validate
// ---------------------------------------------------------------------------
function normalizeIssueDraft(parsed, existingLabelSet) {
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('LLM payload was not a JSON object');
    }
    const p = parsed;
    const title = typeof p.title === 'string' ? p.title.trim() : '';
    if (!title)
        throw new Error('LLM payload missing `title`');
    const body = typeof p.body === 'string' ? p.body.trim() : '';
    let suggestedColumn = typeof p.suggestedColumn === 'string'
        ? p.suggestedColumn.trim()
        : 'todo';
    if (!VALID_COLUMNS.includes(suggestedColumn))
        suggestedColumn = 'todo';
    const labelsRaw = Array.isArray(p.suggestedLabels) ? p.suggestedLabels : [];
    const suggestedLabels = labelsRaw
        .filter((x) => typeof x === 'string')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 4);
    // Prefer existing labels; case-insensitive match keeps casing consistent.
    const existingByLower = new Map();
    for (const name of existingLabelSet)
        existingByLower.set(name.toLowerCase(), name);
    const normalizedLabels = suggestedLabels.map((l) => existingByLower.get(l.toLowerCase()) ?? l);
    const rationale = typeof p.rationale === 'string' ? p.rationale.trim().slice(0, 240) : '';
    return {
        title: title.slice(0, 200),
        body,
        suggestedColumn,
        suggestedLabels: normalizedLabels,
        rationale,
    };
}
// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------
export async function formulateIssueDraft(projectId, draft) {
    const trimmed = (draft ?? '').trim();
    if (!trimmed) {
        throw Object.assign(new Error('draft is required'), { status: 400 });
    }
    const db = getDb();
    const existing = await db
        .select({ name: schema.labels.name })
        .from(schema.labels)
        .where(eq(schema.labels.projectId, projectId));
    const existingLabels = existing.map((r) => r.name);
    const prompt = buildIssuePrompt(trimmed, existingLabels);
    const { raw, modelUsed } = await runFormulator({ prompt, projectId });
    console.log(`[issues] formulating draft (${trimmed.length} chars) with model=${modelUsed.model} (via ${modelUsed.via})`);
    const parsed = extractJsonObject(raw);
    const issue = normalizeIssueDraft(parsed, new Set(existingLabels));
    return { issue, modelUsed };
}
//# sourceMappingURL=issue-formulator.js.map
/**
 * services/ceremony-translator.ts — Phase 11 / Wave 14 (q8)
 *
 * Translates a markdown narrative ceremony into an executable ceremony YAML
 * via a one-shot SquadClient (ACP) session.
 *
 * The LLM is instructed to respond with a strict JSON envelope:
 *
 *   { yamlContent, triggerKind, triggerConfig, warnings, rationale }
 *
 * After receiving a response we:
 *   1. Parse the JSON tolerantly (strip ```json fences, locate first '{' …
 *      last '}' if necessary).
 *   2. Validate the YAML against the existing `validateWorkflowYaml` so
 *      callers get the same error surface as the manual editor.
 *   3. Cap warnings to 10, trim the rationale to ≤500 chars.
 *
 * Throttle: max 3 translations per ceremony per 60s window. The throttle is
 * in-process; restart resets it.
 *
 * Wave 14 (q8) — Built-in ceremony registry:
 *   BUILT_IN_CEREMONIES defines first-class ceremonies that are always
 *   available regardless of project YAML. The 'scribe-close-out' ceremony is
 *   the convergence point for the CLI coordinator, the autonomous daemon (q7),
 *   and the manual End Wave button (q9). All three paths call the same SDK
 *   function: squadboard.scribe.closeOut() from @sabbour/squadboard-sdk.
 */
import { validateWorkflowYaml } from './workflow-parser.js';
// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
export class TranslatorError extends Error {
    /** True when the caller can productively retry (LLM unreachable, parse glitch). */
    retryable;
    constructor(message, retryable = true) {
        super(message);
        this.name = 'TranslatorError';
        this.retryable = retryable;
    }
}
export class TranslatorThrottledError extends TranslatorError {
    status = 429;
    constructor(message = 'translator throttled') {
        super(message, false);
        this.name = 'TranslatorThrottledError';
    }
}
/**
 * Registry of first-class ceremonies. Consumers call `getBuiltInCeremony(id)`
 * to look up a ceremony and `invokeBuiltInCeremony(id, ctx)` to run it.
 *
 * To add a new ceremony: push an entry to this array. The daemon, the button,
 * and the coordinator all discover ceremonies through this registry.
 */
const BUILT_IN_CEREMONIES = [
    {
        id: 'scribe-close-out',
        name: 'End-of-Wave Close-Out',
        description: 'Scribe merges inbox decisions, writes orchestration logs, archives decisions.md if oversized, commits .squad/ changes.',
        facilitator: 'scribe',
        participants: ['scribe'],
        triggers: {
            manual: true, // "End Wave" button (q9)
            scheduled: true, // daemon (q7) fires on cron cadence
            coordinator: true, // CLI coordinator post-work spawn (existing behaviour)
        },
        invoke: async (ctx) => {
            // Lazy-import so the SDK is only loaded when the ceremony runs,
            // keeping server startup cost zero when Scribe isn't needed.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const sdk = await import('@sabbour/squadboard-sdk');
            return sdk.squadboard.scribe.closeOut({
                projectId: ctx.projectId,
                spawnManifest: ctx.spawnManifest,
                teamRoot: ctx.teamRoot,
                ...(ctx.extra ?? {}),
            });
        },
    },
];
/**
 * Look up a built-in ceremony by id. Returns undefined if not registered.
 */
export function getBuiltInCeremony(id) {
    return BUILT_IN_CEREMONIES.find((c) => c.id === id);
}
/**
 * List all registered built-in ceremonies.
 * Used by the ceremony picker UI and the daemon's discovery pass.
 */
export function listBuiltInCeremonies() {
    return BUILT_IN_CEREMONIES;
}
/**
 * Invoke a built-in ceremony by id. Throws if the ceremony is not found.
 */
export async function invokeBuiltInCeremony(id, ctx) {
    const ceremony = getBuiltInCeremony(id);
    if (!ceremony) {
        throw new TranslatorError(`no built-in ceremony registered with id '${id}'`, false);
    }
    return ceremony.invoke(ctx);
}
// ---------------------------------------------------------------------------
// Throttle (in-memory, per ceremony)
// ---------------------------------------------------------------------------
/** Window length: 60s. */
const THROTTLE_WINDOW_MS = 60_000;
/** Max translations per ceremony per window. */
const THROTTLE_MAX = 3;
const translateAttempts = new Map();
/** Test-only: reset throttle state between unit runs. */
export function _resetTranslatorThrottleForTests() {
    translateAttempts.clear();
}
function consumeThrottleSlot(ceremonyKey) {
    const now = Date.now();
    const entry = translateAttempts.get(ceremonyKey) ?? { timestamps: [] };
    // Drop expired timestamps (outside the window).
    while (entry.timestamps.length && now - entry.timestamps[0] > THROTTLE_WINDOW_MS) {
        entry.timestamps.shift();
    }
    if (entry.timestamps.length >= THROTTLE_MAX) {
        const oldest = entry.timestamps[0];
        const waitSec = Math.max(1, Math.ceil((THROTTLE_WINDOW_MS - (now - oldest)) / 1000));
        throw new TranslatorThrottledError(`translator throttled — try again in ${waitSec}s (max ${THROTTLE_MAX} per ${THROTTLE_WINDOW_MS / 1000}s)`);
    }
    entry.timestamps.push(now);
    translateAttempts.set(ceremonyKey, entry);
}
// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------
const VALID_TRIGGER_KINDS = new Set([
    'on_issue_entry',
    'on_schedule',
    'on_event',
    'manual',
]);
function renderAvailableAgents(agents) {
    if (!agents || agents.length === 0) {
        return '(no specific agents — use "@role" mentions only)';
    }
    return agents.map((a) => `- ${a.name} (${a.role})`).join('\n');
}
function buildPrompt(input) {
    const availableAgents = renderAvailableAgents(input.availableAgents);
    return [
        'You are a workflow translator for an agent-driven kanban board. Given a narrative ceremony described in markdown, produce an executable ceremony definition in our YAML schema.',
        '',
        'Available agents on this project (use only these names; do not invent):',
        availableAgents,
        '',
        'Our YAML schema supports these step types:',
        "  - agent_run: { agent: <name|template>, prompt: <string>, timeout?: <duration> }",
        "  - approve: { approvers: [<agentName|@role>], request_changes_policy: 'first'|'majority'|'all', quorum?: {n,of}, timeout?, timeoutAction?: 'auto_approve'|'auto_reject'|'escalate'|'notify' }",
        "  - fan_out: { split_by: 'agents'|'labels'|'count', agents?: [...], count?: N, merge_strategy: 'all'|'any'|'first', steps: [...] }",
        "  - handoff: { to: <agentName>, message?: <string> }",
        "  - route: { agent: <name|template>, prompt?: <string> }",
        '',
        'Trigger taxonomy:',
        "  - on_issue_entry: triggerConfig = { scope: 'project'|'board'|'task', columnSlug?, labelIds? }",
        '  - on_schedule:    triggerConfig = { cronExpr, timezone? }',
        "  - on_event:       triggerConfig = { eventType: 'review.requested'|'deliverable.created'|'comment.posted'|'session.completed'|'agent.hired' }",
        '  - manual:         triggerConfig = {}',
        '',
        `Ceremony name: ${input.ceremonyName}`,
        '',
        'The narrative ceremony (markdown):',
        '"""',
        input.narrativeMarkdown,
        '"""',
        '',
        'Respond ONLY with a JSON object (no prose, no markdown fence) matching:',
        '{',
        '  "yamlContent": string,                  // valid YAML matching our schema',
        '  "triggerKind": "on_issue_entry"|"on_schedule"|"on_event"|"manual",',
        '  "triggerConfig": object,',
        '  "warnings": string[],                   // empty array if none',
        '  "rationale": string                     // ≤3 sentences explaining choices',
        '}',
        '',
        'Constraints:',
        '- Use only agent names from the provided list. If the narrative names someone not on the list, add a warning and substitute "@role" or omit.',
        "- Default to 'manual' triggerKind if you cannot infer one from the markdown.",
        '- Keep the workflow as small as possible — prefer 2-4 steps over 8.',
        '- For each step, write a clear, action-oriented prompt — not a description.',
    ].join('\n');
}
// ---------------------------------------------------------------------------
// LLM invocation — mirrors services/inbox.ts callFormulator()
// ---------------------------------------------------------------------------
async function callTranslator(prompt) {
    const token = process.env.GITHUB_TOKEN ?? process.env.SQUADBOARD_GITHUB_TOKEN;
    const { SquadClient } = await import('@bradygaster/squad-sdk/client');
    const client = new SquadClient({
        ...(token ? { githubToken: token } : { useLoggedInUser: true }),
        cwd: process.cwd(),
    });
    await client.connect();
    try {
        const session = await client.createSession({
            systemMessage: {
                mode: 'replace',
                content: 'You are a precise JSON-only assistant. Return only the requested JSON object — no markdown fences, no prose.',
            },
            workingDirectory: process.cwd(),
            onPermissionRequest: () => ({ kind: 'approved' }),
        });
        const result = await client.sendAndWait(session, { prompt });
        return extractText(result);
    }
    finally {
        await client.disconnect().catch(() => { });
    }
}
function extractText(result) {
    if (typeof result === 'string')
        return result;
    if (result && typeof result === 'object') {
        const r = result;
        if (r['data'] && typeof r['data'] === 'object') {
            const data = r['data'];
            if (typeof data['content'] === 'string')
                return data['content'];
        }
        if (typeof r['content'] === 'string')
            return r['content'];
        if (typeof r['text'] === 'string')
            return r['text'];
        if (typeof r['message'] === 'string')
            return r['message'];
        if (r['message'] && typeof r['message']['content'] === 'string') {
            return r['message']['content'];
        }
    }
    return JSON.stringify(result ?? '');
}
// ---------------------------------------------------------------------------
// Tolerant JSON extraction
// ---------------------------------------------------------------------------
function extractJsonObject(raw) {
    const trimmed = raw.trim();
    try {
        return JSON.parse(trimmed);
    }
    catch {
        // Strip ```json … ``` fences (LLM ignored the no-fence instruction).
        const fenceMatch = trimmed.match(/```(?:json|yaml)?\s*([\s\S]*?)```/i);
        if (fenceMatch && fenceMatch[1]) {
            try {
                return JSON.parse(fenceMatch[1].trim());
            }
            catch {
                /* fall through */
            }
        }
        // Locate first { … last } and try that slice.
        const first = trimmed.indexOf('{');
        const last = trimmed.lastIndexOf('}');
        if (first !== -1 && last > first) {
            try {
                return JSON.parse(trimmed.slice(first, last + 1));
            }
            catch {
                /* fall through */
            }
        }
        throw new TranslatorError(`LLM output was not valid JSON: ${trimmed.slice(0, 200)}`, true);
    }
}
function normalisePayload(parsed) {
    if (!parsed || typeof parsed !== 'object') {
        throw new TranslatorError('LLM payload was not a JSON object', true);
    }
    const p = parsed;
    const yamlContent = typeof p.yamlContent === 'string' ? p.yamlContent : '';
    if (!yamlContent.trim()) {
        throw new TranslatorError('LLM payload missing `yamlContent`', true);
    }
    let triggerKind = 'manual';
    const warnings = [];
    const rawWarnings = Array.isArray(p.warnings) ? p.warnings : [];
    for (const w of rawWarnings) {
        if (typeof w === 'string' && w.trim().length > 0) {
            warnings.push(w.trim());
            if (warnings.length >= 10)
                break;
        }
    }
    if (typeof p.triggerKind === 'string' && VALID_TRIGGER_KINDS.has(p.triggerKind)) {
        triggerKind = p.triggerKind;
    }
    else {
        warnings.unshift("couldn't infer triggerKind, defaulted to manual");
    }
    let triggerConfig = {};
    if (p.triggerConfig && typeof p.triggerConfig === 'object' && !Array.isArray(p.triggerConfig)) {
        triggerConfig = p.triggerConfig;
    }
    const rationale = typeof p.rationale === 'string' && p.rationale.trim().length > 0
        ? p.rationale.trim().slice(0, 500)
        : '(no rationale provided)';
    return { yamlContent, triggerKind, triggerConfig, warnings, rationale };
}
// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------
/**
 * Translate a narrative markdown ceremony into an executable ceremony YAML.
 * Throws `TranslatorError` (with `.retryable`) on any failure.
 */
export async function translateNarrative(input) {
    if (!input.narrativeMarkdown || !input.narrativeMarkdown.trim()) {
        throw new TranslatorError('narrativeMarkdown is empty', false);
    }
    if (!input.ceremonyName || !input.ceremonyName.trim()) {
        throw new TranslatorError('ceremonyName is required', false);
    }
    // Throttle key: project + ceremony name. The same narrative can be retried
    // up to THROTTLE_MAX times per window.
    const key = `${input.projectId}:${input.ceremonyName.trim().toLowerCase()}`;
    consumeThrottleSlot(key);
    const prompt = buildPrompt(input);
    let raw;
    try {
        raw = await callTranslator(prompt);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new TranslatorError(`translator LLM call failed: ${msg}`, true);
    }
    const parsed = extractJsonObject(raw);
    const result = normalisePayload(parsed);
    // Validate the YAML through the same parser the manual editor uses so the
    // failure surface is identical.
    const { valid, errors } = validateWorkflowYaml(result.yamlContent);
    if (!valid) {
        throw new TranslatorError(`translated YAML failed validation: ${errors.join('; ')}`, true);
    }
    return result;
}
// ---------------------------------------------------------------------------
// Phase 16 — author-from-prose
// ---------------------------------------------------------------------------
function buildProseAuthorPrompt(input) {
    const availableAgents = renderAvailableAgents(input.availableAgents);
    const nameHint = input.ceremonyName?.trim() ?? '';
    return [
        'You are a workflow translator for an agent-driven kanban board. The user describes a ceremony in natural language; produce an executable ceremony definition in our YAML schema.',
        '',
        'Available agents on this project (use only these names; do not invent):',
        availableAgents,
        '',
        'CRITICAL: each step object MUST have a `type:` field. The valid values for `type` are: agent_run, approve, fan_out, handoff, route.',
        '',
        'Step schema (use the `type:` key exactly as shown):',
        '  - type: agent_run',
        '    agent: <agentName|@role>   # optional; omit to let routing decide',
        '    prompt: <string>',
        '    timeout: <duration>        # optional, e.g. "30m"',
        '  - type: approve',
        "    approvers: [<agentName|@role>]",
        "    request_changes_policy: first|majority|all",
        '    quorum: {n: <int>, of: <int>}   # optional',
        '    timeout: <duration>             # optional',
        "    timeoutAction: auto_approve|auto_reject|escalate|notify  # optional",
        '  - type: fan_out',
        "    split_by: agents|labels|count",
        '    agents: [<agentName>]   # when split_by=agents',
        '    count: <int>            # when split_by=count',
        "    merge_strategy: all|any|first",
        '    steps: [<step>, ...]',
        '  - type: handoff',
        '    to: <agentName>',
        '    message: <string>   # optional',
        '  - type: route',
        '    agent: <agentName|@role>   # optional',
        '    prompt: <string>           # optional',
        '',
        'Example valid yamlContent:',
        'name: Daily Standup',
        'steps:',
        '  - type: agent_run',
        '    agent: scribe',
        '    prompt: Post a standup thread to #standups.',
        '  - type: approve',
        '    approvers: [lead]',
        '    request_changes_policy: first',
        '    timeout: 2h',
        '',
        'There are no engine-level control primitives (no `if`, `switch`, `for_each`, expression DSL). Mid-flow content branching is achieved by an `agent_run` emitting `nextRoute` consumed by a downstream `route` step.',
        '',
        'Trigger taxonomy:',
        "  - on_issue_entry: triggerConfig = { scope: 'project'|'board'|'task', columnSlug?, labelIds? }",
        '  - on_schedule:    triggerConfig = { cronExpr, timezone? }',
        "  - on_event:       triggerConfig = { eventType: 'review.requested'|'deliverable.created'|'comment.posted'|'session.completed'|'agent.hired' }",
        '  - manual:         triggerConfig = {}',
        '',
        nameHint
            ? `Suggested ceremony name: ${nameHint}`
            : 'Choose a short ceremony name (≤ 40 chars). Title-Case is fine.',
        '',
        'User description (natural language):',
        '"""',
        input.prose,
        '"""',
        '',
        'Respond ONLY with a JSON object (no prose, no markdown fence) matching:',
        '{',
        '  "yamlContent": string,                  // valid YAML matching our schema; MUST include a top-level `name:` field',
        '  "triggerKind": "on_issue_entry"|"on_schedule"|"on_event"|"manual",',
        '  "triggerConfig": object,',
        '  "warnings": string[],                   // empty array if none',
        '  "rationale": string                     // ≤3 sentences explaining choices',
        '}',
        '',
        'Constraints:',
        '- Use only agent names from the provided list. If the description names someone not on the list, add a warning and substitute "@role" or omit.',
        "- Default to 'manual' triggerKind if you cannot infer one from the description.",
        '- Keep the workflow as small as possible — prefer 2-4 steps over 8.',
        '- For each step, write a clear, action-oriented prompt — not a description.',
    ].join('\n');
}
/**
 * Translate a free-form prose description into an executable ceremony YAML.
 * Used by the Phase 16 "Generate from prose" Prose tab.
 */
export async function translateProse(input) {
    if (!input.prose || !input.prose.trim()) {
        throw new TranslatorError('prose is empty', false);
    }
    // Throttle key: project + first 60 chars of prose (lower-cased).
    const proseSlug = input.prose.trim().toLowerCase().slice(0, 60).replace(/\s+/g, '-');
    const key = `${input.projectId}:prose:${proseSlug}`;
    consumeThrottleSlot(key);
    const prompt = buildProseAuthorPrompt(input);
    let raw;
    try {
        raw = await callTranslator(prompt);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new TranslatorError(`translator LLM call failed: ${msg}`, true);
    }
    const parsed = extractJsonObject(raw);
    const result = normalisePayload(parsed);
    const { valid, errors } = validateWorkflowYaml(result.yamlContent);
    if (!valid) {
        throw new TranslatorError(`generated YAML failed validation: ${errors.join('; ')}`, true);
    }
    return result;
}
// ---------------------------------------------------------------------------
// Phase 16 — refine-with-prose
// ---------------------------------------------------------------------------
function buildProseRefinePrompt(input) {
    const availableAgents = renderAvailableAgents(input.availableAgents);
    return [
        'You are a workflow refiner for an agent-driven kanban board. You will be given an existing ceremony in YAML and a free-form refinement instruction. Apply the instruction and return an updated YAML — keep the structure as similar as possible to the original.',
        '',
        'Available agents on this project (use only these names; do not invent):',
        availableAgents,
        '',
        'Our YAML schema supports exactly these step types: agent_run, approve, fan_out, handoff, route. There are no engine-level control primitives.',
        '',
        'Trigger taxonomy: on_issue_entry | on_schedule | on_event | manual.',
        '',
        'Current ceremony YAML:',
        '"""',
        input.currentYaml,
        '"""',
        '',
        'Refinement instruction:',
        '"""',
        input.instruction,
        '"""',
        '',
        'Respond ONLY with a JSON object (no prose, no markdown fence) matching:',
        '{',
        '  "yamlContent": string,                  // updated YAML',
        '  "triggerKind": "on_issue_entry"|"on_schedule"|"on_event"|"manual",',
        '  "triggerConfig": object,',
        '  "warnings": string[],                   // empty array if none',
        '  "rationale": string,                    // ≤3 sentences explaining the change',
        '  "diffSummary": string                   // ≤2 sentences listing what changed (e.g. "Added security review step before deploy; doubled approve timeout to 48h.")',
        '}',
        '',
        'Constraints:',
        '- Preserve the original structure and style as much as possible. Only change what the instruction asks for (plus any small fix-ups required by validation).',
        '- Use only agent names from the provided list. If the instruction names someone not on the list, add a warning and substitute "@role" or omit.',
        '- Do not silently change unrelated steps or trigger configuration.',
    ].join('\n');
}
/**
 * Apply a refinement instruction to an existing ceremony YAML and return the
 * updated YAML plus a short diff summary. Used by the Phase 16 "Refine"
 * Prose-tab control.
 */
export async function refineProse(input) {
    if (!input.instruction || !input.instruction.trim()) {
        throw new TranslatorError('instruction is empty', false);
    }
    if (!input.currentYaml || !input.currentYaml.trim()) {
        throw new TranslatorError('currentYaml is empty', false);
    }
    const key = `${input.projectId}:refine:${input.ceremonyKey || 'unknown'}`;
    consumeThrottleSlot(key);
    const prompt = buildProseRefinePrompt(input);
    let raw;
    try {
        raw = await callTranslator(prompt);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new TranslatorError(`translator LLM call failed: ${msg}`, true);
    }
    const parsed = extractJsonObject(raw);
    const base = normalisePayload(parsed);
    const { valid, errors } = validateWorkflowYaml(base.yamlContent);
    if (!valid) {
        throw new TranslatorError(`refined YAML failed validation: ${errors.join('; ')}`, true);
    }
    let diffSummary = '(no diff summary provided)';
    if (parsed && typeof parsed === 'object') {
        const p = parsed;
        if (typeof p.diffSummary === 'string' && p.diffSummary.trim().length > 0) {
            diffSummary = p.diffSummary.trim().slice(0, 500);
        }
    }
    return { ...base, diffSummary };
}
//# sourceMappingURL=ceremony-translator.js.map
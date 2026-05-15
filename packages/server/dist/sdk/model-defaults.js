/**
 * model-defaults.ts — Auto-model resolution chain.
 *
 * When an agent is created with `model: null` (the "Auto" choice in
 * HireAgentModal) and a session/run starts without an explicit
 * `input.model`, the SDK call would fail because nothing turns the
 * "auto" sentinel into a real model id.
 *
 * The resolved chain (highest precedence first):
 *
 *   input.model          // per-session / per-run override
 *   agent.model          // the agent's preferred model
 *   project.defaultModel // project-level default (Settings page)
 *   BUILTIN_FALLBACK     // last-resort default that always works
 *
 * `null`, `undefined`, empty string, and the literal `'auto'` are all
 * treated as "unspecified" — the resolver skips that layer and falls
 * through to the next.
 */
/**
 * Last-resort model id used when neither the session, the agent, nor
 * the project specifies a real model. Picked because it's universally
 * available across SDK environments and mid-tier on cost.
 */
export const BUILTIN_FALLBACK = 'gpt-5.4';
/**
 * Returns true when `m` is "unspecified" (null/undefined/empty/'auto').
 * Centralised so call sites stay consistent.
 */
function isUnspecified(m) {
    if (m == null)
        return true;
    const trimmed = m.trim().toLowerCase();
    return trimmed === '' || trimmed === 'auto';
}
export function resolveModel(input) {
    if (!isUnspecified(input.sessionModel)) {
        return { model: input.sessionModel, via: 'session' };
    }
    if (!isUnspecified(input.agentModel)) {
        return { model: input.agentModel, via: 'agent' };
    }
    if (!isUnspecified(input.projectDefaultModel)) {
        return { model: input.projectDefaultModel, via: 'project' };
    }
    return { model: BUILTIN_FALLBACK, via: 'fallback' };
}
//# sourceMappingURL=model-defaults.js.map
/**
 * review-policy-resolver.ts — Phase 8
 *
 * Pure resolver that merges a workflow approve-step's policy with the
 * inherited project / board defaults and the system-default fallback.
 *
 * Used by:
 *   - the workflow stepper (Phase 8) to snapshot the effective policy on
 *     `step_runs.policy_resolved` when an approve step is instantiated;
 *   - the deliverable-review pipeline (Phase 9) — deliverables don't have
 *     YAML overrides, so they fall back to board → project → system_default.
 *
 * No DB access. Caller pre-fetches default rows via `loadProjectDefault`
 * (helper below) and passes them in. Keeps the resolver trivially testable.
 */
import { eq, and } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
// ---------------------------------------------------------------------------
// System defaults — last-resort fallback when no scope provides a value.
// ---------------------------------------------------------------------------
const SYSTEM_DEFAULT = {
    approvers: [],
    approver_objects: [],
    request_changes_policy: 'first',
    quorum: null,
    exclude_author: false,
    timeout: '24h',
    timeout_action: 'notify',
    fallback_reviewer: null,
};
/**
 * Resolve a policy for a workflow `approve` step.
 *
 * The step's YAML fields become the `override` layer; the rest is up to
 * the caller to pre-fetch via `loadProjectDefault` / `loadBoardDefault`.
 */
export function resolvePolicyForStep(step, layers) {
    return mergePolicy({
        override: stepToPayload(step),
        board: layers.board,
        project: layers.project,
    });
}
/**
 * Resolve a policy for a deliverable review (Phase 9). No step → no
 * `override` layer. Board / project / system_default only.
 */
export function resolvePolicyForDeliverable(layers) {
    return mergePolicy({ override: undefined, board: layers.board, project: layers.project });
}
/**
 * Validate a payload coming in from an HTTP request, YAML, or seed code.
 * Returns either `{ ok: true, payload }` or `{ ok: false, errors }` so the
 * caller can refuse the write before it lands in the DB. Schema is JSON, not
 * TypeScript — so we hand-roll runtime checks rather than trust the cast.
 */
export function validatePolicyPayload(raw) {
    const errors = [];
    if (typeof raw !== 'object' || raw === null) {
        return { ok: false, errors: ['policy payload must be a JSON object'] };
    }
    const r = raw;
    const out = {};
    if (r['approvers'] !== undefined) {
        if (!Array.isArray(r['approvers']) || r['approvers'].some((v) => typeof v !== 'string')) {
            errors.push('approvers must be an array of strings');
        }
        else {
            out.approvers = r['approvers'].slice();
        }
    }
    if (r['approver_objects'] !== undefined) {
        if (!Array.isArray(r['approver_objects'])) {
            errors.push('approver_objects must be an array');
        }
        else {
            const validKinds = new Set(['agent', 'human', 'role']);
            const objs = [];
            for (let i = 0; i < r['approver_objects'].length; i++) {
                const entry = r['approver_objects'][i];
                if (typeof entry !== 'object' || entry === null) {
                    errors.push(`approver_objects[${i}] must be an object`);
                    continue;
                }
                const e = entry;
                const kind = e['kind'];
                const ref = e['ref'];
                if (!validKinds.has(kind))
                    errors.push(`approver_objects[${i}].kind must be agent | human | role`);
                if (typeof ref !== 'string' || !ref)
                    errors.push(`approver_objects[${i}].ref must be a non-empty string`);
                if (validKinds.has(kind) && typeof ref === 'string' && ref) {
                    objs.push({ kind, ref });
                }
            }
            out.approver_objects = objs;
        }
    }
    if (r['request_changes_policy'] !== undefined) {
        const v = r['request_changes_policy'];
        if (v !== 'first' && v !== 'majority' && v !== 'all') {
            errors.push('request_changes_policy must be first | majority | all');
        }
        else {
            out.request_changes_policy = v;
        }
    }
    if (r['quorum'] !== undefined) {
        const q = r['quorum'];
        if (typeof q !== 'object' || q === null) {
            errors.push('quorum must be an object {n, of}');
        }
        else {
            const qo = q;
            const n = Number(qo['n']);
            const of = Number(qo['of']);
            if (!Number.isInteger(n) || n < 1)
                errors.push('quorum.n must be a positive integer');
            else if (!Number.isInteger(of) || of < n)
                errors.push('quorum.of must be an integer >= quorum.n');
            else
                out.quorum = { n, of };
        }
    }
    if (r['exclude_author'] !== undefined) {
        if (typeof r['exclude_author'] !== 'boolean')
            errors.push('exclude_author must be boolean');
        else
            out.exclude_author = r['exclude_author'];
    }
    if (r['timeout'] !== undefined) {
        if (typeof r['timeout'] !== 'string' || !r['timeout'])
            errors.push('timeout must be a non-empty string');
        else
            out.timeout = r['timeout'];
    }
    if (r['timeout_action'] !== undefined) {
        const v = r['timeout_action'];
        if (v !== 'auto_approve' && v !== 'auto_reject' && v !== 'escalate' && v !== 'notify') {
            errors.push('timeout_action must be auto_approve | auto_reject | escalate | notify');
        }
        else {
            out.timeout_action = v;
        }
    }
    if (r['fallback_reviewer'] !== undefined) {
        if (typeof r['fallback_reviewer'] !== 'string' || !r['fallback_reviewer']) {
            errors.push('fallback_reviewer must be a non-empty string');
        }
        else {
            out.fallback_reviewer = r['fallback_reviewer'];
        }
    }
    if (errors.length > 0)
        return { ok: false, errors };
    return { ok: true, payload: out };
}
/**
 * Sanity-check the resolved policy. Catches scenarios that would
 * permanently stall a review (e.g. quorum.n > eligible reviewers).
 * Returns warning messages; empty = OK.
 */
export function validateResolvedPolicy(policy) {
    const warnings = [];
    if (policy.quorum) {
        const eligible = policy.approver_objects.length || policy.approvers.length;
        if (eligible > 0 && policy.quorum.n > eligible) {
            warnings.push(`quorum.n=${policy.quorum.n} exceeds eligible reviewer count (${eligible}); review will never advance`);
        }
        if (eligible > 0 && policy.quorum.of > eligible) {
            warnings.push(`quorum.of=${policy.quorum.of} exceeds eligible reviewer count (${eligible})`);
        }
    }
    if (policy.timeout_action === 'escalate' && !policy.fallback_reviewer) {
        warnings.push('timeout_action=escalate but no fallback_reviewer configured');
    }
    return warnings;
}
// ---------------------------------------------------------------------------
// DB helpers — load default payloads. Caller passes results into the resolver.
// Board scope is intentionally NOT loaded by helper yet — the boards table
// doesn't exist; UI code that wants board defaults must opt in explicitly
// once Phase 8 boards work lands.
// ---------------------------------------------------------------------------
export async function loadProjectDefault(projectId) {
    const db = getDb();
    const rows = await db
        .select({ payload: schema.reviewPolicyDefaults.payload })
        .from(schema.reviewPolicyDefaults)
        .where(and(eq(schema.reviewPolicyDefaults.scope, 'project'), eq(schema.reviewPolicyDefaults.scopeId, projectId)))
        .limit(1);
    if (rows.length === 0)
        return undefined;
    const validated = validatePolicyPayload(rows[0].payload);
    if (!validated.ok) {
        console.warn(`[review-policy-resolver] project default for ${projectId} failed validation: ${validated.errors.join(', ')}`);
        return undefined;
    }
    return validated.payload;
}
function mergePolicy(layers) {
    const policy = { ...SYSTEM_DEFAULT };
    const sources = {
        approvers: 'system_default',
        approver_objects: 'system_default',
        request_changes_policy: 'system_default',
        quorum: 'system_default',
        exclude_author: 'system_default',
        timeout: 'system_default',
        timeout_action: 'system_default',
        fallback_reviewer: 'system_default',
    };
    // Apply in reverse priority order so later layers overwrite earlier ones,
    // and the recorded `source` always reflects the highest-priority writer.
    applyLayer(policy, sources, layers.project, 'project');
    applyLayer(policy, sources, layers.board, 'board');
    applyLayer(policy, sources, layers.override, 'step');
    const warnings = validateResolvedPolicy(policy);
    return { policy, sources, warnings };
}
function applyLayer(policy, sources, layer, source) {
    if (!layer)
        return;
    if (layer.approvers !== undefined) {
        policy.approvers = layer.approvers.slice();
        sources.approvers = source;
    }
    if (layer.approver_objects !== undefined) {
        policy.approver_objects = layer.approver_objects.slice();
        sources.approver_objects = source;
    }
    if (layer.request_changes_policy !== undefined) {
        policy.request_changes_policy = layer.request_changes_policy;
        sources.request_changes_policy = source;
    }
    if (layer.quorum !== undefined) {
        policy.quorum = { n: layer.quorum.n, of: layer.quorum.of };
        sources.quorum = source;
    }
    if (layer.exclude_author !== undefined) {
        policy.exclude_author = layer.exclude_author;
        sources.exclude_author = source;
    }
    if (layer.timeout !== undefined) {
        policy.timeout = layer.timeout;
        sources.timeout = source;
    }
    if (layer.timeout_action !== undefined) {
        policy.timeout_action = layer.timeout_action;
        sources.timeout_action = source;
    }
    if (layer.fallback_reviewer !== undefined) {
        policy.fallback_reviewer = layer.fallback_reviewer;
        sources.fallback_reviewer = source;
    }
}
function stepToPayload(step) {
    const out = {};
    if (step.approvers !== undefined)
        out.approvers = step.approvers.slice();
    if (step.approverObjects !== undefined)
        out.approver_objects = step.approverObjects.slice();
    if (step.request_changes_policy !== undefined)
        out.request_changes_policy = step.request_changes_policy;
    if (step.quorum !== undefined)
        out.quorum = { n: step.quorum.n, of: step.quorum.of };
    if (step.exclude_author !== undefined)
        out.exclude_author = step.exclude_author;
    if (step.timeout !== undefined)
        out.timeout = step.timeout;
    if (step.timeoutAction !== undefined)
        out.timeout_action = step.timeoutAction;
    if (step.fallbackReviewer !== undefined)
        out.fallback_reviewer = step.fallbackReviewer;
    return out;
}
//# sourceMappingURL=review-policy-resolver.js.map
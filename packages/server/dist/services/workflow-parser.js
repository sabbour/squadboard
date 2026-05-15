/**
 * workflow-parser.ts — YAML workflow definition parser (Demo 6 / Demo 10)
 *
 * Parses the `simple` workflow YAML format into a WorkflowDefinition.
 * Uses js-yaml for parsing; performs structural validation on top.
 *
 * Supported step types: route | agent_run | approve | fan_out | handoff
 * Invariant 1: agent_run is the only step that does LLM work.
 */
import * as yaml from 'js-yaml';
// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const VALID_STEP_TYPES = new Set(['route', 'agent_run', 'approve', 'fan_out', 'handoff']);
function validateStepShape(step, index) {
    const errs = [];
    if (typeof step !== 'object' || step === null) {
        errs.push(`step[${index}]: must be an object`);
        return errs;
    }
    const s = step;
    if (!s['type'] || !VALID_STEP_TYPES.has(s['type'])) {
        errs.push(`step[${index}]: 'type' must be one of route | agent_run | approve | fan_out | handoff`);
        return errs;
    }
    if (s['type'] === 'agent_run' && s['agent'] !== undefined && typeof s['agent'] !== 'string') {
        errs.push(`step[${index}]: 'agent' must be a string`);
    }
    if (s['type'] === 'approve' && s['approvers'] !== undefined && !Array.isArray(s['approvers'])) {
        errs.push(`step[${index}]: 'approvers' must be an array`);
    }
    if (s['type'] === 'approve' && s['approvers'] !== undefined && Array.isArray(s['approvers'])) {
        const validKinds = new Set(['agent', 'human', 'role']);
        for (let i = 0; i < s['approvers'].length; i++) {
            const entry = s['approvers'][i];
            if (typeof entry === 'string')
                continue;
            if (typeof entry !== 'object' || entry === null) {
                errs.push(`step[${index}].approvers[${i}]: must be a string or {kind, ref} object`);
                continue;
            }
            const obj = entry;
            if (typeof obj['kind'] !== 'string' || !validKinds.has(obj['kind'])) {
                errs.push(`step[${index}].approvers[${i}]: 'kind' must be one of agent | human | role`);
            }
            if (typeof obj['ref'] !== 'string' || !obj['ref']) {
                errs.push(`step[${index}].approvers[${i}]: 'ref' must be a non-empty string`);
            }
        }
    }
    if (s['type'] === 'approve' && s['timeout_action'] !== undefined) {
        const validTimeoutActions = new Set(['auto_approve', 'auto_reject', 'escalate', 'notify']);
        if (typeof s['timeout_action'] !== 'string' || !validTimeoutActions.has(s['timeout_action'])) {
            errs.push(`step[${index}]: 'timeout_action' must be one of auto_approve | auto_reject | escalate | notify`);
        }
    }
    if (s['type'] === 'approve' && s['quorum'] !== undefined) {
        const q = s['quorum'];
        if (typeof q !== 'object' || q === null) {
            errs.push(`step[${index}]: 'quorum' must be an object {n, of}`);
        }
        else {
            const qo = q;
            const n = Number(qo['n']);
            const of = Number(qo['of']);
            if (!Number.isInteger(n) || n < 1)
                errs.push(`step[${index}]: 'quorum.n' must be a positive integer`);
            if (!Number.isInteger(of) || of < n)
                errs.push(`step[${index}]: 'quorum.of' must be an integer >= quorum.n`);
        }
    }
    if (s['type'] === 'approve' && s['request_changes_policy'] !== undefined) {
        const validPolicies = new Set(['first', 'majority', 'all']);
        if (typeof s['request_changes_policy'] !== 'string' || !validPolicies.has(s['request_changes_policy'])) {
            errs.push(`step[${index}]: 'request_changes_policy' must be one of first | majority | all`);
        }
    }
    if (s['type'] === 'fan_out') {
        const validSplitBy = new Set(['labels', 'agents', 'count']);
        if (!s['split_by'] || !validSplitBy.has(s['split_by'])) {
            errs.push(`step[${index}]: fan_out 'split_by' must be one of labels | agents | count`);
        }
        const validMerge = new Set(['all', 'any', 'first']);
        if (!s['merge_strategy'] || !validMerge.has(s['merge_strategy'])) {
            errs.push(`step[${index}]: fan_out 'merge_strategy' must be one of all | any | first`);
        }
        if (!Array.isArray(s['steps']) || s['steps'].length === 0) {
            errs.push(`step[${index}]: fan_out 'steps' must be a non-empty array`);
        }
        else {
            for (let j = 0; j < s['steps'].length; j++) {
                errs.push(...validateStepShape(s['steps'][j], j).map((e) => `step[${index}].steps[${j}]: ${e}`));
            }
        }
        if (s['split_by'] === 'count' && (typeof s['count'] !== 'number' || s['count'] < 1)) {
            errs.push(`step[${index}]: fan_out 'count' must be a positive integer when split_by='count'`);
        }
        if (s['split_by'] === 'agents' && (!Array.isArray(s['agents']) || s['agents'].length === 0)) {
            errs.push(`step[${index}]: fan_out 'agents' must be a non-empty array when split_by='agents'`);
        }
    }
    if (s['type'] === 'handoff') {
        if (typeof s['to'] !== 'string' || !s['to']) {
            errs.push(`step[${index}]: handoff 'to' must be a non-empty string`);
        }
    }
    return errs;
}
/**
 * Validate YAML content without throwing.
 * Returns { valid, errors } so callers can surface issues before persisting.
 */
export function validateWorkflowYaml(yamlContent) {
    const errors = [];
    let parsed;
    try {
        parsed = yaml.load(yamlContent);
    }
    catch (err) {
        return { valid: false, errors: [`YAML parse error: ${String(err)}`] };
    }
    if (typeof parsed !== 'object' || parsed === null) {
        return { valid: false, errors: ['Workflow definition must be a YAML object'] };
    }
    const doc = parsed;
    if (!doc['name'] || typeof doc['name'] !== 'string') {
        errors.push("'name' is required and must be a string");
    }
    if (!Array.isArray(doc['steps']) || doc['steps'].length === 0) {
        errors.push("'steps' is required and must be a non-empty array");
    }
    else {
        for (let i = 0; i < doc['steps'].length; i++) {
            errors.push(...validateStepShape(doc['steps'][i], i));
        }
    }
    if (doc['output_schema'] !== undefined && (typeof doc['output_schema'] !== 'object' || doc['output_schema'] === null)) {
        errors.push("'output_schema' must be an object (JSON Schema)");
    }
    return { valid: errors.length === 0, errors };
}
/**
 * Parse YAML content into a structured WorkflowDefinition.
 * Throws if the YAML is invalid (call validateWorkflowYaml first for user-facing errors).
 */
export async function parseWorkflowYaml(yamlContent) {
    const { valid, errors } = validateWorkflowYaml(yamlContent);
    if (!valid) {
        throw new Error(`Invalid workflow YAML: ${errors.join('; ')}`);
    }
    const doc = yaml.load(yamlContent);
    const steps = doc['steps'].map((s) => parseStepRaw(s));
    return {
        name: String(doc['name']),
        description: doc['description'] !== undefined ? String(doc['description']) : undefined,
        outputSchema: doc['output_schema'],
        steps,
    };
}
function parseStepRaw(s) {
    const type = s['type'];
    if (type === 'fan_out') {
        const childSteps = Array.isArray(s['steps'])
            ? s['steps'].map((cs) => parseStepRaw(cs))
            : [];
        return {
            type: 'fan_out',
            label: s['label'] !== undefined ? String(s['label']) : undefined,
            split_by: s['split_by'],
            count: s['count'] !== undefined ? Number(s['count']) : undefined,
            agents: Array.isArray(s['agents']) ? s['agents'].map(String) : undefined,
            merge_strategy: s['merge_strategy'] ?? 'all',
            on_child_failure: s['on_child_failure'] !== undefined
                ? s['on_child_failure']
                : 'fail_fast',
            steps: childSteps,
        };
    }
    if (type === 'handoff') {
        return {
            type: 'handoff',
            label: s['label'] !== undefined ? String(s['label']) : undefined,
            to: String(s['to']),
            message: s['message'] !== undefined ? String(s['message']) : undefined,
        };
    }
    if (type === 'approve') {
        const step = { type: 'approve' };
        if (s['label'] !== undefined)
            step.label = String(s['label']);
        if (s['agent'] !== undefined)
            step.agent = String(s['agent']);
        if (s['prompt'] !== undefined)
            step.prompt = String(s['prompt']);
        if (Array.isArray(s['approvers'])) {
            const rawList = s['approvers'];
            const stringList = [];
            const objectList = [];
            for (const entry of rawList) {
                if (typeof entry === 'string') {
                    stringList.push(entry);
                    objectList.push({ kind: 'role', ref: entry });
                }
                else if (typeof entry === 'object' && entry !== null) {
                    const obj = entry;
                    const kind = obj['kind'];
                    const ref = String(obj['ref']);
                    objectList.push({ kind, ref });
                    // Mirror agent + role kinds back into the legacy string list so the
                    // existing peer-reviewer engine (which expects string[]) still works
                    // with new typed YAML. 'human' kind is intentionally NOT mirrored —
                    // human reviewers don't dispatch through the agent run pipeline.
                    if (kind === 'agent' || kind === 'role')
                        stringList.push(ref);
                }
            }
            step.approvers = stringList;
            step.approverObjects = objectList;
        }
        if (s['timeout'] !== undefined)
            step.timeout = String(s['timeout']);
        if (s['timeout_action'] !== undefined) {
            step.timeoutAction = s['timeout_action'];
        }
        if (s['fallback_reviewer'] !== undefined) {
            step.fallbackReviewer = String(s['fallback_reviewer']);
        }
        if (s['request_changes_policy'] !== undefined) {
            step.request_changes_policy = s['request_changes_policy'];
        }
        if (s['quorum'] !== undefined && typeof s['quorum'] === 'object' && s['quorum'] !== null) {
            const q = s['quorum'];
            step.quorum = { n: Number(q['n'] ?? 1), of: Number(q['of'] ?? 1) };
        }
        if (s['exclude_author'] !== undefined)
            step.exclude_author = Boolean(s['exclude_author']);
        return step;
    }
    // route | agent_run
    const step = { type };
    if (s['label'] !== undefined)
        step.label = String(s['label']);
    if (s['agent'] !== undefined)
        step.agent = String(s['agent']);
    if (s['prompt'] !== undefined)
        step.prompt = String(s['prompt']);
    if (s['timeout'] !== undefined)
        step.timeout = String(s['timeout']);
    return step;
}
//# sourceMappingURL=workflow-parser.js.map
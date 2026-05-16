/**
 * ceremony-roundtrip.ts — CER-4: Pure helpers for editor ↔ WorkflowYaml conversion.
 *
 * These helpers are pure (no React, no DOM, no fetch) so they can be used by:
 *  - The export button (when one is added)
 *  - Tests (both pure unit tests and RTL tests)
 *
 * Design notes:
 *  1. POSITIONS EXCLUDED: Canvas node positions are presentation-only and have
 *     no meaning in YAML. They are never serialised.
 *  2. STEP IDs GENERATED: The visual editor tracks steps by array index, not by
 *     id. On editorToYaml we derive an id from the step label (slugified) or
 *     fall back to "step-N". On yamlToEditor the id is silently dropped.
 *  3. KIND VOCABULARY DRIFT: The canonical YAML (CER-3) accepts any string in
 *     step.kind (passthrough schema). The editor uses its own StepKind enum
 *     ('agent_run', 'route', 'approve', 'fan_out', 'handoff'). Built-in YAMLs
 *     use 'agent-task' / 'notify', which we normalise on import. See decision
 *     file kobayashi-w29-cer-4-*.md for details.
 *  4. SLUG DERIVATION: metadata.name (slug) is derived from the display name by
 *     lowercasing + replacing non-alphanumeric chars with dashes. The round-
 *     trip therefore only guarantees display name equality, not slug equality.
 */

import type {
  CeremonyStep,
  AgentRunStepNode,
  RouteStepNode,
  ApproveStepNode,
  FanOutStepNode,
  HandoffStepNode,
  StepKind,
} from '../services/ceremony-graph.ts'
import type { TriggerKind } from '../api/ceremonies.ts'

// ---------------------------------------------------------------------------
// WorkflowYaml — structural copy of server/src/ceremonies/types.ts
// (cannot cross package boundary at runtime)
// ---------------------------------------------------------------------------

export interface WorkflowTrigger {
  type: 'github-event' | 'manual' | 'cron' | 'agent-signal'
  event?: string
  filters?: { labels?: string[]; paths?: string[]; [key: string]: unknown }
  schedule?: string
}

export interface WorkflowStep {
  id: string
  kind: string
  [key: string]: unknown
}

export interface WorkflowYaml {
  apiVersion: 'squad.io/v1'
  kind: 'Ceremony'
  metadata: {
    name: string
    displayName?: string
    description?: string
  }
  spec: {
    trigger: WorkflowTrigger
    steps: WorkflowStep[]
  }
}

// ---------------------------------------------------------------------------
// EditorState — mirrors the fields of CeremonyEditor.tsx that belong in YAML.
//
// Intentionally excluded (presentation / DB-only):
//   - kind (CeremonyKind): 'workflow' | 'ceremony' | etc. — organisational, not spec
//   - headerExtras: free-form fields from older YAML the editor can't model
//   - showAdvancedFor, activeTab, and all other UI flags
//   - node positions (canvas layout)
// ---------------------------------------------------------------------------

export interface EditorState {
  /** User-facing ceremony name (maps to metadata.displayName). */
  name: string
  /** Optional description (maps to metadata.description). */
  description: string
  /** DB trigger kind (maps to spec.trigger.type via mapTriggerKindToYaml). */
  triggerKind: TriggerKind
  /** DB trigger config payload (event, filters, schedule, …). */
  triggerConfig: Record<string, unknown>
  /** Top-level steps in document order. */
  steps: CeremonyStep[]
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Derive a URL-safe slug from a display name. */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'untitled'
}

/** Map DB triggerKind + triggerConfig → WorkflowTrigger. */
function mapTriggerKindToYaml(
  triggerKind: TriggerKind,
  triggerConfig: Record<string, unknown>,
): WorkflowTrigger {
  switch (triggerKind) {
    case 'on_event': {
      const event = (triggerConfig.event as string | undefined) ?? 'push'
      const filters = triggerConfig.filters as WorkflowTrigger['filters'] | undefined
      return {
        type: 'github-event',
        event,
        ...(filters !== undefined ? { filters } : {}),
      }
    }
    case 'on_schedule': {
      const schedule =
        (triggerConfig.schedule as string | undefined) ??
        (triggerConfig.cronExpr as string | undefined) ??
        '0 9 * * 1'
      return { type: 'cron', schedule }
    }
    case 'on_issue_entry':
      return { type: 'agent-signal' }
    case 'manual':
    default:
      return { type: 'manual' }
  }
}

/** Map WorkflowTrigger → DB triggerKind + triggerConfig. */
function mapYamlTriggerToEditorTrigger(trigger: WorkflowTrigger): {
  triggerKind: TriggerKind
  triggerConfig: Record<string, unknown>
} {
  switch (trigger.type) {
    case 'github-event': {
      const config: Record<string, unknown> = { event: trigger.event ?? 'push' }
      if (trigger.filters !== undefined) config.filters = trigger.filters
      return { triggerKind: 'on_event', triggerConfig: config }
    }
    case 'cron':
      return {
        triggerKind: 'on_schedule',
        triggerConfig: { schedule: trigger.schedule ?? '0 9 * * 1' },
      }
    case 'agent-signal':
      return { triggerKind: 'on_issue_entry', triggerConfig: {} }
    case 'manual':
    default:
      return { triggerKind: 'manual', triggerConfig: {} }
  }
}

/**
 * Map a YAML step.kind string to the nearest client StepKind.
 *
 * Drift note: built-in YAMLs use 'agent-task' and 'notify'. These are
 * normalised here. All other unknown kinds fall back to 'agent_run'.
 */
function mapYamlKindToStepKind(kind: string): StepKind {
  switch (kind) {
    case 'agent_run':
    case 'agent-run':
    case 'agent-task':
    case 'agent_task':
      return 'agent_run'
    case 'route':
      return 'route'
    case 'approve':
    case 'peer_review':
    case 'peer-review':
      return 'approve'
    case 'fan_out':
    case 'fan-out':
      return 'fan_out'
    case 'handoff':
    case 'notify':
      return 'handoff'
    default:
      return 'agent_run'
  }
}

/** Generate a stable step id from a step's label or its position index. */
function deriveStepId(step: CeremonyStep, index: number): string {
  if (step.label) {
    const slug = step.label
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
    if (slug) return slug
  }
  return `step-${index}`
}

/** Convert a single CeremonyStep to a WorkflowStep, generating an id. */
function stepToYaml(step: CeremonyStep, index: number): WorkflowStep {
  const id = deriveStepId(step, index)
  const out: WorkflowStep = { id, kind: step.kind }

  if (step.label !== undefined) out.label = step.label

  switch (step.kind) {
    case 'agent_run':
    case 'route': {
      const s = step as AgentRunStepNode | RouteStepNode
      if (s.agent !== undefined) out.agent = s.agent
      if (s.prompt !== undefined) out.prompt = s.prompt
      if (s.timeout !== undefined) out.timeout = s.timeout
      break
    }
    case 'approve': {
      const s = step as ApproveStepNode
      if (s.approvers !== undefined) out.approvers = s.approvers
      if (s.request_changes_policy !== undefined)
        out.request_changes_policy = s.request_changes_policy
      if (s.timeout !== undefined) out.timeout = s.timeout
      break
    }
    case 'fan_out': {
      const s = step as FanOutStepNode
      if (s.split_by !== undefined) out.split_by = s.split_by
      if (s.count !== undefined) out.count = s.count
      if (s.agents !== undefined) out.agents = s.agents
      if (s.merge_strategy !== undefined) out.merge_strategy = s.merge_strategy
      if (s.mode !== undefined && s.mode !== 'serial') out.mode = s.mode
      out.steps = s.steps.map((child, ci) => stepToYaml(child, ci))
      break
    }
    case 'handoff': {
      const s = step as HandoffStepNode
      if (s.to !== undefined) out.to = s.to
      if (s.message !== undefined) out.message = s.message
      break
    }
  }

  // Preserve extras verbatim
  Object.assign(out, step.extras)

  return out
}

/** Convert a WorkflowStep back to a CeremonyStep (id is dropped; kind is normalised). */
function yamlStepToEditor(step: WorkflowStep): CeremonyStep {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _id, kind: rawKind, label, ...rest } = step
  const clientKind = mapYamlKindToStepKind(rawKind)

  // Fields that are modelled explicitly for each step kind.
  const knownFields: Record<StepKind, Set<string>> = {
    agent_run: new Set(['agent', 'prompt', 'timeout']),
    route: new Set(['agent', 'prompt', 'timeout']),
    approve: new Set(['approvers', 'request_changes_policy', 'timeout']),
    fan_out: new Set(['split_by', 'count', 'agents', 'merge_strategy', 'mode', 'steps']),
    handoff: new Set(['to', 'message']),
  }
  const known = knownFields[clientKind]
  const extras: Record<string, unknown> = {}

  // Fields not modelled for this kind go into extras.
  // If the original YAML kind differed from the client kind, record it.
  if (clientKind !== rawKind) extras._yamlKind = rawKind

  switch (clientKind) {
    case 'agent_run':
    case 'route': {
      const node = { kind: clientKind, extras } as AgentRunStepNode
      if (typeof label === 'string') node.label = label
      if (typeof rest.agent === 'string') node.agent = rest.agent
      if (typeof rest.prompt === 'string') node.prompt = rest.prompt
      if (typeof rest.timeout === 'string') node.timeout = rest.timeout
      for (const [k, v] of Object.entries(rest)) {
        if (!known.has(k)) extras[k] = v
      }
      return node
    }
    case 'approve': {
      const node = { kind: 'approve', extras } as ApproveStepNode
      if (typeof label === 'string') node.label = label
      if (Array.isArray(rest.approvers)) node.approvers = rest.approvers as string[]
      const policy = rest.request_changes_policy
      if (policy === 'first' || policy === 'majority' || policy === 'all')
        node.request_changes_policy = policy
      if (typeof rest.timeout === 'string') node.timeout = rest.timeout
      for (const [k, v] of Object.entries(rest)) {
        if (!known.has(k)) extras[k] = v
      }
      return node
    }
    case 'fan_out': {
      const node = {
        kind: 'fan_out',
        steps: [],
        extras,
      } as FanOutStepNode
      if (typeof label === 'string') node.label = label
      const sb = rest.split_by
      if (sb === 'labels' || sb === 'agents' || sb === 'count') node.split_by = sb
      if (typeof rest.count === 'number') node.count = rest.count
      if (Array.isArray(rest.agents)) node.agents = (rest.agents as unknown[]).map(String)
      const ms = rest.merge_strategy
      if (ms === 'all' || ms === 'any' || ms === 'first') node.merge_strategy = ms
      const mode = rest.mode
      if (mode === 'serial' || mode === 'parallel') node.mode = mode
      if (Array.isArray(rest.steps)) {
        node.steps = (rest.steps as WorkflowStep[]).map((s) => yamlStepToEditor(s))
      }
      for (const [k, v] of Object.entries(rest)) {
        if (!known.has(k)) extras[k] = v
      }
      return node
    }
    case 'handoff': {
      const node = { kind: 'handoff', extras } as HandoffStepNode
      if (typeof label === 'string') node.label = label
      if (typeof rest.to === 'string') node.to = rest.to
      if (typeof rest.message === 'string') node.message = rest.message
      for (const [k, v] of Object.entries(rest)) {
        if (!known.has(k)) extras[k] = v
      }
      return node
    }
    default: {
      const node = { kind: 'agent_run', extras } as AgentRunStepNode
      if (typeof label === 'string') node.label = label
      for (const [k, v] of Object.entries(rest)) {
        extras[k] = v
      }
      return node
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert visual editor state → WorkflowYaml object (NOT a YAML string).
 *
 * Note: canvas node positions are not included — they are presentation-only.
 * Step ids are derived from labels or index; they are not stored in editor state.
 */
export function editorToYaml(state: EditorState): WorkflowYaml {
  const slug = slugify(state.name)
  const trigger = mapTriggerKindToYaml(state.triggerKind, state.triggerConfig)

  const metadata: WorkflowYaml['metadata'] = { name: slug, displayName: state.name }
  if (state.description) metadata.description = state.description

  return {
    apiVersion: 'squad.io/v1',
    kind: 'Ceremony',
    metadata,
    spec: {
      trigger,
      steps: state.steps.map((s, i) => stepToYaml(s, i)),
    },
  }
}

/**
 * Convert WorkflowYaml object → visual editor state.
 *
 * Step order is preserved. Trigger type is discriminated into triggerKind /
 * triggerConfig (the editor's DB-aligned representation).
 */
export function yamlToEditor(yaml: WorkflowYaml): EditorState {
  const name = yaml.metadata.displayName ?? yaml.metadata.name
  const description = yaml.metadata.description ?? ''
  const { triggerKind, triggerConfig } = mapYamlTriggerToEditorTrigger(yaml.spec.trigger)
  const steps = yaml.spec.steps.map((s) => yamlStepToEditor(s))

  return { name, description, triggerKind, triggerConfig, steps }
}

/**
 * Roundtrip the state through YAML and back.
 *
 * Should produce an equivalent state (same trigger, same steps in order).
 * Extras added during import (_yamlKind) are preserved in the returned state.
 */
export function roundtripState(state: EditorState): EditorState {
  return yamlToEditor(editorToYaml(state))
}

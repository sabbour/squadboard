/**
 * services/ceremony-graph.ts — Phase 16
 *
 * YAML ↔ graph adapter for the Ceremony Editor's Visual tab.
 *
 *   ceremonyYamlToGraph(yaml)  →  { nodes, edges, header }
 *   graphToCeremonyYaml(graph) →  yaml string
 *
 * The YAML stays the source of truth; the graph is a *projection* of the
 * sequential step list that the engine actually executes. A "graph" here
 * is therefore just a linearised DAG plus a couple of derived edges for
 * fan-out children (so the canvas can show the spawn fan).
 *
 * Round-trip invariants:
 *   - For valid ceremony YAML accepted by `validateWorkflowYaml`, calling
 *     graphToCeremonyYaml(ceremonyYamlToGraph(yaml)) returns YAML that
 *     parses back to a structurally equivalent step list (same step kinds,
 *     same fields, in the same sequential order).
 *   - Unknown / unsupported fields on a step are preserved on the node as
 *     `extras` and re-emitted by graphToCeremonyYaml so we never silently
 *     drop data the visual editor doesn't yet know about.
 *
 * No runtime YAML library on the client — we use a small hand-written
 * emitter (the same approach Phase 10's CeremonyEditor used) plus a more
 * tolerant indentation-based parser that handles nested fan_out steps and
 * preserves unknown scalars as `extras`.
 */

// ---------------------------------------------------------------------------
// Public types — superset of the per-step shape the editor wants to render.
// Mirrors server/src/services/workflow-parser.ts:WorkflowStep but on the
// client side (where we don't depend on js-yaml).
// ---------------------------------------------------------------------------

export type StepKind = 'route' | 'agent_run' | 'approve' | 'fan_out' | 'handoff'

export interface CeremonyHeader {
  /** Top-level `name:` field. */
  name: string
  /** Optional `description:` field. */
  description?: string
  /**
   * Any additional top-level scalars / objects we don't model explicitly
   * (`output_schema`, etc.). Preserved through round-trip.
   */
  extras: Record<string, unknown>
}

export interface CeremonyStepBase {
  kind: StepKind
  label?: string
  /**
   * Free-form, unmodelled fields preserved verbatim through round-trip.
   * Keyed by the YAML field name (snake_case as appears in the file).
   */
  extras: Record<string, unknown>
}

export interface RouteStepNode extends CeremonyStepBase {
  kind: 'route'
  agent?: string
  prompt?: string
  timeout?: string
}

export interface AgentRunStepNode extends CeremonyStepBase {
  kind: 'agent_run'
  agent?: string
  prompt?: string
  timeout?: string
}

export interface ApproveStepNode extends CeremonyStepBase {
  kind: 'approve'
  approvers?: string[]
  request_changes_policy?: 'first' | 'majority' | 'all'
  timeout?: string
}

export interface FanOutStepNode extends CeremonyStepBase {
  kind: 'fan_out'
  split_by?: 'labels' | 'agents' | 'count'
  count?: number
  agents?: string[]
  merge_strategy?: 'all' | 'any' | 'first'
  mode?: 'serial' | 'parallel'
  /** Child steps, in document order. */
  steps: CeremonyStep[]
}

export interface HandoffStepNode extends CeremonyStepBase {
  kind: 'handoff'
  to?: string
  message?: string
}

export type CeremonyStep =
  | RouteStepNode
  | AgentRunStepNode
  | ApproveStepNode
  | FanOutStepNode
  | HandoffStepNode

export interface GraphNode {
  /** Stable id within a single round-trip — `step-<n>` for top-level steps. */
  id: string
  /** Index within the parent steps array (0-based). */
  index: number
  /** Optional parent node id (for fan_out children). */
  parentId?: string
  step: CeremonyStep
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  kind: 'sequence' | 'fan_out_child'
}

export interface CeremonyGraph {
  header: CeremonyHeader
  nodes: GraphNode[]
  edges: GraphEdge[]
}

// ---------------------------------------------------------------------------
// YAML emitter (no runtime YAML lib on the client)
// ---------------------------------------------------------------------------

const RESERVED_FIELDS_BASE = new Set(['type', 'label'])
const RESERVED_FIELDS_ROUTE = new Set([...RESERVED_FIELDS_BASE, 'agent', 'prompt', 'timeout'])
const RESERVED_FIELDS_AGENT_RUN = new Set([...RESERVED_FIELDS_BASE, 'agent', 'prompt', 'timeout'])
const RESERVED_FIELDS_APPROVE = new Set([
  ...RESERVED_FIELDS_BASE,
  'approvers',
  'request_changes_policy',
  'timeout',
])
const RESERVED_FIELDS_FAN_OUT = new Set([
  ...RESERVED_FIELDS_BASE,
  'split_by',
  'count',
  'agents',
  'merge_strategy',
  'mode',
  'steps',
])
const RESERVED_FIELDS_HANDOFF = new Set([...RESERVED_FIELDS_BASE, 'to', 'message'])

const RESERVED_HEADER_FIELDS = new Set(['name', 'description', 'steps'])

function quoteIfNeeded(v: string): string {
  if (v === '') return '""'
  if (/^(true|false|null|yes|no)$/i.test(v)) return JSON.stringify(v)
  if (/^-?\d+(\.\d+)?$/.test(v)) return JSON.stringify(v)
  if (/[:#\[\]&*!|>'"%@`,{}]/.test(v) || v.includes('\n') || /^\s|\s$/.test(v)) {
    return JSON.stringify(v)
  }
  return v
}

function indent(n: number): string {
  return '  '.repeat(n)
}

function emitScalar(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (typeof value === 'string') {
    if (value.includes('\n')) {
      // Multi-line: rendered by the caller with block scalar.
      return ''
    }
    return quoteIfNeeded(value)
  }
  return JSON.stringify(value)
}

function emitField(key: string, value: unknown, depth: number, lines: string[]): void {
  if (value === undefined || value === null) return
  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${indent(depth)}${key}: []`)
      return
    }
    lines.push(`${indent(depth)}${key}:`)
    for (const item of value) {
      if (item === null || item === undefined) {
        lines.push(`${indent(depth + 1)}- null`)
      } else if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
        lines.push(`${indent(depth + 1)}- ${emitScalar(item)}`)
      } else {
        // Object item: emit each field on its own line under a dash.
        const entries = Object.entries(item as Record<string, unknown>)
        if (entries.length === 0) {
          lines.push(`${indent(depth + 1)}- {}`)
          continue
        }
        const [firstKey, firstVal] = entries[0]
        lines.push(`${indent(depth + 1)}- ${firstKey}: ${emitScalar(firstVal)}`)
        for (let i = 1; i < entries.length; i++) {
          const [k, v] = entries[i]
          emitField(k, v, depth + 2, lines)
        }
      }
    }
    return
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) {
      lines.push(`${indent(depth)}${key}: {}`)
      return
    }
    lines.push(`${indent(depth)}${key}:`)
    for (const [k, v] of entries) emitField(k, v, depth + 1, lines)
    return
  }
  if (typeof value === 'string' && value.includes('\n')) {
    const promptLines = value.split('\n')
    lines.push(`${indent(depth)}${key}: |`)
    for (const pl of promptLines) lines.push(`${indent(depth + 1)}${pl}`)
    return
  }
  lines.push(`${indent(depth)}${key}: ${emitScalar(value)}`)
}

function emitStep(step: CeremonyStep, depth: number, lines: string[]): void {
  // Step header — list item with `type:` as the first field.
  lines.push(`${indent(depth)}- type: ${step.kind}`)
  if (step.label !== undefined) emitField('label', step.label, depth + 1, lines)

  switch (step.kind) {
    case 'route':
    case 'agent_run': {
      const s = step as RouteStepNode | AgentRunStepNode
      if (s.agent !== undefined) emitField('agent', s.agent, depth + 1, lines)
      if (s.prompt !== undefined) emitField('prompt', s.prompt, depth + 1, lines)
      if (s.timeout !== undefined) emitField('timeout', s.timeout, depth + 1, lines)
      break
    }
    case 'approve': {
      const s = step as ApproveStepNode
      if (s.approvers !== undefined) emitField('approvers', s.approvers, depth + 1, lines)
      if (s.request_changes_policy !== undefined) {
        emitField('request_changes_policy', s.request_changes_policy, depth + 1, lines)
      }
      if (s.timeout !== undefined) emitField('timeout', s.timeout, depth + 1, lines)
      break
    }
    case 'fan_out': {
      const s = step as FanOutStepNode
      if (s.split_by !== undefined) emitField('split_by', s.split_by, depth + 1, lines)
      if (s.count !== undefined) emitField('count', s.count, depth + 1, lines)
      if (s.agents !== undefined) emitField('agents', s.agents, depth + 1, lines)
      if (s.merge_strategy !== undefined) {
        emitField('merge_strategy', s.merge_strategy, depth + 1, lines)
      }
      if (s.mode !== undefined && s.mode !== 'serial') emitField('mode', s.mode, depth + 1, lines)
      if (s.steps && s.steps.length > 0) {
        lines.push(`${indent(depth + 1)}steps:`)
        for (const child of s.steps) emitStep(child, depth + 2, lines)
      } else {
        lines.push(`${indent(depth + 1)}steps: []`)
      }
      break
    }
    case 'handoff': {
      const s = step as HandoffStepNode
      if (s.to !== undefined) emitField('to', s.to, depth + 1, lines)
      if (s.message !== undefined) emitField('message', s.message, depth + 1, lines)
      break
    }
  }

  // Trailing extras — preserved verbatim from the input YAML.
  for (const [k, v] of Object.entries(step.extras ?? {})) {
    emitField(k, v, depth + 1, lines)
  }
}

// ---------------------------------------------------------------------------
// Public emitter
// ---------------------------------------------------------------------------

export function graphToCeremonyYaml(graph: CeremonyGraph): string {
  const lines: string[] = []
  const { header } = graph
  lines.push(`name: ${quoteIfNeeded(header.name ?? 'Untitled ceremony')}`)
  if (header.description !== undefined && header.description !== '') {
    emitField('description', header.description, 0, lines)
  }
  for (const [k, v] of Object.entries(header.extras ?? {})) {
    if (RESERVED_HEADER_FIELDS.has(k)) continue
    emitField(k, v, 0, lines)
  }
  // Top-level steps come from the nodes that have no parent.
  const topNodes = graph.nodes.filter((n) => !n.parentId).sort((a, b) => a.index - b.index)
  if (topNodes.length === 0) {
    lines.push('steps: []')
  } else {
    lines.push('steps:')
    for (const n of topNodes) emitStep(n.step, 1, lines)
  }
  return lines.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// YAML parser — handles the subset emitted by graphToCeremonyYaml + most
// hand-written ceremony files (workflow-parser server-side accepts more).
//
// Strategy: indentation-based descent. We tokenise the file into lines
// annotated with their indent depth, then walk them recursively.
// ---------------------------------------------------------------------------

interface RawLine {
  raw: string
  indent: number
  text: string
  lineNo: number
  blank: boolean
}

function tokenise(yaml: string): RawLine[] {
  const out: RawLine[] = []
  const lines = yaml.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const original = lines[i]
    const noTabs = original.replace(/\t/g, '  ')
    const trimmed = noTabs.replace(/\r$/, '')
    const indentMatch = trimmed.match(/^( *)/)
    const ind = indentMatch ? indentMatch[1].length : 0
    const text = trimmed.slice(ind)
    const blank = text === '' || text.startsWith('#')
    out.push({ raw: original, indent: ind, text, lineNo: i + 1, blank })
  }
  return out
}

interface ParsedScalar {
  value: unknown
  block?: boolean
}

function parseInlineScalar(raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === '~' || trimmed.toLowerCase() === 'null') return null
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed)
  if (/^-?\d+\.\d+$/.test(trimmed)) return Number(trimmed)
  if ((trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    try { return JSON.parse(trimmed) as string } catch { return trimmed.slice(1, -1) }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'")
  }
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try { return JSON.parse(trimmed) } catch { return trimmed }
  }
  return trimmed
}

function parseFieldValue(raw: string): ParsedScalar {
  const trimmed = raw.trim()
  if (trimmed === '|' || trimmed === '|-' || trimmed === '|+' || trimmed === '>' || trimmed === '>-' || trimmed === '>+') {
    return { value: '', block: true }
  }
  return { value: parseInlineScalar(raw) }
}

interface ParserState {
  lines: RawLine[]
  pos: number
}

function peek(state: ParserState): RawLine | null {
  while (state.pos < state.lines.length && state.lines[state.pos].blank) state.pos++
  return state.pos < state.lines.length ? state.lines[state.pos] : null
}

function collectBlockScalar(state: ParserState, baseIndent: number): string {
  const buf: string[] = []
  while (state.pos < state.lines.length) {
    const ln = state.lines[state.pos]
    if (ln.blank) { buf.push(''); state.pos++; continue }
    if (ln.indent > baseIndent) {
      const inner = Math.max(0, ln.indent - (baseIndent + 2))
      buf.push(' '.repeat(inner) + ln.text)
      state.pos++
    } else break
  }
  while (buf.length > 0 && buf[buf.length - 1] === '') buf.pop()
  return buf.join('\n')
}

function parseMapping(state: ParserState, indent_: number): Record<string, unknown> {
  const map: Record<string, unknown> = {}
  while (true) {
    const ln = peek(state)
    if (!ln) break
    if (ln.indent < indent_) break
    if (ln.indent !== indent_) break
    const m = ln.text.match(/^([A-Za-z_][\w\-]*)\s*:\s*(.*)$/)
    if (!m) break
    state.pos++
    const key = m[1]
    const rest = m[2]
    if (rest === '') {
      const child = peek(state)
      if (!child) { map[key] = null; continue }
      if (child.indent > indent_) {
        if (child.text.startsWith('- ') || child.text === '-') {
          map[key] = parseSequence(state, child.indent)
        } else {
          map[key] = parseMapping(state, child.indent)
        }
      } else {
        map[key] = null
      }
    } else {
      const parsed = parseFieldValue(rest)
      if (parsed.block) {
        map[key] = collectBlockScalar(state, indent_)
      } else {
        map[key] = parsed.value
      }
    }
  }
  return map
}

function parseSequence(state: ParserState, indent_: number): unknown[] {
  const out: unknown[] = []
  while (true) {
    const ln = peek(state)
    if (!ln) break
    if (ln.indent < indent_) break
    if (ln.indent !== indent_) break
    if (!(ln.text.startsWith('- ') || ln.text === '-')) break
    state.pos++
    const itemRest = ln.text === '-' ? '' : ln.text.slice(2)
    if (itemRest === '') {
      const child = peek(state)
      if (!child) { out.push(null); continue }
      if (child.indent > indent_) {
        out.push(parseMapping(state, child.indent))
      } else {
        out.push(null)
      }
      continue
    }
    const km = itemRest.match(/^([A-Za-z_][\w\-]*)\s*:\s*(.*)$/)
    if (km) {
      const itemMap: Record<string, unknown> = {}
      const k = km[1]
      const rest = km[2]
      const childIndent = indent_ + 2
      if (rest === '') {
        const child = peek(state)
        if (child && child.indent > indent_) {
          if (child.text.startsWith('- ') || child.text === '-') {
            itemMap[k] = parseSequence(state, child.indent)
          } else {
            itemMap[k] = parseMapping(state, child.indent)
          }
        } else {
          itemMap[k] = null
        }
      } else {
        const parsed = parseFieldValue(rest)
        if (parsed.block) {
          itemMap[k] = collectBlockScalar(state, childIndent)
        } else {
          itemMap[k] = parsed.value
        }
      }
      while (true) {
        const nxt = peek(state)
        if (!nxt) break
        if (nxt.indent !== childIndent) break
        if (nxt.text.startsWith('- ') || nxt.text === '-') break
        const sm = nxt.text.match(/^([A-Za-z_][\w\-]*)\s*:\s*(.*)$/)
        if (!sm) break
        state.pos++
        const sKey = sm[1]
        const sRest = sm[2]
        if (sRest === '') {
          const grand = peek(state)
          if (grand && grand.indent > childIndent) {
            if (grand.text.startsWith('- ') || grand.text === '-') {
              itemMap[sKey] = parseSequence(state, grand.indent)
            } else {
              itemMap[sKey] = parseMapping(state, grand.indent)
            }
          } else {
            itemMap[sKey] = null
          }
        } else {
          const parsed = parseFieldValue(sRest)
          if (parsed.block) {
            itemMap[sKey] = collectBlockScalar(state, childIndent)
          } else {
            itemMap[sKey] = parsed.value
          }
        }
      }
      out.push(itemMap)
      continue
    }
    const parsed = parseFieldValue(itemRest)
    if (parsed.block) {
      out.push(collectBlockScalar(state, indent_ + 2))
    } else {
      out.push(parsed.value)
    }
  }
  return out
}

function parseDocument(yaml: string): Record<string, unknown> {
  const state: ParserState = { lines: tokenise(yaml), pos: 0 }
  const first = peek(state)
  if (!first) return {}
  return parseMapping(state, first.indent)
}

// ---------------------------------------------------------------------------
// Document → CeremonyGraph
// ---------------------------------------------------------------------------

function pickReservedFields(raw: Record<string, unknown>, reserved: Set<string>): {
  picked: Record<string, unknown>
  extras: Record<string, unknown>
} {
  const picked: Record<string, unknown> = {}
  const extras: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (reserved.has(k)) picked[k] = v
    else extras[k] = v
  }
  return { picked, extras }
}

function rawStepToCeremonyStep(raw: unknown): CeremonyStep {
  if (!raw || typeof raw !== 'object') {
    return { kind: 'agent_run', extras: {} } satisfies AgentRunStepNode
  }
  const obj = raw as Record<string, unknown>
  const type = String(obj.type ?? 'agent_run') as StepKind
  switch (type) {
    case 'route': {
      const { picked, extras } = pickReservedFields(obj, RESERVED_FIELDS_ROUTE)
      const node: RouteStepNode = { kind: 'route', extras }
      if (typeof picked.label === 'string') node.label = picked.label
      if (typeof picked.agent === 'string') node.agent = picked.agent
      if (typeof picked.prompt === 'string') node.prompt = picked.prompt
      if (typeof picked.timeout === 'string') node.timeout = picked.timeout
      return node
    }
    case 'approve': {
      const { picked, extras } = pickReservedFields(obj, RESERVED_FIELDS_APPROVE)
      const node: ApproveStepNode = { kind: 'approve', extras }
      if (typeof picked.label === 'string') node.label = picked.label
      if (Array.isArray(picked.approvers)) {
        node.approvers = (picked.approvers as unknown[]).map((a) =>
          typeof a === 'string'
            ? a
            : typeof a === 'object' && a && (a as Record<string, unknown>).ref
              ? String((a as Record<string, unknown>).ref)
              : String(a),
        )
      }
      const policy = picked.request_changes_policy
      if (policy === 'first' || policy === 'majority' || policy === 'all') {
        node.request_changes_policy = policy
      }
      if (typeof picked.timeout === 'string') node.timeout = picked.timeout
      return node
    }
    case 'fan_out': {
      const { picked, extras } = pickReservedFields(obj, RESERVED_FIELDS_FAN_OUT)
      const node: FanOutStepNode = { kind: 'fan_out', extras, steps: [] }
      if (typeof picked.label === 'string') node.label = picked.label
      const sb = picked.split_by
      if (sb === 'labels' || sb === 'agents' || sb === 'count') node.split_by = sb
      if (typeof picked.count === 'number') node.count = picked.count
      if (Array.isArray(picked.agents)) node.agents = (picked.agents as unknown[]).map(String)
      const ms = picked.merge_strategy
      if (ms === 'all' || ms === 'any' || ms === 'first') node.merge_strategy = ms
      const mode = picked.mode
      if (mode === 'serial' || mode === 'parallel') node.mode = mode
      if (Array.isArray(picked.steps)) {
        node.steps = (picked.steps as unknown[]).map((s) => rawStepToCeremonyStep(s))
      }
      return node
    }
    case 'handoff': {
      const { picked, extras } = pickReservedFields(obj, RESERVED_FIELDS_HANDOFF)
      const node: HandoffStepNode = { kind: 'handoff', extras }
      if (typeof picked.label === 'string') node.label = picked.label
      if (typeof picked.to === 'string') node.to = picked.to
      if (typeof picked.message === 'string') node.message = picked.message
      return node
    }
    case 'agent_run':
    default: {
      const { picked, extras } = pickReservedFields(obj, RESERVED_FIELDS_AGENT_RUN)
      const node: AgentRunStepNode = { kind: 'agent_run', extras }
      if (typeof picked.label === 'string') node.label = picked.label
      if (typeof picked.agent === 'string') node.agent = picked.agent
      if (typeof picked.prompt === 'string') node.prompt = picked.prompt
      if (typeof picked.timeout === 'string') node.timeout = picked.timeout
      return node
    }
  }
}

function buildGraphFromHeaderAndSteps(
  header: CeremonyHeader,
  steps: CeremonyStep[],
): CeremonyGraph {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  steps.forEach((step, i) => {
    const id = `step-${i}`
    nodes.push({ id, index: i, step })
    if (i > 0) {
      const prev = `step-${i - 1}`
      edges.push({
        id: `${prev}->${id}`,
        source: prev,
        target: id,
        kind: 'sequence',
      })
    }
    if (step.kind === 'fan_out') {
      const fan = step as FanOutStepNode
      fan.steps.forEach((child, ci) => {
        const childId = `${id}.child-${ci}`
        nodes.push({ id: childId, index: ci, parentId: id, step: child })
        edges.push({
          id: `${id}=>${childId}`,
          source: id,
          target: childId,
          kind: 'fan_out_child',
        })
      })
    }
  })

  return { header, nodes, edges }
}

/**
 * Parse a ceremony YAML document into a CeremonyGraph projection.
 */
export function ceremonyYamlToGraph(yaml: string): CeremonyGraph {
  if (!yaml || !yaml.trim()) {
    return {
      header: { name: 'Untitled ceremony', extras: {} },
      nodes: [],
      edges: [],
    }
  }
  let doc: Record<string, unknown>
  try {
    doc = parseDocument(yaml)
  } catch {
    return {
      header: { name: 'Untitled ceremony', extras: {} },
      nodes: [],
      edges: [],
    }
  }
  const headerExtras: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(doc)) {
    if (!RESERVED_HEADER_FIELDS.has(k)) headerExtras[k] = v
  }
  const header: CeremonyHeader = {
    name: typeof doc.name === 'string' ? doc.name : 'Untitled ceremony',
    extras: headerExtras,
  }
  if (typeof doc.description === 'string') header.description = doc.description

  const rawSteps = Array.isArray(doc.steps) ? (doc.steps as unknown[]) : []
  const steps = rawSteps.map((s) => rawStepToCeremonyStep(s))

  return buildGraphFromHeaderAndSteps(header, steps)
}

// ---------------------------------------------------------------------------
// Helpers exported for use by the visual canvas + tests
// ---------------------------------------------------------------------------

export function blankStep(kind: StepKind): CeremonyStep {
  switch (kind) {
    case 'route':
      return { kind: 'route', extras: {} }
    case 'approve':
      return { kind: 'approve', request_changes_policy: 'first', timeout: '24h', extras: {} }
    case 'fan_out':
      return {
        kind: 'fan_out',
        split_by: 'agents',
        merge_strategy: 'all',
        mode: 'serial',
        steps: [{ kind: 'agent_run', label: 'Per-shard run', extras: {} } as AgentRunStepNode],
        extras: {},
      }
    case 'handoff':
      return { kind: 'handoff', extras: {} }
    case 'agent_run':
    default:
      return { kind: 'agent_run', extras: {} }
  }
}

/**
 * Rebuild a graph from the given header + linear list of top-level steps.
 * Used after the visual canvas mutates step ordering or content.
 */
export function rebuildGraph(header: CeremonyHeader, steps: CeremonyStep[]): CeremonyGraph {
  return buildGraphFromHeaderAndSteps(header, steps)
}

/**
 * Return the top-level (non-child) steps of a graph in document order.
 */
export function topLevelSteps(graph: CeremonyGraph): CeremonyStep[] {
  return graph.nodes
    .filter((n) => !n.parentId)
    .sort((a, b) => a.index - b.index)
    .map((n) => n.step)
}

import { promises as fs } from 'fs'

export interface RoutingRule {
  priority: number      // order in file (lower = higher priority)
  pattern: string       // the match pattern
  matchType: 'label' | 'keyword' | 'assignee' | 'catchall'
  agentName: string     // which agent to route to
  rawRule: string       // original line for audit
}

// Column names that identify the "agent" column in a routing table
const AGENT_COLUMN_NAMES = new Set(['primary', 'route to', 'who', 'agent', 'action'])

// Column names that identify the "pattern" column
const PATTERN_COLUMN_NAMES = new Set(['work type', 'label', 'signal', 'pattern', 'type'])

/**
 * Parse a markdown table row into trimmed cells.
 * Returns null if the row is a separator (---|---) line.
 */
function parseTableRow(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|')) return null
  // Separator line detection: only contains |, -, :, and spaces
  if (/^\|[\s\-:|]+\|$/.test(trimmed)) return null
  return trimmed
    .split('|')
    .slice(1, -1) // drop leading/trailing empty strings from outer pipes
    .map((cell) => cell.trim())
}

/**
 * Infer the matchType for a pattern string.
 *
 * Rules (in priority order):
 *   - backtick-wrapped labels like `squad` or `squad:name` → 'label'
 *   - starts with '#' or 'label:' → 'label'
 *   - is '*', 'all', 'catchall', or contains only wildcards → 'catchall'
 *   - else → 'keyword'
 */
function inferMatchType(pattern: string): RoutingRule['matchType'] {
  const p = pattern.replace(/`/g, '').trim()
  if (pattern.startsWith('#') || pattern.toLowerCase().startsWith('label:')) return 'label'
  // backtick-wrapped labels (markdown inline code used in Issue Routing table)
  if (/^`[^`]+`$/.test(pattern.trim())) return 'label'
  if (p === '*' || p.toLowerCase() === 'all' || p.toLowerCase() === 'catchall') return 'catchall'
  return 'keyword'
}

/**
 * Strip markdown formatting from a cell value.
 */
function cleanCell(cell: string): string {
  return cell
    .replace(/`/g, '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .trim()
}

/**
 * Parse .squad/routing.md and return all routing rules in file order (priority).
 *
 * Strategy:
 *   - Find every markdown table (pipe-delimited rows).
 *   - Detect header row to locate the pattern column and agent column.
 *   - Emit one RoutingRule per data row, skipping rows with no agent or
 *     where the agent cell looks like explanatory text (e.g. "Triage: …").
 */
export async function parseRoutingFile(routingMdPath: string): Promise<RoutingRule[]> {
  const content = await fs.readFile(routingMdPath, 'utf-8')
  const lines = content.split('\n')
  const rules: RoutingRule[] = []
  let priority = 0

  let inTable = false
  let patternColIdx = -1
  let agentColIdx = -1
  let headers: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const cells = parseTableRow(line)

    if (cells === null) {
      // Either separator line or non-table line — reset table state if not a separator
      if (line.trim().startsWith('|')) {
        // separator line — stays in table, skip
        continue
      }
      // Not a table line at all — reset
      inTable = false
      patternColIdx = -1
      agentColIdx = -1
      headers = []
      continue
    }

    if (!inTable) {
      // This is a header row
      headers = cells.map((c) => c.toLowerCase().replace(/`/g, '').trim())
      patternColIdx = headers.findIndex((h) => PATTERN_COLUMN_NAMES.has(h))
      agentColIdx = headers.findIndex((h) => AGENT_COLUMN_NAMES.has(h))

      // Fall back: first column is pattern, second is agent
      if (patternColIdx === -1) patternColIdx = 0
      if (agentColIdx === -1) agentColIdx = 1

      inTable = true
      continue
    }

    // Data row
    if (cells.length <= Math.max(patternColIdx, agentColIdx)) continue

    const rawPattern = cells[patternColIdx] ?? ''
    const rawAgent = cells[agentColIdx] ?? ''

    const pattern = cleanCell(rawPattern)
    const agentRaw = cleanCell(rawAgent)

    // Skip empty or header-like rows
    if (!pattern || !agentRaw) continue
    // Skip if agent cell looks like explanatory text (contains ':' and spaces = "Triage: analyze…")
    if (agentRaw.includes(':') && agentRaw.split(' ').length > 2) continue
    // Skip separator or header repetitions
    if (pattern.toLowerCase() === headers[patternColIdx]) continue

    // Extract first agent name (e.g., "McManus" from "McManus (architecture sign-off)")
    const agentName = agentRaw.split(/[\s(,]/)[0]

    rules.push({
      priority: priority++,
      pattern,
      matchType: inferMatchType(rawPattern),
      agentName,
      rawRule: line.trim(),
    })
  }

  return rules
}

/**
 * Returns true if the given routing rule matches the issue.
 *
 * - 'label'    → issue has a label whose name includes the pattern (case-insensitive)
 * - 'catchall' → always matches
 * - 'keyword'  → pattern words appear in the issue title or body (case-insensitive)
 * - 'assignee' → matches issue.assignee (not used in current routing.md, reserved)
 */
export function matchRule(
  rule: RoutingRule,
  issue: { title: string; labels: string[]; body?: string }
): boolean {
  const pattern = rule.pattern.toLowerCase()

  switch (rule.matchType) {
    case 'catchall':
      return true

    case 'label': {
      const stripped = pattern.replace(/^label:/, '').trim()
      return issue.labels.some((l) => l.toLowerCase().includes(stripped))
    }

    case 'assignee':
      // Reserved — no current routing rules use this
      return false

    case 'keyword': {
      const haystack = `${issue.title} ${issue.body ?? ''}`.toLowerCase()
      // Match if any significant word from the pattern appears in the haystack
      const words = pattern.split(/[\s,/]+/).filter((w) => w.length > 3)
      if (words.length === 0) {
        return haystack.includes(pattern)
      }
      return words.some((w) => haystack.includes(w))
    }
  }
}

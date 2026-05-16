/**
 * CeremonyBadges — reusable Fluent2 Badge components for Trigger, Kind, and Scope.
 *
 * Color mapping (canonical — follow this in any future list page, e.g. Schedules):
 *
 *   Trigger
 *     manual           → appearance="outline" color="subtle"
 *     on_issue_entry   → appearance="filled"  color="brand"
 *     on_event         → appearance="filled"  color="brand"
 *     on_schedule      → appearance="filled"  color="informative"
 *
 *   Kind
 *     workflow         → appearance="outline" color="warning"
 *     ceremony         → appearance="outline" color="subtle"
 *     review_policy    → appearance="outline" color="severe"
 *     narrative        → appearance="outline" color="success"
 *
 *   Scope (from triggerConfig.scope; only meaningful for on_issue_entry)
 *     project          → Project
 *     board            → Board
 *     task             → Task
 */

import { Badge } from '@fluentui/react-components'
import { Clipboard20Regular, Target20Regular, Globe20Regular } from '@fluentui/react-icons'
import type { TriggerKind, CeremonyKind, CeremonyOrigin } from '../../api/ceremonies.ts'

export function TriggerBadge({ kind }: { kind: TriggerKind | undefined | null }) {
  if (!kind) return <Badge appearance="outline" color="subtle">—</Badge>
  switch (kind) {
    case 'manual':
      return <Badge appearance="outline" color="subtle">manual</Badge>
    case 'on_issue_entry':
      return <Badge appearance="filled" color="brand">issue entry</Badge>
    case 'on_event':
      return <Badge appearance="filled" color="brand">on event</Badge>
    case 'on_schedule':
      return <Badge appearance="filled" color="informative">scheduled</Badge>
  }
}

export function KindBadge({ kind }: { kind: CeremonyKind | undefined | null }) {
  if (!kind) return <Badge appearance="outline" color="subtle">—</Badge>
  switch (kind) {
    case 'narrative':
      return <Badge appearance="outline" color="success">narrative</Badge>
    case 'workflow':
      return <Badge appearance="outline" color="warning">workflow</Badge>
    case 'review_policy':
      return <Badge appearance="outline" color="severe">review policy</Badge>
    case 'ceremony':
      return <Badge appearance="outline" color="subtle">ceremony</Badge>
    default:
      return <Badge appearance="outline" color="subtle">{kind}</Badge>
  }
}

export function ScopeBadge({
  triggerKind,
  triggerConfig,
}: {
  triggerKind: TriggerKind | undefined | null
  triggerConfig: Record<string, unknown> | undefined | null
}) {
  if (triggerKind !== 'on_issue_entry') return null
  const scope = (triggerConfig?.scope as string | undefined) ?? 'project'
  switch (scope) {
    case 'board':
      return <Badge appearance="outline" color="informative"><Clipboard20Regular style={{ verticalAlign: 'middle', marginRight: '3px' }} />Board</Badge>
    case 'task':
      return <Badge appearance="outline" color="brand"><Target20Regular style={{ verticalAlign: 'middle', marginRight: '3px' }} />Task</Badge>
    default:
      return <Badge appearance="outline" color="subtle"><Globe20Regular style={{ verticalAlign: 'middle', marginRight: '3px' }} />Project</Badge>
  }
}

/**
 * CER-1: OriginBadge — shows where a ceremony came from.
 *
 * Color mapping (Fluent2 tokens via color prop):
 *   built-in     → "brand"       (colorBrandBackground2 family)
 *   yaml-import  → "informative" (colorPaletteBlueBackground2 family)
 *   conjure-llm  → "success"     (closest to colorPaletteRoyalBlueBackground2 in Fluent2 Badge API)
 *   user-created → "subtle"      (colorNeutralBackground3 family)
 */
export function OriginBadge({ origin }: { origin: CeremonyOrigin | undefined | null }) {
  switch (origin) {
    case 'built-in':
      return <Badge appearance="filled" color="brand">Built-in</Badge>
    case 'yaml-import':
      return <Badge appearance="filled" color="informative">YAML</Badge>
    case 'conjure-llm':
      return <Badge appearance="filled" color="success">Conjure</Badge>
    case 'user-created':
    default:
      return <Badge appearance="outline" color="subtle">User</Badge>
  }
}

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
 *     project          → 🌐 Project
 *     board            → 📋 Board
 *     task             → 🎯 Task
 */

import { Badge } from '@fluentui/react-components'
import type { TriggerKind, CeremonyKind } from '../../api/ceremonies.ts'

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
      return <Badge appearance="outline" color="informative">📋 Board</Badge>
    case 'task':
      return <Badge appearance="outline" color="brand">🎯 Task</Badge>
    default:
      return <Badge appearance="outline" color="subtle">🌐 Project</Badge>
  }
}

/**
 * CeremonyBadges — reusable Fluent2 Badge components for Trigger and Kind.
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
 *     narrative        → appearance="outline" color="success"
 *     workflow         → appearance="outline" color="warning"
 *     review_policy    → appearance="outline" color="severe"
 *     ceremony         → appearance="outline" color="subtle"
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
      return <Badge appearance="outline" color="severe">review</Badge>
    case 'ceremony':
      return <Badge appearance="outline" color="subtle">ceremony</Badge>
    default:
      return <Badge appearance="outline" color="subtle">{kind}</Badge>
  }
}

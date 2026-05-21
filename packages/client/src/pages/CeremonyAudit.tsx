/**
 * CeremonyAudit.tsx — CER-8 diagnostics page.
 *
 * Route: /projects/:id/ceremonies/audit
 *
 * Shows:
 *  - Aggregate counts: total, byOrigin, byTrigger, byStatus
 *  - Orphan table: active ceremonies with no recent runs
 *  - Dead table: active ceremonies whose trigger cannot fire
 */

import { useState } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useProject } from '../api/projects.ts'
import { useCeremonyAudit, type CeremonyOrphan, type CeremonyOrigin } from '../api/ceremonies.ts'
import PageHeader from '../components/layout/PageHeader.tsx'
import { OriginBadge } from '../components/ceremony/CeremonyBadges.tsx'
import { PageLoading } from '../components/loading/index.tsx'
import {
  Button,
  Caption1,
  Body1,
  Subtitle2,
  Badge,
  tokens,
  Table,
  TableHeader,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
  TableCellLayout,
  Select,
} from '@fluentui/react-components'
import { ArrowLeft20Regular, Warning20Regular, Delete20Regular } from '@fluentui/react-icons'

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

function StatCard({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
        background: accent ? tokens.colorBrandBackground2 : tokens.colorNeutralBackground3,
        borderRadius: tokens.borderRadiusMedium,
        minWidth: 120,
        gap: tokens.spacingVerticalXS,
      }}
    >
      <span
        style={{
          fontSize: tokens.fontSizeHero700,
          fontWeight: tokens.fontWeightBold,
          color: accent ? tokens.colorBrandForeground1 : tokens.colorNeutralForeground1,
          lineHeight: 1,
        }}
      >
        {value}
      </span>
      <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>{label}</Caption1>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Diagnostic table (orphans + dead)
// ---------------------------------------------------------------------------

function DiagnosticTable({
  icon,
  title,
  description,
  items,
  emptyMessage,
  onNavigate,
}: {
  icon: React.ReactNode
  title: string
  description: string
  items: CeremonyOrphan[]
  emptyMessage: string
  onNavigate: (id: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS }}>
        {icon}
        <Subtitle2>{title}</Subtitle2>
        <Badge appearance="filled" color={items.length > 0 ? 'warning' : 'subtle'} size="small">
          {items.length}
        </Badge>
      </div>
      <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>{description}</Caption1>
      {items.length === 0 ? (
        <Caption1 style={{ color: tokens.colorNeutralForeground3, fontStyle: 'italic' }}>
          {emptyMessage}
        </Caption1>
      ) : (
        <Table size="small" style={{ width: '100%' }}>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Reason</TableHeaderCell>
              <TableHeaderCell style={{ width: 100 }}>Action</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <TableCellLayout style={{ fontWeight: tokens.fontWeightSemibold }}>
                    {item.name}
                  </TableCellLayout>
                </TableCell>
                <TableCell>
                  <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>{item.reason}</Caption1>
                </TableCell>
                <TableCell>
                  <Button
                    appearance="subtle"
                    size="small"
                    onClick={() => onNavigate(item.id)}
                  >
                    View
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

type OriginFilter = 'all' | CeremonyOrigin

export default function CeremonyAudit() {
  const { id } = useParams<{ id: string }>()
  const projectId = id ?? ''
  const navigate = useNavigate()

  const { data: project } = useProject(projectId)
  const { data: audit, isLoading, isError, refetch } = useCeremonyAudit(projectId)

  const [orphanFilter, setOrphanFilter] = useState<OriginFilter>('all')
  const [deadFilter, setDeadFilter] = useState<OriginFilter>('all')

  const toolbar = (
    <Button
      appearance="subtle"
      icon={<ArrowLeft20Regular />}
      onClick={() => navigate(`/projects/${projectId}/ceremonies`)}
    >
      Back to ceremonies
    </Button>
  )

  if (isLoading) {
    return (
      <PageLoading
        header={
          <PageHeader
            eyebrow={project?.name?.toUpperCase()}
            title="Ceremony Audit"
            description="Diagnostics: orphan detection, dead trigger analysis, and count breakdowns."
            actions={toolbar}
          />
        }
        label="Running audit…"
      />
    )
  }

  if (isError || !audit) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: tokens.colorNeutralBackground1 }}>
        <PageHeader
          eyebrow={project?.name?.toUpperCase()}
          title="Ceremony Audit"
          description="Diagnostics: orphan detection, dead trigger analysis, and count breakdowns."
          actions={toolbar}
        />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Body1 style={{ color: tokens.colorPaletteRedForeground1 }}>
            Failed to load audit report.{' '}
            <Button appearance="subtle" onClick={() => void refetch()}>Retry</Button>
          </Body1>
        </div>
      </div>
    )
  }

  const origins: CeremonyOrigin[] = ['core', 'built-in', 'yaml-import', 'conjure-llm', 'user-created']
  const originLabels: Record<CeremonyOrigin, string> = {
    'core': 'Core',
    'built-in': 'Built-in',
    'yaml-import': 'YAML',
    'conjure-llm': 'Conjure',
    'user-created': 'User',
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: tokens.colorNeutralBackground1,
        overflow: 'auto',
      }}
    >
      <PageHeader
        eyebrow={project?.name?.toUpperCase()}
        title="Ceremony Audit"
        description="Diagnostics: orphan detection, dead trigger analysis, and count breakdowns."
        actions={toolbar}
      />

      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: tokens.spacingVerticalXL,
          paddingTop: tokens.spacingVerticalL,
          paddingBottom: tokens.spacingVerticalXXL,
          paddingLeft: tokens.spacingHorizontalXXL,
          paddingRight: tokens.spacingHorizontalXXL,
        }}
      >
        {/* Summary stats */}
        <section>
          <div style={{ display: 'flex', gap: tokens.spacingHorizontalM, flexWrap: 'wrap', marginTop: tokens.spacingVerticalS }}>
            <StatCard label="Total" value={audit.total} accent />
            <StatCard label="Orphans" value={audit.orphans.length} />
            <StatCard label="Dead" value={audit.dead.length} />
          </div>
        </section>

        {/* By Origin */}
        <section>
          <Subtitle2>By Origin</Subtitle2>
          <div style={{ display: 'flex', gap: tokens.spacingHorizontalM, flexWrap: 'wrap', marginTop: tokens.spacingVerticalS }}>
            {origins.map((o) => (
              <div
                key={o}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: tokens.spacingHorizontalXS,
                  padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
                  background: tokens.colorNeutralBackground3,
                  borderRadius: tokens.borderRadiusMedium,
                }}
              >
                <OriginBadge origin={o} />
                <Caption1 style={{ color: tokens.colorNeutralForeground1, fontWeight: tokens.fontWeightSemibold }}>
                  {audit.byOrigin[o] ?? 0}
                </Caption1>
              </div>
            ))}
          </div>
        </section>

        {/* By Trigger */}
        <section>
          <Subtitle2>By Trigger</Subtitle2>
          <div style={{ display: 'flex', gap: tokens.spacingHorizontalM, flexWrap: 'wrap', marginTop: tokens.spacingVerticalS }}>
            {Object.entries(audit.byTrigger).map(([trigger, cnt]) => (
              <div
                key={trigger}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: tokens.spacingHorizontalXS,
                  padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
                  background: tokens.colorNeutralBackground3,
                  borderRadius: tokens.borderRadiusMedium,
                }}
              >
                <Badge appearance="outline" color="subtle">{trigger}</Badge>
                <Caption1 style={{ color: tokens.colorNeutralForeground1, fontWeight: tokens.fontWeightSemibold }}>
                  {cnt}
                </Caption1>
              </div>
            ))}
            {Object.keys(audit.byTrigger).length === 0 && (
              <Caption1 style={{ color: tokens.colorNeutralForeground3, fontStyle: 'italic' }}>No data</Caption1>
            )}
          </div>
        </section>

        {/* By Status */}
        <section>
          <Subtitle2>By Status</Subtitle2>
          <div style={{ display: 'flex', gap: tokens.spacingHorizontalM, flexWrap: 'wrap', marginTop: tokens.spacingVerticalS }}>
            {Object.entries(audit.byStatus).map(([status, cnt]) => (
              <div
                key={status}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: tokens.spacingHorizontalXS,
                  padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
                  background: tokens.colorNeutralBackground3,
                  borderRadius: tokens.borderRadiusMedium,
                }}
              >
                <Badge appearance="outline" color="subtle">{status}</Badge>
                <Caption1 style={{ color: tokens.colorNeutralForeground1, fontWeight: tokens.fontWeightSemibold }}>
                  {cnt}
                </Caption1>
              </div>
            ))}
            {Object.keys(audit.byStatus).length === 0 && (
              <Caption1 style={{ color: tokens.colorNeutralForeground3, fontStyle: 'italic' }}>No data</Caption1>
            )}
          </div>
        </section>

        <hr style={{ border: 0, borderTop: `1px solid ${tokens.colorNeutralStroke2}`, margin: 0 }} />

        {/* Orphans */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: tokens.spacingVerticalS }}>
            <span />
            <Select
              aria-label="Filter orphans by origin"
              value={orphanFilter}
              onChange={(_, d) => setOrphanFilter(d.value as OriginFilter)}
              size="small"
            >
              <option value="all">All origins</option>
              {origins.map((o) => (
                <option key={o} value={o}>{originLabels[o]}</option>
              ))}
            </Select>
          </div>
          <DiagnosticTable
            icon={<Warning20Regular style={{ color: tokens.colorPaletteYellowForeground1 }} />}
            title="Orphaned ceremonies"
            description="Active ceremonies with no runs in the last 30 days. Consider deactivating or triggering these."
            items={audit.orphans.filter(
              (_item) => orphanFilter === 'all',
            )}
            emptyMessage="No orphans detected."
            onNavigate={(id) => navigate(`/projects/${projectId}/ceremonies/${id}`)}
          />
        </section>

        {/* Dead */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: tokens.spacingVerticalS }}>
            <span />
            <Select
              aria-label="Filter dead ceremonies by origin"
              value={deadFilter}
              onChange={(_, d) => setDeadFilter(d.value as OriginFilter)}
              size="small"
            >
              <option value="all">All origins</option>
              {origins.map((o) => (
                <option key={o} value={o}>{originLabels[o]}</option>
              ))}
            </Select>
          </div>
          <DiagnosticTable
            icon={<Delete20Regular style={{ color: tokens.colorPaletteRedForeground1 }} />}
            title="Dead ceremonies"
            description="Active ceremonies whose trigger condition cannot currently fire (e.g. GitHub trigger but no GitHub integration)."
            items={audit.dead.filter(
              (_item) => deadFilter === 'all',
            )}
            emptyMessage="No dead ceremonies detected."
            onNavigate={(id) => navigate(`/projects/${projectId}/ceremonies/${id}`)}
          />
        </section>
      </div>
    </div>
  )
}

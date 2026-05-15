import React from 'react'
import { useParams, useNavigate } from 'react-router'
import {
  Title2,
  Body1,
  Caption1,
  Button,
  Badge,
  TabList,
  Tab,
  tokens,
  type SelectTabData,
  type SelectTabEvent,
} from '@fluentui/react-components'
import { ArrowSync24Regular, Checkmark24Regular, Warning24Regular, Dismiss24Regular } from '@fluentui/react-icons'
import { useDiagnostics, useRunDiagnostics, type DiagnosticCheck } from '../api/diagnostics.ts'
import { useProject } from '../api/projects.ts'
import PageHeader from '../components/layout/PageHeader.tsx'
import { safeAbsoluteTime } from '../utils/dates.ts'

// ---------------------------------------------------------------------------
// Status icon
// ---------------------------------------------------------------------------
function StatusIcon({ status }: { status: DiagnosticCheck['status'] }) {
  if (status === 'ok') return <Checkmark24Regular style={{ color: tokens.colorPaletteGreenForeground1 }} />
  if (status === 'warn') return <Warning24Regular style={{ color: tokens.colorPaletteYellowForeground1 }} />
  return <Dismiss24Regular style={{ color: tokens.colorPaletteRedForeground1 }} />
}

// ---------------------------------------------------------------------------
// Simple per-row error boundary — one bad row must not crash the page.
// ---------------------------------------------------------------------------
interface CheckCardErrorBoundaryState {
  hasError: boolean
}

class CheckCardErrorBoundary extends React.Component<
  { children: React.ReactNode },
  CheckCardErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): CheckCardErrorBoundaryState {
    return { hasError: true }
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: '12px 16px',
            background: 'var(--surface)',
            border: `1px solid ${tokens.colorPaletteRedBorder1}`,
            borderRadius: 8,
            color: tokens.colorPaletteRedForeground1,
          }}
        >
          <Caption1>Failed to render this check — data may be malformed.</Caption1>
        </div>
      )
    }
    return this.props.children
  }
}

// ---------------------------------------------------------------------------
// Single check card
// ---------------------------------------------------------------------------
function CheckCard({ check }: { check: DiagnosticCheck }) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: `1px solid ${check.status === 'fail' ? tokens.colorPaletteRedBorder1 : check.status === 'warn' ? tokens.colorPaletteYellowBorder1 : 'var(--border)'}`,
        borderRadius: 10,
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalS,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalM }}>
        <StatusIcon status={check.status} />
        <Title2 as="h3" style={{ margin: 0, fontSize: '15px', flex: 1 }}>
          {check.label}
        </Title2>
        <Caption1 style={{ color: tokens.colorNeutralForeground3, whiteSpace: 'nowrap' }}>
          {check.durationMs} ms
        </Caption1>
      </div>

      {check.detail && (
        <Body1 style={{ color: tokens.colorNeutralForeground2, margin: 0 }}>
          {check.detail}
        </Body1>
      )}

      {check.remediation && (
        <Caption1
          style={{
            color: tokens.colorPaletteYellowForeground2,
            background: tokens.colorPaletteYellowBackground1,
            borderRadius: 4,
            padding: '4px 8px',
            display: 'block',
          }}
        >
          💡 {check.remediation}
        </Caption1>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Diagnostics page
// ---------------------------------------------------------------------------
export default function Diagnostics() {
  // Supports both /diagnostics (global) and /projects/:id/diagnostics
  const { id: projectId } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const { data: project } = useProject(projectId ?? '')

  const { data, isLoading, error } = useDiagnostics({ projectId })
  const runMutation = useRunDiagnostics({ projectId })

  const is404 =
    error instanceof Error && error.message.startsWith('API 404')

  // Wave 10 C8: scope is explicit — show "Global" or "Project: {name}" badge
  // in the header and a tab strip when a project is in context, so the user
  // never silently hops between scopes.
  const scopeKind: 'global' | 'project' = projectId ? 'project' : 'global'
  const scopeLabel = scopeKind === 'global'
    ? 'Global · across all projects'
    : `Project: ${project?.name ?? '…'}`

  function handleScopeChange(_e: SelectTabEvent, data: SelectTabData) {
    const next = data.value as 'global' | 'project'
    if (next === scopeKind) return
    if (next === 'global') {
      void navigate('/diagnostics')
    } else if (projectId) {
      void navigate(`/projects/${projectId}/diagnostics`)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PageHeader
        eyebrow={scopeLabel.toUpperCase()}
        title="Diagnostics"
        description="System health checks · auto-refreshes every 30 s"
        actions={
          <>
            <Badge
              appearance="outline"
              color={scopeKind === 'global' ? 'informative' : 'brand'}
            >
              {scopeKind === 'global' ? 'Global' : 'Project'}
            </Badge>
            <Button
              appearance="primary"
              icon={<ArrowSync24Regular />}
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isPending}
            >
              {runMutation.isPending ? 'Running…' : 'Re-run all'}
            </Button>
          </>
        }
      />

      {/* Wave 10 C8: when in a project context, surface a tab strip so users
          can pivot to global without sidebar nav (which collapses the project
          group jarringly). The tab is hidden when accessed globally. */}
      {projectId && (
        <div style={{ padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalXXL} 0` }}>
          <TabList selectedValue={scopeKind} onTabSelect={handleScopeChange}>
            <Tab value="project">This project</Tab>
            <Tab value="global">Global · all projects</Tab>
          </TabList>
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
        {isLoading && (
          <Body1 style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>
            Loading diagnostics…
          </Body1>
        )}

        {is404 && (
          <Body1 style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>
            Diagnostics service not available yet.
          </Body1>
        )}

        {!isLoading && error && !is404 && (
          <Body1 style={{ display: 'block', color: tokens.colorPaletteRedForeground1 }}>
            {error.message}
          </Body1>
        )}

        {data && (
          <>
            <Caption1
              style={{
                display: 'block',
                color: tokens.colorNeutralForeground3,
                marginBottom: tokens.spacingVerticalL,
              }}
            >
              Generated {safeAbsoluteTime(data.generatedAt)} · total {data.durationMs} ms
            </Caption1>

            <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM }}>
              {data.checks.map((check) => (
                <CheckCardErrorBoundary key={check.id}>
                  <CheckCard check={check} />
                </CheckCardErrorBoundary>
              ))}
            </div>

            {data.checks.length === 0 && (
              <Body1 style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>
                No checks returned.
              </Body1>
            )}
          </>
        )}
      </div>
    </div>
  )
}

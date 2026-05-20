/**
 * Heartbeat page — Wave 10 B3 (page-level wiring only).
 *
 * Reads /api/heartbeat/status on mount + polls /api/heartbeat/sweeps?since=
 * for incremental sweep updates. Stream B owns the data plumbing only; visual
 * polish (badges, layout) for this page is Stream C territory.
 */
import { useEffect, useRef, useState } from 'react'
import { Title2, Body1, Caption1, Badge, tokens } from '@fluentui/react-components'
import { useParams } from 'react-router'
import PageHeader from '../components/layout/PageHeader.tsx'
import { SweepTimeline } from '../components/heartbeat/SweepTimeline.tsx'
import { apiFetch } from '../api/client.ts'
import { wsClient } from '../realtime/ws-client.ts'

interface SweepStatus {
  id:         string
  label:      string
  description: string
  scope:      'system' | 'project' | 'mixed'
  intervalMs: number
  enabled:    boolean
  lastResult?: { acted: number; errors: number; details?: string }
  lastRunAt?: string
  nextRunAt?: string
  lastError?: string
}

interface SweepEvent {
  seq:        number
  ts:         string
  sweepId:    string
  outcome:    'completed' | 'error'
  durationMs: number
  result?:    { acted: number; errors: number; details?: string; projectIds?: string[] }
  error?:     string
}

interface HeartbeatSnapshot {
  active:     boolean
  lastTickAt: string | null
  lastError:  string | null
  sweeps:     SweepStatus[]
  recent: {
    sweeps:   SweepEvent[]
    cursor:   number
    capacity: number
  }
}

// ---------------------------------------------------------------------------
// Section card
// ---------------------------------------------------------------------------
function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: `1px solid var(--border)`,
        borderRadius: 10,
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalS,
      }}
    >
      <Title2 as="h3" style={{ margin: 0, fontSize: '15px' }}>
        {title}
      </Title2>
      {children}
    </div>
  )
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const t = new Date(iso).getTime()
  const diff = Date.now() - t
  if (diff < 1_500) return 'just now'
  if (diff < 60_000) return `${Math.round(diff / 1_000)}s ago`
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`
  return new Date(t).toLocaleString()
}

// ---------------------------------------------------------------------------
// Heartbeat page
// ---------------------------------------------------------------------------
export default function Heartbeat() {
  const { id: projectId } = useParams<{ id?: string }>()
  const [snap, setSnap] = useState<HeartbeatSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [projectName, setProjectName] = useState<string | null>(null)
  const cursorRef = useRef<number>(0)
  const eventsRef = useRef<SweepEvent[]>([])
  const [, forceTick] = useState(0)

  useEffect(() => {
    cursorRef.current = 0
    eventsRef.current = []
    forceTick((n) => n + 1)
  }, [projectId])

  useEffect(() => {
    if (!projectId) {
      setProjectName(null)
      return
    }
    let cancelled = false
    apiFetch<{ id: string; name: string }>(`/api/projects/${projectId}`)
      .then((project) => {
        if (!cancelled) setProjectName(project.name)
      })
      .catch(() => {
        if (!cancelled) setProjectName(null)
      })
    return () => { cancelled = true }
  }, [projectId])

  useEffect(() => {
    wsClient.subscribeRoom('__global__')
    return () => wsClient.unsubscribeRoom('__global__')
  }, [])

  // Initial fetch + 5s status poll.
  useEffect(() => {
    let cancelled = false
    async function loadStatus() {
      try {
        const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
        const res = await fetch(`/api/heartbeat/status${query}`)
        if (!res.ok) throw new Error(`status ${res.status}`)
        const body = (await res.json()) as HeartbeatSnapshot
        if (cancelled) return
        setSnap(body)
        setError(null)
        // Seed cursor + ring from the initial snapshot.
        if (body.recent?.sweeps.length) {
          cursorRef.current = body.recent.cursor
          eventsRef.current = body.recent.sweeps
          forceTick((n) => n + 1)
        }
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'failed to load heartbeat')
      }
    }
    void loadStatus()
    const handle = setInterval(() => void loadStatus(), 5_000)
    return () => { cancelled = true; clearInterval(handle) }
  }, [projectId])

  // Incremental sweeps polling — every 2s.
  useEffect(() => {
    let cancelled = false
    async function pollSweeps() {
      try {
        const query = new URLSearchParams({ since: String(cursorRef.current) })
        if (projectId) query.set('projectId', projectId)
        const res = await fetch(`/api/heartbeat/sweeps?${query.toString()}`)
        if (!res.ok) return
        const body = (await res.json()) as { sweeps: SweepEvent[]; cursor: number }
        if (cancelled) return
        if (body.sweeps.length > 0) {
          cursorRef.current = body.cursor
          // Keep the most recent 50 in-page (matches server snapshot default).
          const merged = [...eventsRef.current, ...body.sweeps].slice(-50)
          eventsRef.current = merged
          forceTick((n) => n + 1)
        }
      } catch {
        // Silent — main status poll surfaces errors.
      }
    }
    const handle = setInterval(() => void pollSweeps(), 2_000)
    return () => { cancelled = true; clearInterval(handle) }
  }, [projectId])

  const recent = [...eventsRef.current].reverse() // newest first
  const scopeLabel = projectId ? (projectName ?? 'Selected project') : 'System'
  const description = projectId
    ? 'Background automation for this project. Sweeps are centrally scheduled, but their purpose, cadence, last result, and live activity are visible here.'
    : 'Background automation scheduler. Use a project heartbeat page when you want project-scoped operating context.'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PageHeader
        eyebrow={projectId ? 'PROJECT AUTOMATION' : 'SYSTEM AUTOMATION'}
        title="Heartbeat"
        description={description}
        actions={
          <Badge
            appearance="outline"
            color={snap?.active ? 'success' : 'informative'}
          >
            {scopeLabel} · {snap?.active ? 'active' : 'idle'}
          </Badge>
        }
      />

      <div style={{ flex: 1, overflow: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL }}>

        {error && (
          <div style={{ color: tokens.colorPaletteRedForeground1 }}>
            <Caption1>Failed to load heartbeat: {error}</Caption1>
          </div>
        )}

        {/* Section a — Last tick */}
        <SectionCard title="Scheduler state">
          <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalM }}>
            <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
              Last tick: {relativeTime(snap?.lastTickAt)}
            </Caption1>
            <Badge appearance="outline" color={snap?.active ? 'success' : 'informative'}>
              {snap?.active ? 'active' : 'idle'}
            </Badge>
          </div>
          <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
            {snap?.sweeps.length ?? 0} sweep(s) registered
          </Caption1>
        </SectionCard>

        <SectionCard title="What each sweep does">
          {snap?.sweeps.length ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: tokens.spacingHorizontalM }}>
              {snap.sweeps.map((sweep) => (
                <div
                  key={sweep.id}
                  style={{
                    border: `1px solid ${tokens.colorNeutralStroke2}`,
                    borderRadius: 8,
                    padding: tokens.spacingHorizontalM,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: tokens.spacingVerticalXXS,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: tokens.spacingHorizontalS }}>
                    <Body1 style={{ fontWeight: tokens.fontWeightSemibold }}>{sweep.label}</Body1>
                    <Badge appearance="outline" color={sweep.enabled ? 'success' : 'subtle'}>
                      {sweep.enabled ? 'enabled' : 'paused'}
                    </Badge>
                  </div>
                  <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
                    {sweep.description}
                  </Caption1>
                  <Caption1 style={{ color: tokens.colorNeutralForeground4 }}>
                    Every {Math.round(sweep.intervalMs / 1000)}s · {sweep.scope} · last run {relativeTime(sweep.lastRunAt)}
                  </Caption1>
                  {sweep.lastResult?.details && (
                    <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
                      {sweep.lastResult.details}
                    </Caption1>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <Body1 style={{ color: tokens.colorNeutralForeground3 }}>
              No sweeps registered yet
            </Body1>
          )}
        </SectionCard>

        {/* Section b — Sweeps acted on */}
        <SectionCard title="Sweep activity">
          {recent.length === 0 ? (
            <Body1 style={{ color: tokens.colorNeutralForeground3 }}>
              No sweep runs recorded yet
            </Body1>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS }}>
              {recent.slice(0, 20).map((e) => (
                <div key={e.seq} style={{ display: 'flex', gap: tokens.spacingHorizontalM, alignItems: 'baseline' }}>
                  <Caption1 style={{ color: tokens.colorNeutralForeground3, minWidth: 90 }}>
                    {relativeTime(e.ts)}
                  </Caption1>
                  <Caption1 style={{ fontFamily: tokens.fontFamilyMonospace, minWidth: 180 }}>
                    {e.sweepId}
                  </Caption1>
                  <Badge
                    appearance="outline"
                    color={e.outcome === 'completed' ? 'success' : 'danger'}
                  >
                    {e.outcome === 'completed'
                      ? `acted ${e.result?.acted ?? 0} · err ${e.result?.errors ?? 0}`
                      : 'error'}
                  </Badge>
                  <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
                    {e.durationMs}ms
                  </Caption1>
                  {e.result?.projectIds?.length ? (
                    <Caption1 style={{ color: tokens.colorNeutralForeground4 }}>
                      {projectId ? 'this project' : `${e.result.projectIds.length} project(s)`}
                    </Caption1>
                  ) : null}
                  {e.error && (
                    <Caption1 style={{ color: tokens.colorPaletteRedForeground1 }}>
                      {e.error}
                    </Caption1>
                  )}
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Section c — Last error */}
        <SectionCard title="Last error">
          <Caption1 style={{ color: snap?.lastError ? tokens.colorPaletteRedForeground1 : tokens.colorNeutralForeground3 }}>
            {snap?.lastError ?? '—'}
          </Caption1>
        </SectionCard>

        {/* Section d — Sweep Animation Timeline (W25) */}
        <SectionCard title="Sweep Activity Timeline">
          <SweepTimeline
            key={projectId ?? '__global__'}
            windowSizeMs={60_000}
            compact={false}
            projectId={projectId}
            sweeps={snap?.sweeps.map((sweep) => ({
              id: sweep.id,
              label: sweep.label,
              description: sweep.description,
              scope: sweep.scope,
            }))}
            initialEvents={eventsRef.current}
          />
        </SectionCard>

      </div>
    </div>
  )
}

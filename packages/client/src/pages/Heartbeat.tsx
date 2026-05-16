/**
 * Heartbeat page — Wave 10 B3 (page-level wiring only).
 *
 * Reads /api/heartbeat/status on mount + polls /api/heartbeat/sweeps?since=
 * for incremental sweep updates. Stream B owns the data plumbing only; visual
 * polish (badges, layout) for this page is Stream C territory.
 */
import { useEffect, useRef, useState } from 'react'
import { Title2, Body1, Caption1, Badge, tokens } from '@fluentui/react-components'
import PageHeader from '../components/layout/PageHeader.tsx'
import { SweepTimeline } from '../components/heartbeat/SweepTimeline.tsx'

interface SweepStatus {
  id:         string
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
  result?:    { acted: number; errors: number; details?: string }
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
  const [snap, setSnap] = useState<HeartbeatSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cursorRef = useRef<number>(0)
  const eventsRef = useRef<SweepEvent[]>([])
  const [, forceTick] = useState(0)

  // Initial fetch + 5s status poll.
  useEffect(() => {
    let cancelled = false
    async function loadStatus() {
      try {
        const res = await fetch('/api/heartbeat/status')
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
  }, [])

  // Incremental sweeps polling — every 2s.
  useEffect(() => {
    let cancelled = false
    async function pollSweeps() {
      try {
        const res = await fetch(`/api/heartbeat/sweeps?since=${cursorRef.current}`)
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
  }, [])

  const recent = [...eventsRef.current].reverse() // newest first

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PageHeader
        eyebrow="GLOBAL · ACROSS ALL PROJECTS"
        title="Heartbeat"
        description={
          snap?.active
            ? 'Background sweep monitor · service running'
            : 'Background sweep monitor · service idle'
        }
        actions={
          <Badge
            appearance="outline"
            color={snap?.active ? 'success' : 'informative'}
          >
            {snap?.active ? 'Global · active' : 'Global · idle'}
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
        <SectionCard title="Last tick">
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

        {/* Section b — Sweeps acted on */}
        <SectionCard title="Sweeps acted on">
          {recent.length === 0 ? (
            <Body1 style={{ color: tokens.colorNeutralForeground3 }}>
              No sweeps registered yet
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
          <SweepTimeline windowSizeMs={60_000} compact={false} />
        </SectionCard>

      </div>
    </div>
  )
}

/**
 * SweepTimeline.tsx — W25 Sweep Animation Viz
 *
 * Horizontal rolling timeline showing sweep activity over a sliding window.
 * Each registered sweep gets its own lane; every `sweep.tick` event from the
 * global WS channel renders an animated pulse at the moment it fired.
 *
 * Props:
 *   windowSizeMs — milliseconds of history to display (default 60_000)
 *   compact      — compact mode for the Now page (fewer lanes, shorter)
 *
 * Rendering:
 *   - One row per sweep in ALL_SWEEPS (or COMPACT_SWEEPS subset when compact)
 *   - The track is a relatively-positioned bar; each pulse is an absolutely
 *     positioned dot whose `left` is computed from its receivedAt timestamp
 *     relative to the current window.
 *   - A 2 s setInterval re-renders so the window slides smoothly and pulses
 *     that fall off the left edge are pruned.
 *
 * No emojis — Fluent2 icons only (per Copilot directive 2026-05-16).
 */
import { useEffect, useRef, useState } from 'react'
import {
  Tooltip,
  Caption1,
  tokens,
  makeStyles,
  mergeClasses,
} from '@fluentui/react-components'
import { ArrowSync20Regular } from '@fluentui/react-icons'
import { wsClient } from '../../realtime/ws-client.ts'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SweepTick {
  sweepName:        string
  sweepLabel?:      string
  sweepDescription?: string
  sweepScope?:      'system' | 'project' | 'mixed'
  timestamp:        string
  agentsActivated:  string[]
  durationMs:       number
  status:           'success' | 'error' | 'skip'
  projectIds?:       string[]
}

interface SweepPulse extends SweepTick {
  id:         string
  receivedAt: number
}

export interface SweepDefinition {
  id: string
  label: string
  description?: string
  scope?: 'system' | 'project' | 'mixed'
}

export interface SweepTimelineEvent {
  seq?: number
  ts: string
  sweepId: string
  outcome: 'completed' | 'error'
  durationMs: number
  result?: { acted: number; errors: number; details?: string; projectIds?: string[] }
  error?: string
}

// ─── Sweep lane registry ──────────────────────────────────────────────────────
// Must stay in sync with packages/server/src/index.ts heartbeat.register() calls.

const ALL_SWEEPS = [
  { id: 'ceremonies-due',       label: 'Ceremonies'      },
  { id: 'ready-workflow-steps', label: 'Workflow Steps'  },
  { id: 'stuck-issue-runs',     label: 'Stuck Runs'      },
  { id: 'stale-presence',       label: 'Presence'        },
  { id: 'idle-live-sessions',   label: 'Live Sessions'   },
  { id: 'github-sync-overdue',  label: 'GitHub Sync'     },
  { id: 'pickup-ready',         label: 'Ready Pickup'    },
  { id: 'ralph-monitor',        label: 'Ralph Monitor'   },
] satisfies SweepDefinition[]

const COMPACT_SWEEPS: ReadonlySet<string> = new Set([
  'ceremonies-due',
  'ready-workflow-steps',
  'stuck-issue-runs',
  'github-sync-overdue',
])

// ─── Styles ───────────────────────────────────────────────────────────────────

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    width: '100%',
    fontFamily: tokens.fontFamilyBase,
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    marginBottom: tokens.spacingVerticalXS,
  },
  title: {
    color: tokens.colorNeutralForeground2,
    fontWeight: tokens.fontWeightSemibold,
    fontSize: '12px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    height: '28px',
  },
  rowCompact: {
    height: '22px',
  },
  label: {
    width: '120px',
    flexShrink: 0,
    color: tokens.colorNeutralForeground3,
    fontSize: '11px',
    textAlign: 'right',
    paddingRight: tokens.spacingHorizontalXS,
  },
  labelCompact: {
    width: '90px',
  },
  track: {
    flex: 1,
    height: '10px',
    background: tokens.colorNeutralBackground3,
    borderRadius: '5px',
    position: 'relative',
    overflow: 'visible',
  },
  trackCompact: {
    height: '7px',
  },
  axis: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    paddingTop: '4px',
  },
  axisLabel: {
    width: '120px',
    flexShrink: 0,
  },
  axisTrack: {
    flex: 1,
    display: 'flex',
    justifyContent: 'space-between',
  },
  emptyHint: {
    color: tokens.colorNeutralForeground4,
    fontSize: '10px',
    marginTop: tokens.spacingVerticalXS,
  },
})

// ─── Pulse dot ────────────────────────────────────────────────────────────────

function PulseDot({
  pulse,
  pct,
  compact,
}: {
  pulse:   SweepPulse
  pct:     number
  compact: boolean
}) {
  const size = compact ? 6 : 10
  const isError = pulse.status === 'error'
  const color  = isError ? tokens.colorPaletteRedBackground3 : tokens.colorBrandBackground
  const ring   = isError ? tokens.colorPaletteRedBorderActive : tokens.colorBrandBackgroundPressed
  const label  = `${pulse.sweepName} · ${pulse.durationMs}ms · ${pulse.status}`

  return (
    <Tooltip content={label} relationship="label">
      <div
        style={{
          position: 'absolute',
          left: `calc(${pct}% - ${size / 2}px)`,
          top:  `calc(50% - ${size / 2}px)`,
          width: size,
          height: size,
          borderRadius: '50%',
          background: color,
          animation: 'sweepPulse 0.4s ease-out forwards',
          boxShadow: `0 0 0 2px ${ring}`,
          cursor: 'default',
          zIndex: 1,
        }}
      />
    </Tooltip>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface SweepTimelineProps {
  windowSizeMs?: number
  compact?:      boolean
  sweeps?:       SweepDefinition[]
  initialEvents?: SweepTimelineEvent[]
}

export function SweepTimeline({
  windowSizeMs = 60_000,
  compact      = false,
  sweeps       = ALL_SWEEPS,
  initialEvents = [],
}: SweepTimelineProps) {
  const styles = useStyles()
  const [, forceTick] = useState(0)
  const pulsesRef  = useRef<SweepPulse[]>([])
  const counterRef = useRef(0)
  const seededEventsRef = useRef(new Set<string>())

  const visibleSweeps = compact
    ? sweeps.filter((s) => COMPACT_SWEEPS.has(s.id))
    : sweeps

  // Prune old pulses + slide the window every 2 s.
  useEffect(() => {
    const timer = setInterval(() => {
      const cutoff = Date.now() - windowSizeMs
      const before = pulsesRef.current.length
      pulsesRef.current = pulsesRef.current.filter((p) => p.receivedAt > cutoff)
      // Always force a re-render so the existing pulses slide left visually.
      forceTick((n) => (before !== pulsesRef.current.length ? n + 1 : n + 1))
    }, 2_000)
    return () => clearInterval(timer)
  }, [windowSizeMs])

  useEffect(() => {
    let changed = false
    const seeded: SweepPulse[] = []
    for (const event of initialEvents) {
      const key = event.seq !== undefined ? String(event.seq) : `${event.sweepId}:${event.ts}`
      if (seededEventsRef.current.has(key)) continue
      seededEventsRef.current.add(key)
      const receivedAt = Date.parse(event.ts)
      if (!Number.isFinite(receivedAt)) continue
      seeded.push({
        id: `history-${key}`,
        sweepName: event.sweepId,
        timestamp: event.ts,
        agentsActivated: [],
        durationMs: event.durationMs,
        status: event.outcome === 'completed' ? 'success' : 'error',
        receivedAt,
      })
      changed = true
    }
    if (changed) {
      pulsesRef.current = [...pulsesRef.current, ...seeded].slice(-200)
      forceTick((n) => n + 1)
    }
  }, [initialEvents])

  // WS subscription — append new pulses on every sweep.tick.
  useEffect(() => {
    const handler = (payload: SweepTick) => {
      const pulse: SweepPulse = {
        ...payload,
        id:         `${payload.sweepName}-${++counterRef.current}`,
        receivedAt: Date.now(),
      }
      pulsesRef.current = [...pulsesRef.current, pulse]
      forceTick((n) => n + 1)
    }
    wsClient.on('sweep.tick', handler)
    return () => wsClient.off('sweep.tick', handler)
  }, [])

  const now = Date.now()
  const windowStart = now - windowSizeMs

  return (
    <div className={styles.root}>
      {/* Inject keyframes once — Fluent2 makeStyles doesn't expose @keyframes natively. */}
      <style>{`
        @keyframes sweepPulse {
          0%   { transform: scale(0.4); opacity: 0.6; }
          60%  { transform: scale(1.25); opacity: 1; }
          100% { transform: scale(1); opacity: 0.9; }
        }
      `}</style>

      <div className={styles.headerRow}>
        <ArrowSync20Regular style={{ color: tokens.colorBrandForeground1 }} />
        <Caption1 className={styles.title}>
          {compact
            ? 'Sweep Activity'
            : `Sweep Timeline (last ${Math.round(windowSizeMs / 1000)}s)`}
        </Caption1>
      </div>

      {visibleSweeps.map((sweep) => {
        const pulsesForSweep = pulsesRef.current.filter(
          (p) => p.sweepName === sweep.id && p.receivedAt > windowStart,
        )
        return (
          <div
            key={sweep.id}
            className={mergeClasses(styles.row, compact && styles.rowCompact)}
          >
            <Caption1
              className={mergeClasses(styles.label, compact && styles.labelCompact)}
            >
              {sweep.label}
            </Caption1>
            <div className={mergeClasses(styles.track, compact && styles.trackCompact)}>
              {pulsesForSweep.map((pulse) => {
                const pct = ((pulse.receivedAt - windowStart) / windowSizeMs) * 100
                return (
                  <PulseDot
                    key={pulse.id}
                    pulse={pulse}
                    pct={Math.min(Math.max(pct, 0), 100)}
                    compact={compact}
                  />
                )
              })}
            </div>
          </div>
        )
      })}

      {!compact && (
        <div className={styles.axis}>
          <div className={styles.axisLabel} />
          <div className={styles.axisTrack}>
            {['-60s', '-45s', '-30s', '-15s', 'now'].map((label) => (
              <Caption1
                key={label}
                style={{ color: tokens.colorNeutralForeground4, fontSize: '10px' }}
              >
                {label}
              </Caption1>
            ))}
          </div>
        </div>
      )}

      {pulsesRef.current.length === 0 && (
        <Caption1 className={styles.emptyHint}>
          No sweep activity in this window. Recent sweep runs still appear in
          the activity list above.
        </Caption1>
      )}
    </div>
  )
}

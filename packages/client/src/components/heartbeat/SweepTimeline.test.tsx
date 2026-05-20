import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SweepTimeline, mergeSweepDefinitions, type SweepDefinition } from './SweepTimeline'

vi.mock('../../realtime/ws-client.ts', () => ({
  wsClient: {
    on: vi.fn(),
    off: vi.fn(),
  },
}))

describe('SweepTimeline', () => {
  it('keeps compact Now lanes in parity with the full heartbeat timeline when status data is partial', () => {
    const partialSweeps: SweepDefinition[] = [
      { id: 'stuck-issue-runs', label: 'Stuck Runs' },
      { id: 'idle-live-sessions', label: 'Live Sessions' },
    ]

    render(<SweepTimeline compact={true} sweeps={partialSweeps} />)

    expect(screen.getByText('Ceremonies')).toBeInTheDocument()
    expect(screen.getByText('Workflow Steps')).toBeInTheDocument()
    expect(screen.getByText('Stuck Runs')).toBeInTheDocument()
    expect(screen.getByText('Presence')).toBeInTheDocument()
    expect(screen.getByText('Live Sessions')).toBeInTheDocument()
    expect(screen.getByText('GitHub Sync')).toBeInTheDocument()
    expect(screen.getByText('Ready Pickup')).toBeInTheDocument()
    expect(screen.getByText('Ralph Monitor')).toBeInTheDocument()
    expect(screen.getByText('Log Monitor')).toBeInTheDocument()
  })

  it('preserves backend-only sweep lanes after the canonical heartbeat lanes', () => {
    expect(mergeSweepDefinitions([
      { id: 'custom-sweep', label: 'Custom Sweep' },
    ]).map((sweep) => sweep.id)).toContain('custom-sweep')
  })
})

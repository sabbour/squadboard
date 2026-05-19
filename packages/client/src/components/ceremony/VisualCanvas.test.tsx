/**
 * VisualCanvas — H3 smarter connection tests (W27)
 *
 * Tests:
 *   1. Auto-connect: palette click when one node selected → new step inserted after it.
 *   2. No auto-connect: palette click with no selection → step appended to end.
 *   3. Edge delete: onEdgesDelete moves target step to end.
 *   4. Reconnect: onReconnect delegates to the same reorder logic as onConnect.
 *   5. Fan-out child authoring: selected fan-out nodes can add child steps visually.
 *
 * Strategy: mock @xyflow/react so the canvas renders in jsdom without a real
 * SVG/WebGL environment. Capture the ReactFlow props on each render so we can
 * invoke the callbacks directly.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VisualCanvas from './VisualCanvas'
import type { CeremonyStep, CeremonyHeader } from '../../services/ceremony-graph'

// ── Captured ReactFlow props (updated on every render) ────────────────────────

type AnyFn = (...args: unknown[]) => unknown
let capturedRFProps: Record<string, AnyFn | unknown> = {}

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@xyflow/react', () => ({
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ReactFlow: (props: Record<string, AnyFn | unknown>) => {
    capturedRFProps = props
    return <div data-testid="react-flow" />
  },
  Background: () => null,
  BackgroundVariant: { Dots: 'dots' },
  Controls: () => null,
  MarkerType: { ArrowClosed: 'arrowclosed' },
  Panel: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  BaseEdge: () => null,
  EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  getSmoothStepPath: () => ['M0 0', 50, 50],
}))

vi.mock('../../api/agents', () => ({
  useActiveAgents: () => ({ data: [], isLoading: false }),
}))

vi.mock('react-router', () => ({
  useNavigate: () => vi.fn(),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

const HEADER: CeremonyHeader = { name: 'Test Ceremony', extras: {} }

function makeStep(label: string): CeremonyStep {
  return { kind: 'agent_run', label, extras: {} }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('VisualCanvas — H3 smarter connection', () => {
  beforeEach(() => {
    capturedRFProps = {}
  })

  // 1. Auto-connect on palette drop when exactly one node is selected.
  it('inserts new step immediately after the selected node (auto-connect)', async () => {
    const onChange = vi.fn()
    const steps = [makeStep('A'), makeStep('B')]
    const user = userEvent.setup()

    render(<VisualCanvas projectId="p1" header={HEADER} steps={steps} onChange={onChange} />)

    // Select the first node (step-0) by invoking the captured onNodeClick handler.
    act(() => {
      ;(capturedRFProps.onNodeClick as AnyFn)(null, { id: 'step-0' })
    })

    // Click the "Agent run" palette button — should auto-connect after step-0.
    await user.click(screen.getByRole('button', { name: /agent run/i }))

    expect(onChange).toHaveBeenCalledOnce()
    const [nextSteps] = onChange.mock.calls[0] as [CeremonyStep[]]
    expect(nextSteps).toHaveLength(3)
    // New blank step is at index 1, between A and B.
    expect(nextSteps[0].label).toBe('A')
    expect(nextSteps[1].kind).toBe('agent_run')
    expect(nextSteps[1].label).toBeUndefined()
    expect(nextSteps[2].label).toBe('B')
  })

  // 2. Auto-connect SKIPPED when no node is selected.
  it('appends to the end when no node is selected', async () => {
    const onChange = vi.fn()
    const steps = [makeStep('A'), makeStep('B')]
    const user = userEvent.setup()

    render(<VisualCanvas projectId="p1" header={HEADER} steps={steps} onChange={onChange} />)

    // No node selection — just click the palette.
    await user.click(screen.getByRole('button', { name: /agent run/i }))

    expect(onChange).toHaveBeenCalledOnce()
    const [nextSteps] = onChange.mock.calls[0] as [CeremonyStep[]]
    expect(nextSteps).toHaveLength(3)
    expect(nextSteps[0].label).toBe('A')
    expect(nextSteps[1].label).toBe('B')
    // New step is at the end.
    expect(nextSteps[2].kind).toBe('agent_run')
    expect(nextSteps[2].label).toBeUndefined()
  })

  // 3. Backspace on a selected edge → onEdgesDelete moves target to end.
  it('moves the disconnected target step to the end when an edge is deleted', () => {
    const onChange = vi.fn()
    const steps = [makeStep('A'), makeStep('B'), makeStep('C')]

    render(<VisualCanvas projectId="p1" header={HEADER} steps={steps} onChange={onChange} />)

    const onEdgesDelete = capturedRFProps.onEdgesDelete as AnyFn
    expect(onEdgesDelete).toBeDefined()

    // Simulate React Flow firing onEdgesDelete for the edge A→B.
    // Edge id format from buildGraphFromHeaderAndSteps: `${prev}->${id}`.
    act(() => {
      onEdgesDelete([{ id: 'step-0->step-1', source: 'step-0', target: 'step-1' }])
    })

    expect(onChange).toHaveBeenCalledOnce()
    const [nextSteps] = onChange.mock.calls[0] as [CeremonyStep[]]
    expect(nextSteps).toHaveLength(3)
    // A stays, C moves up, B goes to end.
    expect(nextSteps[0].label).toBe('A')
    expect(nextSteps[1].label).toBe('C')
    expect(nextSteps[2].label).toBe('B')
  })

  // 4. Drag-to-reconnect handler delegates to the reorder logic.
  it('reorders steps when an edge endpoint is dragged to reconnect', () => {
    const onChange = vi.fn()
    const steps = [makeStep('A'), makeStep('B'), makeStep('C')]

    render(<VisualCanvas projectId="p1" header={HEADER} steps={steps} onChange={onChange} />)

    const onReconnect = capturedRFProps.onReconnect as AnyFn
    expect(onReconnect).toBeDefined()

    // Drag the source handle of edge (step-0→step-1) to step-2.
    // New connection: step-2 → step-1, meaning B should come after C.
    act(() => {
      onReconnect(
        { id: 'step-0->step-1', source: 'step-0', target: 'step-1' },
        { source: 'step-2', target: 'step-1', sourceHandle: null, targetHandle: null },
      )
    })

    expect(onChange).toHaveBeenCalledOnce()
    const [nextSteps] = onChange.mock.calls[0] as [CeremonyStep[]]
    // reorderSteps(steps, sourceIdx=2, targetIdx=1): moves step[2] before step[1].
    // After removal of C (idx 2), insert before B (idx 1, shift to 1 since no shift):
    // [A, C, B]
    expect(nextSteps).toHaveLength(3)
    expect(nextSteps[0].label).toBe('A')
    expect(nextSteps[1].label).toBe('C')
    expect(nextSteps[2].label).toBe('B')
  })

  // Regression: auto-connect skipped when a child node (fan_out child) is selected.
  it('appends to end when a fan_out child node is selected (no auto-connect across levels)', async () => {
    const onChange = vi.fn()
    const fanOutStep: CeremonyStep = {
      kind: 'fan_out',
      split_by: 'agents',
      merge_strategy: 'all',
      mode: 'serial',
      steps: [{ kind: 'agent_run', label: 'Child', extras: {} }],
      extras: {},
    }
    const steps: CeremonyStep[] = [fanOutStep]
    const user = userEvent.setup()

    render(<VisualCanvas projectId="p1" header={HEADER} steps={steps} onChange={onChange} />)

    // Select the fan_out child node.
    act(() => {
      ;(capturedRFProps.onNodeClick as AnyFn)(null, { id: 'step-0.child-0' })
    })

    await user.click(screen.getByRole('button', { name: /agent run/i }))

    expect(onChange).toHaveBeenCalledOnce()
    const [nextSteps] = onChange.mock.calls[0] as [CeremonyStep[]]
    // No auto-connect — new step is appended at top-level end.
    expect(nextSteps).toHaveLength(2)
    expect(nextSteps[0].kind).toBe('fan_out')
    expect(nextSteps[1].kind).toBe('agent_run')
  })

  it('adds an agent_run child to a selected fan_out node from the visual property panel', async () => {
    const onChange = vi.fn()
    const fanOutStep: CeremonyStep = {
      kind: 'fan_out',
      split_by: 'agents',
      merge_strategy: 'all',
      mode: 'serial',
      steps: [],
      extras: {},
    }
    const user = userEvent.setup()

    render(<VisualCanvas projectId="p1" header={HEADER} steps={[fanOutStep]} onChange={onChange} />)

    act(() => {
      ;(capturedRFProps.onNodeClick as AnyFn)(null, { id: 'step-0' })
    })

    await user.click(screen.getByRole('button', { name: /add agent run child/i }))

    expect(onChange).toHaveBeenCalledOnce()
    const [nextSteps] = onChange.mock.calls[0] as [CeremonyStep[]]
    expect(nextSteps).toHaveLength(1)
    expect(nextSteps[0].kind).toBe('fan_out')
    if (nextSteps[0].kind !== 'fan_out') throw new Error('Expected fan_out')
    expect(nextSteps[0].steps).toHaveLength(1)
    expect(nextSteps[0].steps[0].kind).toBe('agent_run')
  })
})

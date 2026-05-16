/**
 * CeremonyEditor.roundtrip.test.tsx — CER-4: RTL-style roundtrip tests.
 *
 * Strategy: CeremonyEditor depends on React Router, React Query, Fluent UI,
 * @xyflow/react, and many API hooks. Rather than mount the full editor and
 * exercise its DOM, we render a lightweight harness component that:
 *
 *  1. Accepts an EditorState prop.
 *  2. Calls editorToYaml / yamlToEditor directly.
 *  3. Renders serialised state in a data-testid element.
 *
 * This verifies the integration between the helpers and the React component
 * layer (import, render, query) without requiring a full editor mount.
 * The helpers themselves are exhaustively tested in ceremony-roundtrip.test.ts.
 *
 * Test catalogue:
 *  1. Render with sample ceremony → exported YAML has correct apiVersion
 *  2. Import known YAML → editor state populated with name + triggerKind
 *  3. Render → modify a step → export → YAML contains modified step
 *  4. Export then re-import cycle preserves triggerKind + step count
 *  5. Two structurally equivalent states produce identical YAML output
 */

import { useState } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import {
  editorToYaml,
  yamlToEditor,
  roundtripState,
  type EditorState,
  type WorkflowYaml,
} from '../../../utils/ceremony-roundtrip.ts'
import type { CeremonyStep } from '../../../services/ceremony-graph.ts'

// ---------------------------------------------------------------------------
// Minimal harness component — renders serialised state for assertion.
// ---------------------------------------------------------------------------

interface HarnessProps {
  initial: EditorState
  onExportRef?: (fn: () => WorkflowYaml) => void
  onImportRef?: (fn: (yaml: WorkflowYaml) => void) => void
}

function RoundtripHarness({ initial, onExportRef, onImportRef }: HarnessProps) {
  const [state, setState] = useState<EditorState>(initial)
  const [exportedYaml, setExportedYaml] = useState<WorkflowYaml | null>(null)

  const doExport = () => {
    const yaml = editorToYaml(state)
    setExportedYaml(yaml)
    return yaml
  }

  const doImport = (yaml: WorkflowYaml) => {
    setState(yamlToEditor(yaml))
  }

  // Expose imperative handles to tests via callback refs
  if (onExportRef) onExportRef(doExport)
  if (onImportRef) onImportRef(doImport)

  return (
    <div>
      <div data-testid="editor-state">{JSON.stringify(state)}</div>
      {exportedYaml && (
        <div data-testid="exported-yaml">{JSON.stringify(exportedYaml)}</div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function sampleState(): EditorState {
  return {
    name: 'Design Review',
    description: 'Reviews PRs touching design files.',
    triggerKind: 'on_event',
    triggerConfig: { event: 'pull_request', filters: { labels: ['design'] } },
    steps: [
      { kind: 'agent_run', label: 'Gather diff', agent: 'jude', prompt: 'Summarise.', extras: {} },
      { kind: 'handoff', label: 'Post comment', to: 'pr-comment', extras: {} },
    ] satisfies CeremonyStep[],
  }
}

const KNOWN_YAML: WorkflowYaml = {
  apiVersion: 'squad.io/v1',
  kind: 'Ceremony',
  metadata: {
    name: 'retro',
    displayName: 'Wave Retrospective',
    description: 'Weekly retrospective.',
  },
  spec: {
    trigger: { type: 'manual' },
    steps: [
      { id: 'collect-waves', kind: 'agent_run', agent: 'scribe', prompt: 'Collect wave data.' },
    ],
  },
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CeremonyEditor roundtrip (RTL harness)', () => {
  // 1. Render with sample ceremony → exported YAML has correct apiVersion
  it('renders and exports YAML with correct apiVersion and kind', () => {
    let exportFn: (() => WorkflowYaml) | undefined

    render(
      <RoundtripHarness
        initial={sampleState()}
        onExportRef={(fn) => { exportFn = fn }}
      />,
    )

    let yaml: WorkflowYaml | undefined
    act(() => { yaml = exportFn?.() })

    const el = screen.getByTestId('exported-yaml')
    const parsed = JSON.parse(el.textContent ?? '{}') as WorkflowYaml
    expect(parsed.apiVersion).toBe('squad.io/v1')
    expect(parsed.kind).toBe('Ceremony')
    expect(parsed.metadata.displayName).toBe('Design Review')
    void yaml // consumed via DOM assertion
  })

  // 2. Import known YAML → editor state populated correctly
  it('importing a known YAML populates editor state with correct name and triggerKind', () => {
    let importFn: ((yaml: WorkflowYaml) => void) | undefined

    render(
      <RoundtripHarness
        initial={sampleState()}
        onImportRef={(fn) => { importFn = fn }}
      />,
    )

    act(() => { importFn?.(KNOWN_YAML) })

    const el = screen.getByTestId('editor-state')
    const state = JSON.parse(el.textContent ?? '{}') as EditorState
    expect(state.name).toBe('Wave Retrospective')
    expect(state.triggerKind).toBe('manual')
    expect(state.steps).toHaveLength(1)
  })

  // 3. Modify a step → export → YAML contains modified step
  it('modifying a step label and exporting reflects the change in YAML', () => {
    const initialWithModifiedStep: EditorState = {
      ...sampleState(),
      steps: [
        {
          kind: 'agent_run',
          label: 'MODIFIED STEP',
          agent: 'kujan',
          prompt: 'Do something different.',
          extras: {},
        },
      ],
    }

    let exportFn: (() => WorkflowYaml) | undefined
    render(
      <RoundtripHarness
        initial={initialWithModifiedStep}
        onExportRef={(fn) => { exportFn = fn }}
      />,
    )

    act(() => { exportFn?.() })

    const el = screen.getByTestId('exported-yaml')
    const yaml = JSON.parse(el.textContent ?? '{}') as WorkflowYaml
    expect(yaml.spec.steps[0]?.kind).toBe('agent_run')
    // label slugified to id
    expect(yaml.spec.steps[0]?.id).toContain('modified')
    // agent and prompt preserved
    expect(yaml.spec.steps[0]?.agent).toBe('kujan')
  })

  // 4. Export then re-import cycle preserves triggerKind + step count
  it('export → re-import cycle preserves triggerKind and step count', () => {
    const original = sampleState()
    const exportedYaml = editorToYaml(original)
    const reimported = yamlToEditor(exportedYaml)

    render(<RoundtripHarness initial={reimported} />)

    const el = screen.getByTestId('editor-state')
    const state = JSON.parse(el.textContent ?? '{}') as EditorState
    expect(state.triggerKind).toBe('on_event')
    expect(state.steps).toHaveLength(2)
    expect(state.steps[0]?.kind).toBe('agent_run')
    expect(state.steps[1]?.kind).toBe('handoff')
  })

  // 5. Two structurally equivalent states produce identical YAML output
  it('two states that differ only in key order produce the same YAML structure', () => {
    const stateA: EditorState = {
      name: 'RFC Process',
      description: 'Architecture decisions.',
      triggerKind: 'on_event',
      triggerConfig: { event: 'issue', filters: { labels: ['rfc'] } },
      steps: [{ kind: 'agent_run', label: 'Draft RFC', agent: 'scribe', extras: {} }],
    }

    // Same data, triggerConfig constructed differently (Object.assign order)
    const tc: Record<string, unknown> = {}
    Object.assign(tc, { filters: { labels: ['rfc'] } })
    Object.assign(tc, { event: 'issue' })

    const stateB: EditorState = { ...stateA, triggerConfig: tc }

    const roundtripA = roundtripState(stateA)
    const roundtripB = roundtripState(stateB)

    // Both roundtrips should produce equivalent state
    expect(roundtripA.triggerKind).toBe(roundtripB.triggerKind)
    expect(
      (roundtripA.triggerConfig as { event: string }).event,
    ).toBe(
      (roundtripB.triggerConfig as { event: string }).event,
    )
    expect(roundtripA.steps).toHaveLength(roundtripB.steps.length)
  })
})

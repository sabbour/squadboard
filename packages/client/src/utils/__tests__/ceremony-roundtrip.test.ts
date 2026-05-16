/**
 * ceremony-roundtrip.test.ts — CER-4: Pure unit tests for editorToYaml,
 * yamlToEditor, and roundtripState helpers (~15 tests).
 */

import { describe, it, expect } from 'vitest'
import {
  editorToYaml,
  yamlToEditor,
  roundtripState,
  type EditorState,
  type WorkflowYaml,
} from '../ceremony-roundtrip.ts'
import type { CeremonyStep } from '../../services/ceremony-graph.ts'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function minimalState(overrides: Partial<EditorState> = {}): EditorState {
  return {
    name: 'Design Review',
    description: '',
    triggerKind: 'manual',
    triggerConfig: {},
    steps: [],
    ...overrides,
  }
}

function agentRunStep(label: string, agent?: string, prompt?: string): CeremonyStep {
  return { kind: 'agent_run', label, agent, prompt, extras: {} }
}

// ---------------------------------------------------------------------------
// 1. Minimal state (no steps) → YAML → state → identical
// ---------------------------------------------------------------------------

describe('editorToYaml / yamlToEditor', () => {
  it('minimal state (no steps) roundtrips to identical state', () => {
    const state = minimalState()
    const result = roundtripState(state)
    expect(result.name).toBe(state.name)
    expect(result.description).toBe(state.description)
    expect(result.triggerKind).toBe(state.triggerKind)
    expect(result.steps).toHaveLength(0)
  })

  // ---------------------------------------------------------------------------
  // 2. Single step → roundtrip → identical
  // ---------------------------------------------------------------------------

  it('single agent_run step roundtrips with kind and label preserved', () => {
    const state = minimalState({
      steps: [agentRunStep('Run primary agent', 'jude', 'Summarise the PR.')],
    })
    const result = roundtripState(state)
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0]?.kind).toBe('agent_run')
    expect(result.steps[0]?.label).toBe('Run primary agent')
    const s = result.steps[0] as { agent?: string; prompt?: string }
    expect(s.agent).toBe('jude')
    expect(s.prompt).toBe('Summarise the PR.')
  })

  // ---------------------------------------------------------------------------
  // 3. All trigger types roundtrip
  // ---------------------------------------------------------------------------

  it('trigger github-event roundtrips with event + filters', () => {
    const state = minimalState({
      triggerKind: 'on_event',
      triggerConfig: {
        event: 'pull_request',
        filters: { labels: ['design'], paths: ['docs/**'] },
      },
    })
    const yaml = editorToYaml(state)
    expect(yaml.spec.trigger.type).toBe('github-event')
    expect(yaml.spec.trigger.event).toBe('pull_request')

    const back = yamlToEditor(yaml)
    expect(back.triggerKind).toBe('on_event')
    const cfg = back.triggerConfig as { event: string; filters: { labels: string[]; paths: string[] } }
    expect(cfg.event).toBe('pull_request')
    expect(cfg.filters.labels).toEqual(['design'])
    expect(cfg.filters.paths).toEqual(['docs/**'])
  })

  it('trigger manual roundtrips correctly', () => {
    const state = minimalState({ triggerKind: 'manual', triggerConfig: {} })
    const yaml = editorToYaml(state)
    expect(yaml.spec.trigger.type).toBe('manual')
    const back = yamlToEditor(yaml)
    expect(back.triggerKind).toBe('manual')
  })

  it('trigger cron roundtrips with schedule preserved', () => {
    const state = minimalState({
      triggerKind: 'on_schedule',
      triggerConfig: { schedule: '0 9 * * 5' },
    })
    const yaml = editorToYaml(state)
    expect(yaml.spec.trigger.type).toBe('cron')
    expect(yaml.spec.trigger.schedule).toBe('0 9 * * 5')
    const back = yamlToEditor(yaml)
    expect(back.triggerKind).toBe('on_schedule')
    expect((back.triggerConfig as { schedule: string }).schedule).toBe('0 9 * * 5')
  })

  it('trigger agent-signal roundtrips correctly', () => {
    const state = minimalState({ triggerKind: 'on_issue_entry', triggerConfig: {} })
    const yaml = editorToYaml(state)
    expect(yaml.spec.trigger.type).toBe('agent-signal')
    const back = yamlToEditor(yaml)
    expect(back.triggerKind).toBe('on_issue_entry')
  })

  // ---------------------------------------------------------------------------
  // 4. Steps preserve order
  // ---------------------------------------------------------------------------

  it('multiple steps preserve order after roundtrip', () => {
    const state = minimalState({
      steps: [
        agentRunStep('Step A', 'jude'),
        agentRunStep('Step B', 'scribe'),
        agentRunStep('Step C', 'kujan'),
      ],
    })
    const result = roundtripState(state)
    expect(result.steps).toHaveLength(3)
    expect(result.steps[0]?.label).toBe('Step A')
    expect(result.steps[1]?.label).toBe('Step B')
    expect(result.steps[2]?.label).toBe('Step C')
  })

  // ---------------------------------------------------------------------------
  // 5. Step with missing optional fields preserves omitted-ness
  // ---------------------------------------------------------------------------

  it('step with missing optional agent + prompt roundtrips without those fields', () => {
    const state = minimalState({ steps: [{ kind: 'agent_run', extras: {} }] })
    const result = roundtripState(state)
    const s = result.steps[0] as { agent?: string; prompt?: string }
    expect(s.agent).toBeUndefined()
    expect(s.prompt).toBeUndefined()
  })

  // ---------------------------------------------------------------------------
  // 6. Filter labels array preserved
  // ---------------------------------------------------------------------------

  it('filter labels array is preserved through roundtrip', () => {
    const state = minimalState({
      triggerKind: 'on_event',
      triggerConfig: { event: 'push', filters: { labels: ['bug', 'critical', 'p0'] } },
    })
    const back = roundtripState(state)
    const cfg = back.triggerConfig as { filters: { labels: string[] } }
    expect(cfg.filters.labels).toEqual(['bug', 'critical', 'p0'])
  })

  // ---------------------------------------------------------------------------
  // 7. Filter paths array preserved
  // ---------------------------------------------------------------------------

  it('filter paths array is preserved through roundtrip', () => {
    const state = minimalState({
      triggerKind: 'on_event',
      triggerConfig: { event: 'push', filters: { paths: ['src/**', '**/*.ts'] } },
    })
    const back = roundtripState(state)
    const cfg = back.triggerConfig as { filters: { paths: string[] } }
    expect(cfg.filters.paths).toEqual(['src/**', '**/*.ts'])
  })

  // ---------------------------------------------------------------------------
  // 8. Schedule string preserved on cron triggers
  // ---------------------------------------------------------------------------

  it('schedule string preserved verbatim on cron triggers', () => {
    const schedule = '15 4 * * 0,6'
    const state = minimalState({ triggerKind: 'on_schedule', triggerConfig: { schedule } })
    const back = roundtripState(state)
    expect((back.triggerConfig as { schedule: string }).schedule).toBe(schedule)
  })

  // ---------------------------------------------------------------------------
  // 9. Metadata description with newlines preserved
  // ---------------------------------------------------------------------------

  it('metadata description with newlines roundtrips correctly', () => {
    const description = 'Line one\nLine two\nLine three'
    const state = minimalState({ description })
    const yaml = editorToYaml(state)
    expect(yaml.metadata.description).toBe(description)
    const back = yamlToEditor(yaml)
    expect(back.description).toBe(description)
  })

  // ---------------------------------------------------------------------------
  // 10. Multi-line prompt preserved
  // ---------------------------------------------------------------------------

  it('multi-line agent prompt roundtrips correctly', () => {
    const prompt = 'Read the PR diff.\nIdentify issues.\nProduce a summary.'
    const state = minimalState({
      steps: [{ kind: 'agent_run', prompt, extras: {} }],
    })
    const result = roundtripState(state)
    const s = result.steps[0] as { prompt?: string }
    expect(s.prompt).toBe(prompt)
  })

  // ---------------------------------------------------------------------------
  // 11. Empty metadata.description preserved (not written to YAML)
  // ---------------------------------------------------------------------------

  it('empty description is not written to YAML metadata', () => {
    const state = minimalState({ description: '' })
    const yaml = editorToYaml(state)
    expect(yaml.metadata.description).toBeUndefined()
  })

  // ---------------------------------------------------------------------------
  // 12. editorToYaml output shape validates structurally as WorkflowYaml
  // ---------------------------------------------------------------------------

  it('editorToYaml output has correct apiVersion, kind, metadata, spec shape', () => {
    const state = minimalState({ steps: [agentRunStep('test', 'jude')] })
    const yaml = editorToYaml(state)

    expect(yaml.apiVersion).toBe('squad.io/v1')
    expect(yaml.kind).toBe('Ceremony')
    expect(typeof yaml.metadata.name).toBe('string')
    expect(yaml.metadata.name.length).toBeGreaterThan(0)
    expect(typeof yaml.spec.trigger.type).toBe('string')
    expect(Array.isArray(yaml.spec.steps)).toBe(true)
    expect(yaml.spec.steps[0]).toMatchObject({ id: expect.any(String), kind: 'agent_run' })
  })

  // ---------------------------------------------------------------------------
  // 13. yamlToEditor on a WorkflowYaml from server produces valid state
  // ---------------------------------------------------------------------------

  it('yamlToEditor on a realistic server-style WorkflowYaml produces valid EditorState', () => {
    const yaml: WorkflowYaml = {
      apiVersion: 'squad.io/v1',
      kind: 'Ceremony',
      metadata: {
        name: 'design-review',
        displayName: 'Design Review',
        description: 'Reviews PRs touching design files.',
      },
      spec: {
        trigger: {
          type: 'github-event',
          event: 'pull_request',
          filters: { labels: ['design'], paths: ['**/design.md'] },
        },
        steps: [
          { id: 'gather-diff', kind: 'agent-task', agent: 'jude', prompt: 'Summarise.' },
          { id: 'post-comment', kind: 'notify', target: 'pr-comment' },
        ],
      },
    }

    const state = yamlToEditor(yaml)

    expect(state.name).toBe('Design Review')
    expect(state.description).toBe('Reviews PRs touching design files.')
    expect(state.triggerKind).toBe('on_event')
    expect(state.steps).toHaveLength(2)
    // agent-task normalises to agent_run
    expect(state.steps[0]?.kind).toBe('agent_run')
    // notify normalises to handoff
    expect(state.steps[1]?.kind).toBe('handoff')
  })

  // ---------------------------------------------------------------------------
  // 14. Roundtrip is idempotent (third pass same as second)
  // ---------------------------------------------------------------------------

  it('roundtripState is idempotent (second and third passes are equivalent)', () => {
    const state = minimalState({
      triggerKind: 'on_event',
      triggerConfig: { event: 'push', filters: { labels: ['bug'] } },
      steps: [agentRunStep('Triage', 'jude', 'Categorise the issue.')],
    })
    const pass1 = roundtripState(state)
    const pass2 = roundtripState(pass1)

    expect(pass2.name).toBe(pass1.name)
    expect(pass2.triggerKind).toBe(pass1.triggerKind)
    expect(pass2.steps).toHaveLength(pass1.steps.length)
    expect(pass2.steps[0]?.kind).toBe(pass1.steps[0]?.kind)
    expect((pass2.steps[0] as { prompt?: string }).prompt).toBe(
      (pass1.steps[0] as { prompt?: string }).prompt,
    )
  })

  // ---------------------------------------------------------------------------
  // 15. Display name with spaces slugifies correctly for metadata.name
  // ---------------------------------------------------------------------------

  it('display name with spaces produces a valid kebab-case slug in metadata.name', () => {
    const state = minimalState({ name: 'Wave Retrospective' })
    const yaml = editorToYaml(state)
    expect(yaml.metadata.name).toBe('wave-retrospective')
    expect(yaml.metadata.displayName).toBe('Wave Retrospective')
    // Name is restored from displayName on the way back
    const back = yamlToEditor(yaml)
    expect(back.name).toBe('Wave Retrospective')
  })
})

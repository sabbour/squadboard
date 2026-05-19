/**
 * Repro: parseSteps/emitYaml on canonical apiVersion: squad.io/v1 YAML
 * (the format Work Pickup and other built-in ceremonies use).
 *
 * Filed against the bug "clicking the built-in Work Pickup ceremony crashes
 * the app". The CeremonyEditor parses the active version's YAML through
 * ceremonyYamlToGraph; before the fix it only understood the legacy flat
 * `steps:`/`type:` shape and lost every canonical step.
 */
import { describe, it, expect } from 'vitest'
import {
  ceremonyYamlToGraph,
  graphToCeremonyYaml,
  rebuildGraph,
  topLevelSteps,
} from '../ceremony-graph.ts'

const WORK_PICKUP = `apiVersion: squad.io/v1
kind: Ceremony
metadata:
  name: work-pickup
  displayName: Work Pickup
  description: Required default run plan for assigning Ready cards to the best available project agent.
spec:
  trigger:
    type: agent-signal
    signalName: board.ready
  steps:
    - id: confirm-ready
      kind: route
      description: Confirm the card is in Ready and has enough context for an agent to start.
    - id: choose-agent
      kind: agent-task
      agent: coordinator
      prompt: |
        Select the best available Spark project agent using labels, routing rules, role fit,
        dependencies, and current run load. Leave ambiguous cards visible instead of forcing a bad assignment.
    - id: start-work
      kind: notify
      target: project-timeline
`

describe('Work Pickup canonical YAML in CeremonyEditor adapter', () => {
  it('parses canonical YAML without throwing', () => {
    expect(() => ceremonyYamlToGraph(WORK_PICKUP)).not.toThrow()
  })

  it('round-trips canonical YAML without throwing', () => {
    const graph = ceremonyYamlToGraph(WORK_PICKUP)
    const steps = topLevelSteps(graph)
    expect(() =>
      graphToCeremonyYaml(rebuildGraph(graph.header, steps)),
    ).not.toThrow()
  })

  it('surfaces canonical steps (route, agent-task, notify) to the editor', () => {
    const graph = ceremonyYamlToGraph(WORK_PICKUP)
    const steps = topLevelSteps(graph)
    expect(steps.map((s) => s.kind)).toEqual(['route', 'agent_run', 'handoff'])
  })

  it('surfaces canonical metadata (displayName, description) on the header', () => {
    const graph = ceremonyYamlToGraph(WORK_PICKUP)
    expect(graph.header.name).toBe('Work Pickup')
    expect(graph.header.description).toBe(
      'Required default run plan for assigning Ready cards to the best available project agent.',
    )
  })

  it('re-emits a canonical YAML document (apiVersion / kind / metadata / spec)', () => {
    const graph = ceremonyYamlToGraph(WORK_PICKUP)
    const out = graphToCeremonyYaml(rebuildGraph(graph.header, topLevelSteps(graph)))
    expect(out).toContain('apiVersion: squad.io/v1')
    expect(out).toContain('kind: Ceremony')
    expect(out).toContain('metadata:')
    expect(out).toContain('name: work-pickup')
    expect(out).toContain('displayName: Work Pickup')
    expect(out).toContain('spec:')
    expect(out).toContain('trigger:')
    expect(out).toContain('signalName: board.ready')
    // Canonical step kinds round-trip back to their original spelling.
    expect(out).toContain('kind: route')
    expect(out).toContain('kind: agent-task')
    expect(out).toContain('kind: notify')
    // Legacy `type:` step-list discriminator must NOT appear under
    // `spec.steps:` on canonical output (trigger.type is fine).
    expect(out).not.toMatch(/^\s{4,}- type:/m)
  })

  it('round-trips canonical YAML through parse -> emit -> parse with the same step kinds', () => {
    const first = ceremonyYamlToGraph(WORK_PICKUP)
    const emitted = graphToCeremonyYaml(rebuildGraph(first.header, topLevelSteps(first)))
    const second = ceremonyYamlToGraph(emitted)
    expect(second.header.name).toBe('Work Pickup')
    expect(topLevelSteps(second).map((s) => s.kind)).toEqual([
      'route',
      'agent_run',
      'handoff',
    ])
  })
})

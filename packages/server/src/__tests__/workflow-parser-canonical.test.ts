import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseWorkflowYaml, validateWorkflowYaml } from '../services/workflow-parser.js';

const WORK_PICKUP_YAML = readFileSync(
  resolve(process.cwd(), 'src/ceremonies/built-in/work-pickup.workflow.yaml'),
  'utf-8',
);

/**
 * Regression: what graphToCeremonyYaml emits after ceremonyYamlToGraph parses
 * work-pickup.workflow.yaml.  The client re-emits in canonical format but may
 * omit non-essential metadata fields (category, tags) and uses its own
 * YAML serialiser (not js-yaml).  Before the normalizeWorkflowDocument fix,
 * validateWorkflowYaml only looked for a flat top-level `name` / `steps` and
 * would fail with:
 *   "'name' is required and must be a string; 'steps' is required and must be
 *    a non-empty array"
 */
const CLIENT_EMITTED_YAML = `\
apiVersion: squad.io/v1
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
`;

describe('workflow-parser canonical ceremony support', () => {
  it('accepts Work Pickup canonical YAML for engine workflow runs', async () => {
    const validation = validateWorkflowYaml(WORK_PICKUP_YAML);

    expect(validation.valid, validation.errors.join('; ')).toBe(true);

    const parsed = await parseWorkflowYaml(WORK_PICKUP_YAML);

    expect(parsed.name).toBe('Work Pickup');
    expect(parsed.description).toContain('assigning Ready cards');
    expect(parsed.steps.map((step) => step.type)).toEqual(['route', 'agent_run', 'notify']);
    expect(parsed.steps[1]).toMatchObject({
      type: 'agent_run',
      agent: 'coordinator',
    });
  });

  it('regression: validateWorkflowYaml accepts client-emitted canonical YAML (CeremonyEditor Validate button)', () => {
    // This YAML is what graphToCeremonyYaml produces after the client parses
    // work-pickup.workflow.yaml via ceremonyYamlToGraph then re-emits it.
    // Before the normalizeWorkflowDocument fix this returned
    //   { valid: false, errors: ["'name' is required...", "'steps' is required..."] }
    // because validateWorkflowYaml only inspected top-level keys and missed the
    // canonical apiVersion: squad.io/v1 shape.
    const result = validateWorkflowYaml(CLIENT_EMITTED_YAML);

    expect(result.valid, result.errors.join('; ')).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('regression: parseWorkflowYaml correctly resolves canonical metadata from client-emitted YAML', async () => {
    const parsed = await parseWorkflowYaml(CLIENT_EMITTED_YAML);

    expect(parsed.name).toBe('Work Pickup');
    expect(parsed.description).toContain('assigning Ready cards');
    // Steps must be surfaced under their normalised server types.
    expect(parsed.steps.map((s) => s.type)).toEqual(['route', 'agent_run', 'notify']);
    expect(parsed.steps[1]).toMatchObject({ type: 'agent_run', agent: 'coordinator' });
  });

  it('regression: null/missing spec does not trigger both name+steps errors (edge case)', () => {
    // If the client emits `spec:` with no children, js-yaml parses spec as null.
    // Before the isRecord(spec) guard was removed, both errors fired simultaneously.
    const yamlWithNullSpec = `\
apiVersion: squad.io/v1
kind: Ceremony
metadata:
  name: work-pickup
  displayName: Work Pickup
spec:
`;
    const result = validateWorkflowYaml(yamlWithNullSpec);
    // name is extracted from metadata.displayName → passes.
    // steps is undefined → fails, but that is the ONLY error.
    expect(result.errors).not.toContain("'name' is required and must be a string");
    expect(result.errors).toContain("'steps' is required and must be a non-empty array");
  });
});

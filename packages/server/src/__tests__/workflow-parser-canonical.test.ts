import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseWorkflowYaml, validateWorkflowYaml } from '../services/workflow-parser.js';

const WORK_PICKUP_YAML = readFileSync(
  resolve(process.cwd(), 'src/ceremonies/built-in/work-pickup.workflow.yaml'),
  'utf-8',
);

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
});

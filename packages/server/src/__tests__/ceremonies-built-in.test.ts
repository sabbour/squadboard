/**
 * ceremonies-built-in.test.ts — CER-2: Unit tests for the built-in ceremony
 * YAML strings and their compatibility with the CER-3 parser.
 */

import { describe, it, expect } from 'vitest';
import { BUILT_IN_CEREMONIES, getBuiltInCeremonyMetadata } from '../ceremonies/built-in/index.js';
import { parseWorkflowYaml } from '../ceremonies/yaml-canonicalize.js';

describe('BUILT_IN_CEREMONIES', () => {
  it('has the expected built-in ceremonies', () => {
    expect(BUILT_IN_CEREMONIES).toHaveLength(7);
  });

  it('has the expected names in order', () => {
    const names = BUILT_IN_CEREMONIES.map((c) => c.name);
    expect(names).toEqual([
      'scribe-close-out',
      'work-pickup',
      'sprint-planning',
      'sprint-retro',
      'design-review',
      'retrospective',
      'retro-enforcement',
    ]);
  });

  it('each ceremony YAML passes the CER-3 parser without throwing', () => {
    for (const ceremony of BUILT_IN_CEREMONIES) {
      expect(() => parseWorkflowYaml(ceremony.yamlContent)).not.toThrow();
    }
  });

  it('each parsed ceremony metadata.name matches its entry name', () => {
    for (const ceremony of BUILT_IN_CEREMONIES) {
      const parsed = parseWorkflowYaml(ceremony.yamlContent);
      expect(parsed.metadata.name).toBe(ceremony.name);
    }
  });

  it('Work Pickup and Scribe Close-Out carry the core classification', () => {
    for (const name of ['work-pickup', 'scribe-close-out']) {
      const entry = BUILT_IN_CEREMONIES.find((c) => c.name === name)!;
      expect(entry).toBeDefined();
      expect(entry.category).toBe('core');
      expect(entry.tags).toContain('core');

      const parsed = parseWorkflowYaml(entry.yamlContent);
      expect(parsed.metadata.category).toBe('core');
      expect(parsed.metadata.tags).toContain('core');
      expect(getBuiltInCeremonyMetadata(name)).toEqual({ category: 'core', tags: ['core'] });
    }
  });

  it('design-review has trigger.type === github-event', () => {
    const dr = BUILT_IN_CEREMONIES.find((c) => c.name === 'design-review')!;
    expect(dr).toBeDefined();
    const parsed = parseWorkflowYaml(dr.yamlContent);
    expect(parsed.spec.trigger.type).toBe('github-event');
  });

  it('planning, retro, retrospective, and retro-enforcement have trigger.type === manual', () => {
    const manualNames = ['sprint-planning', 'sprint-retro', 'retrospective', 'retro-enforcement'];
    for (const name of manualNames) {
      const entry = BUILT_IN_CEREMONIES.find((c) => c.name === name)!;
      expect(entry).toBeDefined();
      const parsed = parseWorkflowYaml(entry.yamlContent);
      expect(parsed.spec.trigger.type).toBe('manual');
    }
  });
});

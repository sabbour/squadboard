/**
 * ceremony-origin.test.ts — CER-1: verify origin derivation logic against fixture ceremonies.
 */

import { describe, it, expect } from 'vitest';
import { deriveOrigin, ORIGIN_LABELS, type CeremonyOrigin } from '../services/ceremony-origin.js';

describe('deriveOrigin', () => {
  it('returns user-created when no provenance signals present', () => {
    expect(deriveOrigin({})).toBe('user-created');
    expect(deriveOrigin({ parentNarrativeId: null })).toBe('user-created');
    expect(deriveOrigin({ parentNarrativeId: undefined })).toBe('user-created');
  });

  it('returns conjure-llm when parentNarrativeId is non-null', () => {
    expect(deriveOrigin({ parentNarrativeId: 'abc-123' })).toBe('conjure-llm');
    expect(deriveOrigin({ parentNarrativeId: '00000000-0000-0000-0000-000000000001' })).toBe('conjure-llm');
  });

  it('returns built-in when templateId is present (reserved for CER-2)', () => {
    expect(deriveOrigin({ templateId: 'design-review' })).toBe('built-in');
  });

  it('returns core when templateId is "core"', () => {
    expect(deriveOrigin({ templateId: 'core' })).toBe('core');
  });

  it('core takes precedence over yaml-import', () => {
    expect(deriveOrigin({ templateId: 'core', sourceYamlPath: 'foo.yaml' })).toBe('core');
  });

  it('returns yaml-import when sourceYamlPath is present (reserved for yaml-import feature)', () => {
    expect(deriveOrigin({ sourceYamlPath: '.squad/ceremonies/retrospective.workflow.yaml' })).toBe('yaml-import');
  });

  it('built-in takes precedence over yaml-import', () => {
    expect(
      deriveOrigin({ templateId: 'retro', sourceYamlPath: 'foo.yaml' }),
    ).toBe('built-in');
  });

  it('yaml-import takes precedence over conjure-llm', () => {
    expect(
      deriveOrigin({ sourceYamlPath: 'foo.yaml', parentNarrativeId: 'abc-123' }),
    ).toBe('yaml-import');
  });

  it('built-in takes precedence over conjure-llm', () => {
    expect(
      deriveOrigin({ templateId: 'tmpl', parentNarrativeId: 'abc-123' }),
    ).toBe('built-in');
  });

  it('result is a valid CeremonyOrigin', () => {
    const validOrigins: CeremonyOrigin[] = ['core', 'built-in', 'yaml-import', 'conjure-llm', 'user-created'];
    const fixtures = [
      {},
      { parentNarrativeId: 'abc' },
      { templateId: 'design-review' },
      { templateId: 'core' },
      { sourceYamlPath: 'foo.yaml' },
    ];
    for (const fixture of fixtures) {
      expect(validOrigins).toContain(deriveOrigin(fixture));
    }
  });
});

describe('ORIGIN_LABELS', () => {
  it('has a label for every origin value', () => {
    const origins: CeremonyOrigin[] = ['core', 'built-in', 'yaml-import', 'conjure-llm', 'user-created'];
    for (const origin of origins) {
      expect(ORIGIN_LABELS[origin]).toBeTruthy();
    }
  });

  it('labels are human-readable strings', () => {
    expect(ORIGIN_LABELS['built-in']).toBe('Built-in');
    expect(ORIGIN_LABELS['yaml-import']).toBe('YAML');
    expect(ORIGIN_LABELS['conjure-llm']).toBe('Conjure');
    expect(ORIGIN_LABELS['user-created']).toBe('User');
  });
});

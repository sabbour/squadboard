/**
 * charter-compiler.test.ts — W29 MC-14 smoke tests for charter-compiler.ts
 * after the identity seam was extracted into charter-identity.ts.
 *
 * These tests verify that the public API of charter-compiler.ts is unchanged
 * and that computeContentHash continues to delegate correctly now that its
 * implementation lives in charter-identity.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  parseCharterContent,
  computeContentHash,
} from '../services/charter-compiler.js';

// ---------------------------------------------------------------------------
// computeContentHash — post-refactor delegation smoke test
// ---------------------------------------------------------------------------

describe('computeContentHash (delegates to hashCharterContent)', () => {
  it('returns a 32-char hex string', () => {
    const h = computeContentHash('# Agent\n');
    expect(h).toHaveLength(32);
    expect(h).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is deterministic', () => {
    const content = '# Verbal\n\n## Role\n\nLinguist\n';
    expect(computeContentHash(content)).toBe(computeContentHash(content));
  });

  it('accepts a Buffer', () => {
    const str = 'charter content';
    expect(computeContentHash(str)).toBe(computeContentHash(Buffer.from(str, 'utf-8')));
  });

  it('MD5 of "hello" is the well-known value', () => {
    expect(computeContentHash('hello')).toBe('5d41402abc4b2a76b9719d911017c592');
  });
});

// ---------------------------------------------------------------------------
// parseCharterContent — name extraction (verifies no regression from refactor)
// ---------------------------------------------------------------------------

describe('parseCharterContent — name extraction after MC-14 refactor', () => {
  it('extracts name from H1 heading', () => {
    const meta = parseCharterContent('# Verbal\n\n## Role\n\nLinguist\n');
    expect(meta.name).toBe('Verbal');
  });

  it('falls back to "unknown" when no H1 or identity table', () => {
    const meta = parseCharterContent('## Role\n\nAgent\n');
    expect(meta.name).toBe('unknown');
  });

  it('extracts name from identity table', () => {
    const md = '## Identity\n\n| Name | Hockney |\n| Role | Designer |\n\n## Role\n\nDesigner\n';
    const meta = parseCharterContent(md);
    expect(meta.name).toBe('Hockney');
  });
});

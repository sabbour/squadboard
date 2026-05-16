/**
 * charter-identity.test.ts — W29 MC-14 new tests for the extracted identity seam.
 *
 * Covers: hashCharterContent, shortHash, resolveCharterName, computeCharterIdentity.
 */

import { describe, it, expect } from 'vitest';
import {
  hashCharterContent,
  shortHash,
  resolveCharterName,
  computeCharterIdentity,
} from '../services/charter-identity.js';

// ---------------------------------------------------------------------------
// hashCharterContent
// ---------------------------------------------------------------------------

describe('hashCharterContent', () => {
  it('returns a 32-char lowercase hex string for empty input', () => {
    const h = hashCharterContent('');
    expect(h).toHaveLength(32);
    expect(h).toMatch(/^[0-9a-f]{32}$/);
  });

  it('returns the well-known MD5 of "hello"', () => {
    // MD5("hello") = 5d41402abc4b2a76b9719d911017c592
    expect(hashCharterContent('hello')).toBe('5d41402abc4b2a76b9719d911017c592');
  });

  it('is deterministic — same input always produces same hash', () => {
    const content = '# Verbal\n\n## Role\n\nLinguist\n';
    expect(hashCharterContent(content)).toBe(hashCharterContent(content));
  });

  it('accepts a Buffer as well as a string', () => {
    const str = 'test content';
    const buf = Buffer.from(str, 'utf-8');
    expect(hashCharterContent(str)).toBe(hashCharterContent(buf));
  });

  it('is sensitive to whitespace — different whitespace → different hash', () => {
    // Content hashing is raw; callers must not assume whitespace normalisation.
    const a = hashCharterContent('# Agent\n');
    const b = hashCharterContent('# Agent\n\n');
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// shortHash
// ---------------------------------------------------------------------------

describe('shortHash', () => {
  it('returns the first 8 characters of a full hash', () => {
    const full = '5d41402abc4b2a76b9719d911017c592';
    expect(shortHash(full)).toBe('5d41402a');
  });

  it('returns lowercase (inherits case from input)', () => {
    expect(shortHash('abcdef1234567890abcdef1234567890')).toBe('abcdef12');
  });
});

// ---------------------------------------------------------------------------
// resolveCharterName
// ---------------------------------------------------------------------------

describe('resolveCharterName', () => {
  it('reads name from the first H1 heading', () => {
    const md = '# Verbal\n\n## Role\n\nLinguist\n';
    expect(resolveCharterName(md)).toBe('Verbal');
  });

  it('reads name from a Markdown identity table row', () => {
    const md = '## Identity\n\n| Name | Hockney |\n| Role | Designer |\n\n## Role\n\nDesigner\n';
    expect(resolveCharterName(md)).toBe('Hockney');
  });

  it('reads name from a bold list item in an identity block', () => {
    const md = '## About\n\n- **Name:** Jude\n- **Role:** Coordinator\n';
    expect(resolveCharterName(md)).toBe('Jude');
  });

  it('falls back to filenameHint when no name is in the content', () => {
    const md = '## Role\n\nAgent\n';
    expect(resolveCharterName(md, 'my-agent')).toBe('my-agent');
  });

  it('falls back to "unknown-agent" when both content and filenameHint are absent', () => {
    expect(resolveCharterName('## Role\n\nAgent\n')).toBe('unknown-agent');
  });

  it('H1 takes priority over identity table', () => {
    const md = '# FromH1\n\n## Identity\n\n| Name | FromTable |\n';
    expect(resolveCharterName(md)).toBe('FromH1');
  });

  it('name is returned as-is (no kebab-casing applied)', () => {
    // Current implementation preserves case and spaces.
    expect(resolveCharterName('# Code Reviewer\n')).toBe('Code Reviewer');
    expect(resolveCharterName('# Verbal\n')).toBe('Verbal');
  });
});

// ---------------------------------------------------------------------------
// computeCharterIdentity
// ---------------------------------------------------------------------------

describe('computeCharterIdentity', () => {
  it('returns all three fields populated', () => {
    const md = '# Verbal\n\n## Role\n\nLinguist\n';
    const id = computeCharterIdentity(md);
    expect(id.name).toBe('Verbal');
    expect(id.contentHash).toHaveLength(32);
    expect(id.hash).toHaveLength(8);
    expect(id.contentHash.startsWith(id.hash)).toBe(true);
  });

  it('is deterministic — two calls with identical content return identical identity', () => {
    const md = '# Verbal\n\n## Role\n\nLinguist\n';
    const a = computeCharterIdentity(md);
    const b = computeCharterIdentity(md);
    expect(a).toEqual(b);
  });

  it('uses filenameHint as name when charter has no heading', () => {
    const id = computeCharterIdentity('## Role\n\nAgent\n', 'fallback-name');
    expect(id.name).toBe('fallback-name');
  });
});

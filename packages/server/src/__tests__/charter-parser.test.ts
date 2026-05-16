/**
 * charter-parser.test.ts — W26 regression tests for charter model parsing.
 *
 * Verifies that the `## Model` section parser correctly:
 *   - Strips markdown bold prefix from "**Preferred:** auto" style bullets
 *   - Treats "auto" and "default" as sentinels → model is undefined (omitted)
 *   - Passes through real model ids cleanly
 *   - Returns undefined when the section is absent or the value is empty
 */

import { describe, it, expect } from 'vitest';
import { parseCharterContent } from '../services/charter-compiler.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function charterWithModel(modelSection: string): string {
  return `# TestAgent\n\n## Role\n\nTest role\n\n## Model\n\n${modelSection}\n`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseCharterContent — ## Model section', () => {
  it('**Preferred:** auto → model is undefined (sentinel)', () => {
    const meta = parseCharterContent(charterWithModel('- **Preferred:** auto'));
    expect(meta.model).toBeUndefined();
  });

  it('**Preferred:** claude-sonnet-4.6 → "claude-sonnet-4.6"', () => {
    const meta = parseCharterContent(charterWithModel('- **Preferred:** claude-sonnet-4.6'));
    expect(meta.model).toBe('claude-sonnet-4.6');
  });

  it('Preferred: auto (no bold) → model is undefined (sentinel)', () => {
    const meta = parseCharterContent(charterWithModel('- Preferred: auto'));
    expect(meta.model).toBeUndefined();
  });

  it('No ## Model section → model is undefined', () => {
    const content = '# TestAgent\n\n## Role\n\nTest role\n';
    const meta = parseCharterContent(content);
    expect(meta.model).toBeUndefined();
  });

  it('**Preferred:**  (empty after colon) → model is undefined', () => {
    // The bold regex requires at least one char after ":** " — this tests the
    // plain bullet path where everything after stripping leaves an empty string.
    const meta = parseCharterContent(charterWithModel('- **Preferred:**'));
    expect(meta.model).toBeUndefined();
  });

  it('**Preferred:** default → model is undefined (sentinel)', () => {
    const meta = parseCharterContent(charterWithModel('- **Preferred:** default'));
    expect(meta.model).toBeUndefined();
  });

  it('**Preferred:** gpt-5.4 → "gpt-5.4"', () => {
    const meta = parseCharterContent(charterWithModel('- **Preferred:** gpt-5.4'));
    expect(meta.model).toBe('gpt-5.4');
  });

  it('auto → coordinator annotation after arrow is ignored, model is undefined', () => {
    // Format seen in squad agent charters: "- **Preferred:** auto → coordinator selected …"
    const meta = parseCharterContent(
      charterWithModel('- **Preferred:** auto → coordinator selected sonnet-4.6 (code-quality task)'),
    );
    expect(meta.model).toBeUndefined();
  });

  it('plain bare model id without Preferred: prefix → passed through', () => {
    // A charter that just lists the model name directly under ## Model
    const meta = parseCharterContent(charterWithModel('claude-opus-4.7'));
    expect(meta.model).toBe('claude-opus-4.7');
  });

  it('Preferred: claude-opus-4.6 (plain, no bold) → "claude-opus-4.6"', () => {
    const meta = parseCharterContent(charterWithModel('- Preferred: claude-opus-4.6'));
    expect(meta.model).toBe('claude-opus-4.6');
  });
});

describe('parseCharterContent — W27 Bug A: key allowlist + backtick stripping', () => {
  it('**Preferred:** auto followed by **Rationale:** prose → model is undefined (rationale ignored)', () => {
    const section = [
      '- **Preferred:** auto',
      '- **Rationale:** Coordinator selects the best model based on task type',
    ].join('\n');
    const meta = parseCharterContent(charterWithModel(section));
    expect(meta.model).toBeUndefined();
  });

  it('**Preferred:** `claude-haiku-4.5` (backtick-wrapped) → "claude-haiku-4.5"', () => {
    const meta = parseCharterContent(charterWithModel('- **Preferred:** `claude-haiku-4.5`'));
    expect(meta.model).toBe('claude-haiku-4.5');
  });

  it('**Preferred:** **claude-sonnet-4.6** (double-bold wrapped) → "claude-sonnet-4.6"', () => {
    const meta = parseCharterContent(charterWithModel('- **Preferred:** **claude-sonnet-4.6**'));
    expect(meta.model).toBe('claude-sonnet-4.6');
  });

  it('**Preferred:** default → model is undefined (sentinel)', () => {
    const meta = parseCharterContent(charterWithModel('- **Preferred:** default'));
    expect(meta.model).toBeUndefined();
  });

  it('**Preferred:** auto alone → model is undefined', () => {
    const meta = parseCharterContent(charterWithModel('- **Preferred:** auto'));
    expect(meta.model).toBeUndefined();
  });

  it('**Rationale:** before **Preferred:** → Rationale is ignored; model set from Preferred', () => {
    const section = [
      '- **Rationale:** something about this agent',
      '- **Preferred:** claude-opus-4.7',
    ].join('\n');
    const meta = parseCharterContent(charterWithModel(section));
    expect(meta.model).toBe('claude-opus-4.7');
  });

  it('**Fallback:** after valid **Preferred:** → Fallback key is ignored, model unchanged', () => {
    const section = [
      '- **Preferred:** claude-opus-4.7',
      '- **Fallback:** auto',
    ].join('\n');
    const meta = parseCharterContent(charterWithModel(section));
    expect(meta.model).toBe('claude-opus-4.7');
  });
});

describe('parseCharterContent — identity_table model sentinel guard', () => {
  it('identity table with Model: auto → model is undefined', () => {
    const content = `# TestAgent\n\n## Identity\n\n| Model | auto |\n\n## Role\n\nTest role\n`;
    const meta = parseCharterContent(content);
    expect(meta.model).toBeUndefined();
  });

  it('identity table with Model: claude-sonnet-4.6 → "claude-sonnet-4.6"', () => {
    const content = `# TestAgent\n\n## Identity\n\n| Model | claude-sonnet-4.6 |\n\n## Role\n\nTest role\n`;
    const meta = parseCharterContent(content);
    expect(meta.model).toBe('claude-sonnet-4.6');
  });
});

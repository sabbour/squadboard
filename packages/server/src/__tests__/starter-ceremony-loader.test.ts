/**
 * starter-ceremony-loader.test.ts — CER-9
 *
 * Tests that the starter ceremony loader:
 * 1. Reads *.workflow.yaml entries from a starter's meta.json files array
 * 2. Imports each via importCeremonyFromYaml
 * 3. Reports results + errors correctly
 * 4. bug-triage starter meta.json has triage-review.workflow.yaml in files
 * 5. content-creation starter meta.json has editorial-review.workflow.yaml in files
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Mock importCeremonyFromYaml
// ---------------------------------------------------------------------------

const importCalls: { yamlText: string; projectId: string }[] = [];
let importShouldThrow = false;

vi.mock('../services/ceremony-yaml-import.js', () => ({
  importCeremonyFromYaml: vi.fn(async (yamlText: string, projectId: string) => {
    if (importShouldThrow) throw new Error('mock import failure');
    importCalls.push({ yamlText, projectId });
    return { ceremonyId: 'loaded-ceremony-id', created: true };
  }),
}));

// ---------------------------------------------------------------------------
// fs mock — serves up in-memory YAML files per slug
// ---------------------------------------------------------------------------

const TRIAGE_YAML = `apiVersion: squad.io/v1
kind: Ceremony
metadata:
  name: triage-review
  displayName: Triage Review
  description: Run after each batch of triage to spot-check the routing decisions
spec:
  trigger:
    type: agent-signal
    signalName: after-batch
  steps:
    - id: review-batch
      kind: agent-task
      agentName: issue-classifier
      prompt: |
        Review the last batch of triaged issues.
`;

const EDITORIAL_YAML = `apiVersion: squad.io/v1
kind: Ceremony
metadata:
  name: editorial-review
  displayName: Editorial Review
  description: Run after each draft is written to ensure quality
spec:
  trigger:
    type: agent-signal
    signalName: after-draft
  steps:
    - id: review-draft
      kind: agent-task
      agentName: editor
      prompt: |
        Review the most recently completed draft.
`;

const STARTER_FILES: Record<string, Record<string, string>> = {
  'bug-triage': {
    'meta.json': JSON.stringify({
      slug: 'bug-triage',
      files: ['README.md', 'triage-review.workflow.yaml'],
      ceremonyCount: 2,
    }),
    'triage-review.workflow.yaml': TRIAGE_YAML,
  },
  'content-creation': {
    'meta.json': JSON.stringify({
      slug: 'content-creation',
      files: ['README.md', 'editorial-review.workflow.yaml'],
      ceremonyCount: 2,
    }),
    'editorial-review.workflow.yaml': EDITORIAL_YAML,
  },
  'no-ceremonies': {
    'meta.json': JSON.stringify({
      slug: 'no-ceremonies',
      files: ['README.md', 'index.ts'],
      ceremonyCount: 0,
    }),
  },
};

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn(async (filePath: string, encoding: string) => {
      const parts = filePath.split(path.sep);
      // Find the starter slug by locating 'starters' in the path
      const startersIdx = parts.indexOf('starters');
      if (startersIdx === -1) throw new Error(`ENOENT: ${filePath}`);
      const slug = parts[startersIdx + 1];
      const fileName = parts[startersIdx + 2];
      const content = STARTER_FILES[slug]?.[fileName];
      if (content === undefined) throw new Error(`ENOENT: ${filePath}`);
      return content;
    }),
  },
}));

// ---------------------------------------------------------------------------
// Import service after mocks
// ---------------------------------------------------------------------------

import { loadStarterCeremonies } from '../services/starter-ceremony-loader.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('loadStarterCeremonies — bug-triage', () => {
  beforeEach(() => {
    importCalls.length = 0;
    importShouldThrow = false;
  });

  it('loads triage-review.workflow.yaml and imports it', async () => {
    const result = await loadStarterCeremonies('bug-triage', 'proj-bt-1');

    expect(result.starterSlug).toBe('bug-triage');
    expect(result.projectId).toBe('proj-bt-1');
    expect(result.loaded).toHaveLength(1);
    expect(result.loaded[0].slug).toBe('triage-review');
    expect(result.loaded[0].error).toBeNull();
    expect(result.loaded[0].result?.created).toBe(true);
    expect(result.errorCount).toBe(0);
  });

  it('passes the correct YAML to importCeremonyFromYaml', async () => {
    await loadStarterCeremonies('bug-triage', 'proj-bt-2');

    expect(importCalls).toHaveLength(1);
    expect(importCalls[0].projectId).toBe('proj-bt-2');
    expect(importCalls[0].yamlText).toContain('apiVersion: squad.io/v1');
    expect(importCalls[0].yamlText).toContain('triage-review');
    expect(importCalls[0].yamlText).toContain('after-batch');
  });
});

describe('loadStarterCeremonies — content-creation', () => {
  beforeEach(() => {
    importCalls.length = 0;
    importShouldThrow = false;
  });

  it('loads editorial-review.workflow.yaml and imports it', async () => {
    const result = await loadStarterCeremonies('content-creation', 'proj-cc-1');

    expect(result.starterSlug).toBe('content-creation');
    expect(result.loaded).toHaveLength(1);
    expect(result.loaded[0].slug).toBe('editorial-review');
    expect(result.loaded[0].error).toBeNull();
    expect(result.errorCount).toBe(0);
  });

  it('passes the editorial YAML to importCeremonyFromYaml', async () => {
    await loadStarterCeremonies('content-creation', 'proj-cc-2');

    expect(importCalls[0].yamlText).toContain('editorial-review');
    expect(importCalls[0].yamlText).toContain('after-draft');
    expect(importCalls[0].yamlText).toContain('editor');
  });
});

describe('loadStarterCeremonies — edge cases', () => {
  beforeEach(() => {
    importCalls.length = 0;
    importShouldThrow = false;
  });

  it('returns empty loaded array when starter has no *.workflow.yaml files', async () => {
    const result = await loadStarterCeremonies('no-ceremonies', 'proj-nc-1');
    expect(result.loaded).toHaveLength(0);
    expect(result.errorCount).toBe(0);
    expect(importCalls).toHaveLength(0);
  });

  it('captures import errors per-ceremony without throwing', async () => {
    importShouldThrow = true;
    const result = await loadStarterCeremonies('bug-triage', 'proj-bt-err');

    expect(result.loaded).toHaveLength(1);
    expect(result.loaded[0].error).toContain('mock import failure');
    expect(result.loaded[0].result).toBeNull();
    expect(result.errorCount).toBe(1);
  });

  it('throws if meta.json cannot be read', async () => {
    await expect(loadStarterCeremonies('nonexistent-starter', 'proj-x')).rejects.toThrow(
      /cannot read meta\.json/,
    );
  });
});

describe('starter meta.json shape assertions', () => {
  it('bug-triage meta has triage-review.workflow.yaml in files', () => {
    const meta = JSON.parse(STARTER_FILES['bug-triage']['meta.json']);
    expect(meta.files).toContain('triage-review.workflow.yaml');
    expect(meta.ceremonyCount).toBeGreaterThanOrEqual(2);
  });

  it('content-creation meta has editorial-review.workflow.yaml in files', () => {
    const meta = JSON.parse(STARTER_FILES['content-creation']['meta.json']);
    expect(meta.files).toContain('editorial-review.workflow.yaml');
    expect(meta.ceremonyCount).toBeGreaterThanOrEqual(2);
  });
});

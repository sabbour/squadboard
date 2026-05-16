/**
 * seed-built-in.test.ts — CER-2: Unit tests for seedBuiltInCeremonies.
 *
 * All DB interactions are mocked via the ceremony-yaml-import service mock.
 * Tests verify idempotency, per-ceremony error isolation, and SeedResult shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the import service — all seeding flows through importCeremonyFromYaml
// ---------------------------------------------------------------------------

let importCallCount = 0;
let importResults: Array<{ ceremonyId: string; created: boolean }> = [];
let importShouldThrow: string | null = null;
let throwOnName: string | null = null;

vi.mock('../services/ceremony-yaml-import.js', () => ({
  importCeremonyFromYaml: vi.fn(async (yamlText: string, _projectId: string) => {
    importCallCount++;
    // Allow per-ceremony throw based on name embedded in yaml
    if (throwOnName && yamlText.includes(`name: ${throwOnName}`)) {
      throw new Error(`Mock import failure for ${throwOnName}`);
    }
    if (importShouldThrow) {
      throw new Error(importShouldThrow);
    }
    return importResults.shift() ?? { ceremonyId: `id-${importCallCount}`, created: true };
  }),
}));

// Mock the built-in index so we don't depend on filesystem reads in tests
vi.mock('../ceremonies/built-in/index.js', () => ({
  BUILT_IN_CEREMONIES: [
    { name: 'design-review', yamlContent: 'apiVersion: squad.io/v1\nkind: Ceremony\nmetadata:\n  name: design-review\nspec:\n  trigger:\n    type: github-event\n    event: pull_request\n  steps: []\n' },
    { name: 'retrospective', yamlContent: 'apiVersion: squad.io/v1\nkind: Ceremony\nmetadata:\n  name: retrospective\nspec:\n  trigger:\n    type: manual\n  steps: []\n' },
    { name: 'retro-enforcement', yamlContent: 'apiVersion: squad.io/v1\nkind: Ceremony\nmetadata:\n  name: retro-enforcement\nspec:\n  trigger:\n    type: manual\n  steps: []\n' },
  ],
}));

// ---------------------------------------------------------------------------
// Import seeder after mocks
// ---------------------------------------------------------------------------

import { seedBuiltInCeremonies } from '../ceremonies/seed-built-in.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('seedBuiltInCeremonies', () => {
  beforeEach(() => {
    importCallCount = 0;
    importResults = [];
    importShouldThrow = null;
    throwOnName = null;
    vi.clearAllMocks();
  });

  it('seeds 3 ceremonies on a fresh project — all created=true', async () => {
    importResults = [
      { ceremonyId: 'c1', created: true },
      { ceremonyId: 'c2', created: true },
      { ceremonyId: 'c3', created: true },
    ];

    const result = await seedBuiltInCeremonies('proj-1');

    expect(result.projectId).toBe('proj-1');
    expect(result.seeded).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
    expect(result.seeded.every((s) => s.created === true)).toBe(true);
  });

  it('re-running seed on same project returns created=false (upsert path)', async () => {
    importResults = [
      { ceremonyId: 'c1', created: false },
      { ceremonyId: 'c2', created: false },
      { ceremonyId: 'c3', created: false },
    ];

    const result = await seedBuiltInCeremonies('proj-1');

    expect(result.seeded).toHaveLength(3);
    expect(result.seeded.every((s) => s.created === false)).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('different project id seeds 3 new ceremonies', async () => {
    importResults = [
      { ceremonyId: 'd1', created: true },
      { ceremonyId: 'd2', created: true },
      { ceremonyId: 'd3', created: true },
    ];

    const result = await seedBuiltInCeremonies('proj-2');

    expect(result.projectId).toBe('proj-2');
    expect(result.seeded).toHaveLength(3);
    expect(result.seeded.map((s) => s.ceremonyId)).toEqual(['d1', 'd2', 'd3']);
  });

  it('returns SeedResult with seeded.length===3 and errors.length===0 on full success', async () => {
    importResults = [
      { ceremonyId: 'x1', created: true },
      { ceremonyId: 'x2', created: true },
      { ceremonyId: 'x3', created: true },
    ];

    const result = await seedBuiltInCeremonies('proj-x');

    expect(result).toMatchObject({
      projectId: 'proj-x',
      seeded: expect.arrayContaining([
        expect.objectContaining({ name: 'design-review' }),
        expect.objectContaining({ name: 'retrospective' }),
        expect.objectContaining({ name: 'retro-enforcement' }),
      ]),
      errors: [],
    });
    expect(result.seeded).toHaveLength(3);
  });

  it('if import service throws for one ceremony — continues with others, records error', async () => {
    throwOnName = 'retrospective';
    importResults = [
      { ceremonyId: 'c1', created: true },
      // retro throws, will be skipped
      { ceremonyId: 'c3', created: true },
    ];

    const result = await seedBuiltInCeremonies('proj-err');

    expect(result.seeded).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.name).toBe('retrospective');
    expect(result.errors[0]?.error).toMatch(/Mock import failure/);
  });

  it('imported ceremonies have the correct name in the seeded array', async () => {
    importResults = [
      { ceremonyId: 'c1', created: true },
      { ceremonyId: 'c2', created: true },
      { ceremonyId: 'c3', created: true },
    ];

    const result = await seedBuiltInCeremonies('proj-names');

    const seededNames = result.seeded.map((s) => s.name);
    expect(seededNames).toEqual(['design-review', 'retrospective', 'retro-enforcement']);
  });
});

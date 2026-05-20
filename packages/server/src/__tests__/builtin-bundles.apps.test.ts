import { beforeEach, describe, expect, it } from 'vitest';
import {
  getBuiltinBundle,
  getBuiltinBundleDir,
  getBuiltinBundleWarnings,
  getBuiltinProjectTemplateBundles,
  getBuiltinSquadboardApps,
  resetBuiltinBundleCache,
} from '../services/builtin-bundles.js';

const VISIBLE_TEMPLATE_IDS = [
  'content-writing-project',
  'feature-kanban',
  'open-source-project',
  'research-spike',
];

const HIDDEN_TEMPLATE_IDS = [
  'default-software-project',
  'ai-agent-project',
  'bug-bash-project',
  'library-or-sdk-project',
  'ops-runbook-project',
];

describe('built-in bundle catalog surfaces', () => {
  beforeEach(() => {
    resetBuiltinBundleCache();
  });

  it('shows only the curated built-in Project Template types', async () => {
    const templates = await getBuiltinProjectTemplateBundles();

    expect(templates.map((entry) => entry.bundleId)).toEqual(VISIBLE_TEMPLATE_IDS);
    expect(templates.map((entry) => entry.name)).toEqual([
      'Content Creation',
      'Feature Kanban',
      'Open Source',
      'Research Spike',
    ]);
    expect(templates.every((entry) => entry.catalog === 'template')).toBe(true);
    expect(templates.every((entry) => entry.kind === 'project-template')).toBe(true);

    const visibleIds = new Set(templates.map((entry) => entry.bundleId));
    for (const hiddenId of HIDDEN_TEMPLATE_IDS) {
      expect(visibleIds.has(hiddenId), `${hiddenId} must not be selectable`).toBe(false);
    }
  });

  it('keeps generic Project Templates separate from Squadboard Apps', async () => {
    const templates = await getBuiltinProjectTemplateBundles();
    const apps = await getBuiltinSquadboardApps();

    expect(apps.map((entry) => entry.bundleId)).toEqual(
      expect.arrayContaining(['squad-doc-review', 'squad-issues-router']),
    );
    expect(apps.every((entry) => entry.catalog === 'squadboard-app')).toBe(true);
    expect(apps.every((entry) => entry.kind === 'squadboard-app')).toBe(true);

    expect(getBuiltinBundleWarnings()).toEqual([]);

    const templateIds = new Set(templates.map((entry) => entry.bundleId));
    const appIds = new Set(apps.map((entry) => entry.bundleId));
    expect([...templateIds].some((id) => appIds.has(id))).toBe(false);
  });

  it('resolves local Squadboard App bundles from the same catalog entry users browse', async () => {
    const bundle = await getBuiltinBundle('squad-issues-router');
    const dir = await getBuiltinBundleDir('squad-issues-router');

    expect(bundle?.manifest.bundleId).toBe('squad-issues-router');
    expect(bundle?.project?.name).toBe('Squad Issues Router');
    expect(dir).toContain('squadboard-apps/squad-issues-router');
  });

  it('resolves the generalized Feature Kanban bundle by its new id', async () => {
    const bundle = await getBuiltinBundle('feature-kanban');
    const dir = await getBuiltinBundleDir('feature-kanban');

    expect(bundle?.manifest.bundleId).toBe('feature-kanban');
    expect(bundle?.manifest.name).toBe('Feature Kanban');
    expect(dir).toContain('bundles/feature-kanban');
  });
});

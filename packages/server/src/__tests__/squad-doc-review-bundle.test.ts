import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateWorkflowYaml } from '../services/workflow-parser.js';

const REPO_ROOT = resolve(process.cwd(), '../..');
const BUNDLE_PATH = resolve(REPO_ROOT, 'squadboard-apps/squad-doc-review/squad-bundle.json');

type Bundle = {
  project: {
    settings?: {
      docReview?: {
        contractVersion?: string;
        source?: Record<string, unknown>;
        reviewProfiles?: string[];
        schedule?: Record<string, unknown>;
        cursor?: { dedupeKey?: string[] };
        manual?: Record<string, unknown>;
        explicitQueue?: Record<string, unknown>;
        finalAction?: Record<string, unknown>;
        backendDependencies?: string[];
      };
    };
  };
  kanban: {
    columns: Array<{ slug: string; label: string; order: number }>;
    defaultColumn: string;
  };
  ceremonies: Array<{
    id: string;
    name: string;
    trigger: { kind: string; config?: Record<string, unknown> };
    workflowYaml: string;
  }>;
};

function loadBundle(): Bundle {
  return JSON.parse(readFileSync(BUNDLE_PATH, 'utf-8')) as Bundle;
}

describe('Squad Doc Review bundle', () => {
  it('keeps the docs review board distinct from the Issues Router triage board', () => {
    const bundle = loadBundle();

    expect(bundle.kanban.defaultColumn).toBe('backlog');
    expect(bundle.kanban.columns.map((column) => column.slug)).toEqual([
      'backlog',
      'ready',
      'technical-review',
      'reader-review',
      'maintainer-review',
      'done',
    ]);
  });

  it('declares both scheduled and manual doc review triggers', () => {
    const bundle = loadBundle();
    const scheduled = bundle.ceremonies.find((ceremony) => ceremony.id === 'squad-doc-review-scheduled');
    const manual = bundle.ceremonies.find((ceremony) => ceremony.id === 'squad-doc-review-manual');

    expect(scheduled?.trigger.kind).toBe('on_schedule');
    expect(scheduled?.trigger.config).toMatchObject({
      cron: '0 9 * * 1',
      cronExpr: '0 9 * * 1',
      timezone: 'UTC',
      configurable: true,
      contractVersion: 'squadboard.doc-review-intake.v1',
      owner: 'bradygaster',
      repo: 'squad',
      includeQueuedDocs: true,
      finalAction: 'create-or-update-squadboard-issues',
    });
    expect(scheduled?.trigger.config?.dedupeBy).toEqual(['repo', 'path', 'blobSha', 'commitSha', 'reviewProfile']);

    expect(manual?.trigger.kind).toBe('manual');
    expect(manual?.trigger.config).toMatchObject({
      contractVersion: 'squadboard.doc-review-intake.v1',
      supportedModes: ['selected-docs', 'changed-docs', 'configured-source'],
      defaultMode: 'selected-docs',
      finalAction: 'create-or-update-squadboard-issues',
    });
  });

  it('pins the reusable doc review intake contract in project settings', () => {
    const bundle = loadBundle();
    const docReview = bundle.project.settings?.docReview;

    expect(docReview).toMatchObject({
      contractVersion: 'squadboard.doc-review-intake.v1',
      source: {
        type: 'github-repo',
        owner: 'bradygaster',
        repo: 'squad',
        htmlUrl: 'https://github.com/bradygaster/squad',
      },
      reviewProfiles: ['technical-accuracy', 'reader-success', 'staleness'],
      schedule: {
        cron: '0 9 * * 1',
        cronExpr: '0 9 * * 1',
        timezone: 'UTC',
        configurable: true,
      },
    });
    expect(docReview?.cursor?.dedupeKey).toEqual(['repo', 'path', 'blobSha', 'commitSha', 'reviewProfile']);
    expect(docReview?.source?.includePaths).toEqual(['docs/**', 'README.md', 'CONTRIBUTING.md']);
  });

  it('uses review issues as the final action and does not auto-edit docs by default', () => {
    const bundle = loadBundle();
    const finalAction = bundle.project.settings?.docReview?.finalAction;

    expect(finalAction).toMatchObject({
      kind: 'create-or-update-squadboard-issues',
      groupBy: 'docPath',
      autoEditDocs: false,
    });
    expect(finalAction?.fields).toEqual([
      'docPath',
      'findingSummary',
      'severity',
      'ownerRecommendation',
      'suggestedPatchChecklist',
      'sourceSha',
      'reviewProfile',
    ]);
  });

  it('documents backend dependencies for runtime intake gaps', () => {
    const bundle = loadBundle();
    const dependencies = bundle.project.settings?.docReview?.backendDependencies ?? [];

    expect(dependencies.join('\n')).toContain('Reusable doc review intake');
    expect(dependencies.join('\n')).toContain('Manual ceremony runs exist');
    expect(dependencies.join('\n')).toContain('must not auto-edit docs');
  });

  it('keeps bundled workflow YAML valid for the current ceremony parser', () => {
    const bundle = loadBundle();

    for (const ceremony of bundle.ceremonies) {
      const result = validateWorkflowYaml(ceremony.workflowYaml);
      expect(result.valid, `${ceremony.id}: ${result.errors.join('; ')}`).toBe(true);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateWorkflowYaml } from '../services/workflow-parser.js';

const REPO_ROOT = resolve(process.cwd(), '../..');
const BUNDLE_PATH = resolve(REPO_ROOT, 'squadboard-apps/squad-issues-router/squad-bundle.json');

type Bundle = {
  project: {
    settings?: {
      githubIssueIntake?: Record<string, unknown>;
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

describe('Squad Issues Router bundle', () => {
  it('keeps the issue-router board intentionally small', () => {
    const bundle = loadBundle();

    expect(bundle.kanban.defaultColumn).toBe('triage');
    expect(bundle.kanban.columns.map((column) => column.slug)).toEqual([
      'triage',
      'needs-info',
      'done',
    ]);
  });

  it('declares scheduled incremental GitHub issue intake for bradygaster/squad', () => {
    const bundle = loadBundle();
    const intake = bundle.ceremonies.find((ceremony) => ceremony.id === 'squad-github-issue-intake');

    expect(intake).toBeDefined();
    expect(intake?.trigger.kind).toBe('on_schedule');
    expect(intake?.trigger.config).toMatchObject({
      cron: '0 */6 * * *',
      owner: 'bradygaster',
      repo: 'squad',
      sinceCursor: 'project.githubSyncLastAt',
      targetColumn: 'triage',
      excludePullRequests: true,
    });
    expect(intake?.trigger.config?.dedupeBy).toEqual(['githubIssueNumber', 'githubNodeId']);
  });

  it('pins the reusable backend intake contract in project settings', () => {
    const bundle = loadBundle();

    expect(bundle.project.settings?.githubIssueIntake).toMatchObject({
      contractVersion: 'squadboard.github-issue-intake.v1',
      owner: 'bradygaster',
      repo: 'squad',
      htmlUrl: 'https://github.com/bradygaster/squad',
      state: 'open',
      targetColumn: 'triage',
      triageCeremonyId: 'squad-issue-triage',
    });
    expect(bundle.project.settings?.githubIssueIntake?.dedupeBy).toEqual(['githubIssueNumber', 'githubNodeId']);
  });

  it('keeps bundled workflow YAML valid for the current ceremony parser', () => {
    const bundle = loadBundle();

    for (const ceremony of bundle.ceremonies) {
      const result = validateWorkflowYaml(ceremony.workflowYaml);
      expect(result.valid, `${ceremony.id}: ${result.errors.join('; ')}`).toBe(true);
    }
  });
});

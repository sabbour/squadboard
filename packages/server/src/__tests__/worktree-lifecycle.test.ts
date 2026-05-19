import { describe, expect, it } from 'vitest';
import {
  buildCloseOutLifecycleMetadata,
  buildRunLifecycleMetadata,
  deriveCleanupMetadata,
  normalizeRunState,
} from '../services/worktree-lifecycle.js';

describe('worktree lifecycle metadata', () => {
  it('normalizes run states into the shared lifecycle envelope', () => {
    expect(normalizeRunState(null)).toBe('idle');
    expect(normalizeRunState('pending')).toBe('pending');
    expect(normalizeRunState('splitting')).toBe('running');
    expect(normalizeRunState('completed')).toBe('completed');
    expect(normalizeRunState('unexpected')).toBe('unknown');
  });

  it('describes cleanup expectations without mutating worktrees', () => {
    expect(deriveCleanupMetadata({
      status: 'running',
      workspaceStrategy: 'worktree',
      workspacePath: '/repo-worktrees/run-1',
      worktreeExists: true,
    })).toMatchObject({ expected: false, status: 'not_ready' });

    expect(deriveCleanupMetadata({
      status: 'completed',
      workspaceStrategy: 'worktree',
      workspacePath: '/repo-worktrees/run-1',
      worktreeExists: true,
    })).toMatchObject({ expected: true, status: 'pending' });

    expect(deriveCleanupMetadata({
      status: 'completed',
      workspaceStrategy: 'worktree',
      workspacePath: '/repo-worktrees/run-1',
      worktreeExists: false,
    })).toMatchObject({ expected: true, status: 'cleaned' });
  });

  it('combines ceremony run state with issue-run worktree metadata', () => {
    const lifecycle = buildRunLifecycleMetadata({
      workflowRun: {
        id: 'workflow-run-1',
        status: 'running',
        createdAt: new Date('2026-05-18T10:00:00.000Z'),
        updatedAt: new Date('2026-05-18T10:05:00.000Z'),
      },
      issueRun: {
        id: 'issue-run-1',
        status: 'running',
        workspaceStrategy: 'worktree',
        workspacePath: '/repo-worktrees/squadboard-run-1',
        gitBranch: 'squad/verbal/ship-it',
        startedAt: new Date('2026-05-18T10:01:00.000Z'),
      },
      worktreeExists: true,
    });

    expect(lifecycle).toMatchObject({
      model: 'squadboard.lifecycle.v1',
      currentWaveId: 'workflow-run-1',
      currentRunId: 'workflow-run-1',
      currentIssueRunId: 'issue-run-1',
      runState: 'running',
      worktreePath: '/repo-worktrees/squadboard-run-1',
      branch: 'squad/verbal/ship-it',
      startedAt: '2026-05-18T10:01:00.000Z',
      endedAt: null,
      cleanup: { expected: false, status: 'not_ready' },
    });
  });

  it('uses the same lifecycle envelope for Scribe close-out waves', () => {
    const lifecycle = buildCloseOutLifecycleMetadata({
      currentWaveId: 'wave-8',
      currentRunId: 'spawn-wave-8',
      startedAt: new Date('2026-05-18T11:00:00.000Z'),
      endedAt: new Date('2026-05-18T11:00:02.000Z'),
      healthReportPath: '/repo/.squad/health/wave-8.md',
      closeoutReportPath: '/repo/.squad/reports/scribe-close-out.json',
    });

    expect(lifecycle).toMatchObject({
      currentWaveId: 'wave-8',
      currentRunId: 'spawn-wave-8',
      runState: 'completed',
      startedAt: '2026-05-18T11:00:00.000Z',
      endedAt: '2026-05-18T11:00:02.000Z',
      healthReportPath: '/repo/.squad/health/wave-8.md',
      closeoutReportPath: '/repo/.squad/reports/scribe-close-out.json',
      cleanup: { expected: false, status: 'not_applicable' },
    });
  });
});

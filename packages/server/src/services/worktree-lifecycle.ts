import fs from 'node:fs/promises';

export const LIFECYCLE_MODEL_VERSION = 'squadboard.lifecycle.v1' as const;

export type LifecycleRunState =
  | 'idle'
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'unknown';

export type LifecycleCleanupStatus =
  | 'not_applicable'
  | 'not_ready'
  | 'pending'
  | 'cleaned'
  | 'unknown';

export interface LifecycleRunLike {
  id?: string | null;
  status?: string | null;
  workspaceStrategy?: string | null;
  workspacePath?: string | null;
  gitBranch?: string | null;
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

export interface LifecycleCleanupMetadata {
  expected: boolean;
  status: LifecycleCleanupStatus;
  reason: string;
}

export interface CeremonyLifecycleMetadata {
  model: typeof LIFECYCLE_MODEL_VERSION;
  currentWaveId: string | null;
  currentRunId: string | null;
  currentIssueRunId: string | null;
  runState: LifecycleRunState;
  status: string | null;
  workspaceStrategy: string | null;
  workspacePath: string | null;
  worktreePath: string | null;
  branch: string | null;
  startedAt: string | null;
  endedAt: string | null;
  closeoutReportPath: string | null;
  healthReportPath: string | null;
  cleanup: LifecycleCleanupMetadata;
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'timed_out']);
const RUNNING_STATUSES = new Set(['running', 'splitting', 'waiting_children']);

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeRunState(status: string | null | undefined): LifecycleRunState {
  if (!status) return 'idle';
  if (status === 'pending') return 'pending';
  if (RUNNING_STATUSES.has(status)) return 'running';
  if (TERMINAL_STATUSES.has(status)) return status as LifecycleRunState;
  return 'unknown';
}

export function deriveCleanupMetadata(input: {
  status?: string | null;
  workspaceStrategy?: string | null;
  workspacePath?: string | null;
  worktreeExists?: boolean | null;
}): LifecycleCleanupMetadata {
  if (input.workspaceStrategy !== 'worktree' || !input.workspacePath) {
    return {
      expected: false,
      status: 'not_applicable',
      reason: 'Run is not using a git worktree workspace.',
    };
  }

  if (!TERMINAL_STATUSES.has(input.status ?? '')) {
    return {
      expected: false,
      status: 'not_ready',
      reason: 'Worktree is retained while the run is active or waiting to start.',
    };
  }

  if (input.worktreeExists === true) {
    return {
      expected: true,
      status: 'pending',
      reason: 'Terminal worktree is still present and should be cleaned up after close-out.',
    };
  }

  if (input.worktreeExists === false) {
    return {
      expected: true,
      status: 'cleaned',
      reason: 'Terminal worktree path is no longer present.',
    };
  }

  return {
    expected: true,
    status: 'unknown',
    reason: 'Terminal worktree cleanup state has not been checked.',
  };
}

export async function resolveWorktreeExists(worktreePath: string | null | undefined): Promise<boolean | null> {
  if (!worktreePath) return null;
  try {
    await fs.access(worktreePath);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'ENOENT' ? false : null;
  }
}

export function buildRunLifecycleMetadata(input: {
  workflowRun?: LifecycleRunLike | null;
  issueRun?: LifecycleRunLike | null;
  currentWaveId?: string | null;
  closeoutReportPath?: string | null;
  healthReportPath?: string | null;
  worktreeExists?: boolean | null;
}): CeremonyLifecycleMetadata {
  const workflowRun = input.workflowRun ?? null;
  const issueRun = input.issueRun ?? null;
  const status = issueRun?.status ?? workflowRun?.status ?? null;
  const workspaceStrategy = issueRun?.workspaceStrategy ?? null;
  const workspacePath = issueRun?.workspacePath ?? null;
  const worktreePath = workspaceStrategy === 'worktree' ? workspacePath : null;
  const issueRunEndedAt = TERMINAL_STATUSES.has(issueRun?.status ?? '')
    ? issueRun?.completedAt ?? issueRun?.updatedAt
    : null;
  const workflowRunEndedAt = TERMINAL_STATUSES.has(workflowRun?.status ?? '')
    ? workflowRun?.updatedAt
    : null;

  return {
    model: LIFECYCLE_MODEL_VERSION,
    currentWaveId: input.currentWaveId ?? workflowRun?.id ?? null,
    currentRunId: workflowRun?.id ?? issueRun?.id ?? null,
    currentIssueRunId: issueRun?.id ?? null,
    runState: normalizeRunState(status),
    status,
    workspaceStrategy,
    workspacePath,
    worktreePath,
    branch: issueRun?.gitBranch ?? null,
    startedAt: toIso(issueRun?.startedAt ?? issueRun?.createdAt ?? workflowRun?.createdAt),
    endedAt: toIso(issueRunEndedAt ?? workflowRunEndedAt),
    closeoutReportPath: input.closeoutReportPath ?? null,
    healthReportPath: input.healthReportPath ?? null,
    cleanup: deriveCleanupMetadata({
      status,
      workspaceStrategy,
      workspacePath: worktreePath,
      worktreeExists: input.worktreeExists,
    }),
  };
}

export function buildCloseOutLifecycleMetadata(input: {
  currentWaveId?: string | null;
  currentRunId?: string | null;
  startedAt: Date;
  endedAt: Date;
  closeoutReportPath?: string | null;
  healthReportPath?: string | null;
}): CeremonyLifecycleMetadata {
  const currentWaveId = input.currentWaveId ?? input.currentRunId ?? null;
  return {
    model: LIFECYCLE_MODEL_VERSION,
    currentWaveId,
    currentRunId: input.currentRunId ?? currentWaveId,
    currentIssueRunId: null,
    runState: 'completed',
    status: 'completed',
    workspaceStrategy: null,
    workspacePath: null,
    worktreePath: null,
    branch: null,
    startedAt: input.startedAt.toISOString(),
    endedAt: input.endedAt.toISOString(),
    closeoutReportPath: input.closeoutReportPath ?? null,
    healthReportPath: input.healthReportPath ?? null,
    cleanup: {
      expected: false,
      status: 'not_applicable',
      reason: 'Scribe close-out does not allocate a worktree.',
    },
  };
}

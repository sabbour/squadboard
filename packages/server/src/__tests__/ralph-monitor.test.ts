import { describe, expect, it } from 'vitest';
import {
  buildRalphMonitorAuditRecord,
  decideRalphMonitor,
  normalizeRalphMonitorSettings,
  prioritizeRalphWork,
  type RalphMonitorSettings,
  type RalphWorkCandidate,
} from '../services/ralph-monitor.js';

const baseSettings: RalphMonitorSettings = {
  projectId: 'project-1',
  autonomyEnabled: true,
  autoMergeEnabled: true,
  state: 'active',
  lastAction: null,
  nextAction: null,
  lastDecisionAt: null,
};

function candidate(kind: RalphWorkCandidate['kind'], id: string, createdAt = '2026-05-18T00:00:00.000Z'): RalphWorkCandidate {
  return {
    id,
    kind,
    projectId: 'project-1',
    title: `${kind} ${id}`,
    createdAt,
    issueId: `issue-${id}`,
    runId: kind === 'ready_unassigned_card' || kind === 'member_assigned_pickup' ? undefined : `run-${id}`,
    agentId: kind === 'member_assigned_pickup' ? 'agent-1' : undefined,
    agentName: kind === 'member_assigned_pickup' ? 'Ralph' : undefined,
    prNumber: kind === 'ready_unassigned_card' || kind === 'member_assigned_pickup' ? undefined : 42,
  };
}

describe('Ralph monitor policy', () => {
  it('defaults project opt-in to disabled and stopped', () => {
    const settings = normalizeRalphMonitorSettings({
      id: 'project-1',
      ralphAutonomyEnabled: null,
      ralphAutoMergeEnabled: null,
      ralphMonitorState: null,
      ralphMonitorLastDecisionAt: null,
    });

    expect(settings.autonomyEnabled).toBe(false);
    expect(settings.autoMergeEnabled).toBe(false);
    expect(settings.state).toBe('stopped');

    const decision = decideRalphMonitor({
      settings,
      candidates: [candidate('member_assigned_pickup', 'assigned')],
      now: new Date('2026-05-18T12:00:00.000Z'),
    });

    expect(decision.kind).toBe('no_action');
    expect(decision.reason).toBe('autonomy_disabled');
    expect(decision.nextState).toBe('stopped');
  });

  it('prioritizes candidates in Ralph parity order', () => {
    const candidates = [
      candidate('draft_attention', 'draft'),
      candidate('auto_merge_pr', 'merge'),
      candidate('review_changes', 'review'),
      candidate('ci_failure', 'ci'),
      candidate('member_assigned_pickup', 'assigned'),
      candidate('ready_unassigned_card', 'triage'),
    ];

    expect(prioritizeRalphWork(candidates, baseSettings)?.kind).toBe('ready_unassigned_card');
    expect(prioritizeRalphWork(candidates.slice(0, -1), baseSettings)?.kind).toBe('member_assigned_pickup');
    expect(prioritizeRalphWork([candidate('auto_merge_pr', 'merge')], { autoMergeEnabled: false })).toBeNull();
  });

  it('records a no-action idle audit decision', () => {
    const settings = { ...baseSettings, state: 'active' as const };
    const decision = decideRalphMonitor({
      settings,
      candidates: [],
      now: new Date('2026-05-18T12:00:00.000Z'),
    });
    const audit = buildRalphMonitorAuditRecord({
      projectId: settings.projectId,
      settings,
      decision,
      candidates: [],
    });

    expect(decision.kind).toBe('no_action');
    expect(decision.nextState).toBe('idle');
    expect(audit).toMatchObject({
      decision: 'no_action',
      action: 'none',
      reason: 'no_candidates',
      state: 'idle',
      selectedKind: null,
      targetId: null,
    });
  });

  it('selects an actionable assigned pickup decision', () => {
    const assigned = candidate('member_assigned_pickup', 'assigned');
    const decision = decideRalphMonitor({
      settings: { ...baseSettings, state: 'idle' },
      candidates: [assigned],
      now: new Date('2026-05-18T12:00:00.000Z'),
    });

    expect(decision.kind).toBe('action');
    expect(decision.nextState).toBe('active');
    expect(decision.selected).toBe(assigned);
    expect(decision.action).toMatchObject({
      type: 'dispatch_assigned_issue',
      targetType: 'issue',
      targetId: 'issue-assigned',
    });
  });
});

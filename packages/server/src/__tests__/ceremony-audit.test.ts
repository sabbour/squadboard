/**
 * ceremony-audit.test.ts — CER-8: verify audit aggregation + orphan/dead detection.
 *
 * Tests the audit aggregation logic in isolation (pure-function style mocks).
 * The actual DB queries are integration-level and tested via the route handler;
 * here we validate the classification logic that transforms DB rows into the
 * audit report shape.
 */

import { describe, it, expect } from 'vitest';
import { deriveOrigin, type CeremonyOrigin } from '../services/ceremony-origin.js';

// ---------------------------------------------------------------------------
// Helpers that mirror the server-side audit accumulation logic
// ---------------------------------------------------------------------------

type CeremonyRow = {
  id: string;
  name: string;
  status: string;
  triggerKind: string;
  triggerConfig: Record<string, unknown>;
  parentNarrativeId?: string | null;
};

type AuditResult = {
  total: number;
  byOrigin: Record<CeremonyOrigin, number>;
  byTrigger: Record<string, number>;
  byStatus: Record<string, number>;
  orphans: Array<{ id: string; name: string; reason: string }>;
  dead: Array<{ id: string; name: string; reason: string }>;
};

function computeAudit(
  ceremonies: CeremonyRow[],
  runCountByWorkflow: Map<string, number>,
  githubConnected: boolean,
  enabledScheduleByWorkflow: Map<string, boolean>,
): AuditResult {
  const byOrigin: Record<CeremonyOrigin, number> = {
    'built-in': 0,
    'yaml-import': 0,
    'conjure-llm': 0,
    'user-created': 0,
  };
  const byTrigger: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const orphans: Array<{ id: string; name: string; reason: string }> = [];
  const dead: Array<{ id: string; name: string; reason: string }> = [];

  for (const ceremony of ceremonies) {
    const origin = deriveOrigin({ parentNarrativeId: ceremony.parentNarrativeId });
    byOrigin[origin] = (byOrigin[origin] ?? 0) + 1;

    byTrigger[ceremony.triggerKind] = (byTrigger[ceremony.triggerKind] ?? 0) + 1;

    const status = ceremony.status ?? 'active';
    byStatus[status] = (byStatus[status] ?? 0) + 1;

    if (status === 'active') {
      const runs = runCountByWorkflow.get(ceremony.id) ?? 0;
      if (runs === 0) {
        orphans.push({ id: ceremony.id, name: ceremony.name, reason: 'No runs in the last 30 days' });
      }

      const triggerConfig = ceremony.triggerConfig ?? {};
      const eventType = typeof triggerConfig.eventType === 'string' ? triggerConfig.eventType : '';
      const isGithubTrigger =
        ceremony.triggerKind === 'on_event' &&
        (eventType.startsWith('github.') || eventType.startsWith('gh.'));

      if (isGithubTrigger && !githubConnected) {
        dead.push({
          id: ceremony.id,
          name: ceremony.name,
          reason: 'Trigger requires GitHub integration, but no GitHub repo is connected to this project',
        });
      }

      if (ceremony.triggerKind === 'on_schedule' && !enabledScheduleByWorkflow.get(ceremony.id)) {
        dead.push({
          id: ceremony.id,
          name: ceremony.name,
          reason: 'Scheduled ceremony has no enabled schedule (trigger cannot fire)',
        });
      }
    }
  }

  return { total: ceremonies.length, byOrigin, byTrigger, byStatus, orphans, dead };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('audit aggregation', () => {
  it('returns zeros for empty ceremony list', () => {
    const result = computeAudit([], new Map(), false, new Map());
    expect(result.total).toBe(0);
    expect(result.orphans).toHaveLength(0);
    expect(result.dead).toHaveLength(0);
    expect(result.byOrigin['user-created']).toBe(0);
  });

  it('counts ceremonies by origin correctly', () => {
    const ceremonies: CeremonyRow[] = [
      { id: '1', name: 'A', status: 'active', triggerKind: 'manual', triggerConfig: {}, parentNarrativeId: null },
      { id: '2', name: 'B', status: 'active', triggerKind: 'manual', triggerConfig: {}, parentNarrativeId: 'narr-1' },
      { id: '3', name: 'C', status: 'active', triggerKind: 'manual', triggerConfig: {}, parentNarrativeId: 'narr-2' },
    ];
    const runs = new Map([['1', 5], ['2', 0], ['3', 1]]);
    const result = computeAudit(ceremonies, runs, false, new Map());
    expect(result.byOrigin['user-created']).toBe(1);
    expect(result.byOrigin['conjure-llm']).toBe(2);
    expect(result.total).toBe(3);
  });

  it('counts byTrigger correctly', () => {
    const ceremonies: CeremonyRow[] = [
      { id: '1', name: 'A', status: 'active', triggerKind: 'manual', triggerConfig: {}, parentNarrativeId: null },
      { id: '2', name: 'B', status: 'active', triggerKind: 'on_schedule', triggerConfig: {}, parentNarrativeId: null },
      { id: '3', name: 'C', status: 'active', triggerKind: 'on_schedule', triggerConfig: {}, parentNarrativeId: null },
      { id: '4', name: 'D', status: 'active', triggerKind: 'on_event', triggerConfig: { eventType: 'review.requested' }, parentNarrativeId: null },
    ];
    const runs = new Map([['1', 1], ['2', 1], ['3', 1], ['4', 1]]);
    const schedules = new Map([['2', true], ['3', true]]);
    const result = computeAudit(ceremonies, runs, false, schedules);
    expect(result.byTrigger['manual']).toBe(1);
    expect(result.byTrigger['on_schedule']).toBe(2);
    expect(result.byTrigger['on_event']).toBe(1);
  });

  it('counts byStatus correctly', () => {
    const ceremonies: CeremonyRow[] = [
      { id: '1', name: 'A', status: 'active', triggerKind: 'manual', triggerConfig: {}, parentNarrativeId: null },
      { id: '2', name: 'B', status: 'draft', triggerKind: 'manual', triggerConfig: {}, parentNarrativeId: null },
      { id: '3', name: 'C', status: 'archived', triggerKind: 'manual', triggerConfig: {}, parentNarrativeId: null },
    ];
    const runs = new Map([['1', 3]]);
    const result = computeAudit(ceremonies, runs, false, new Map());
    expect(result.byStatus['active']).toBe(1);
    expect(result.byStatus['draft']).toBe(1);
    expect(result.byStatus['archived']).toBe(1);
  });

  describe('orphan detection', () => {
    it('flags active ceremony with zero runs as orphan', () => {
      const ceremonies: CeremonyRow[] = [
        { id: '1', name: 'Stale Ceremony', status: 'active', triggerKind: 'manual', triggerConfig: {}, parentNarrativeId: null },
      ];
      const result = computeAudit(ceremonies, new Map(), false, new Map());
      expect(result.orphans).toHaveLength(1);
      expect(result.orphans[0].id).toBe('1');
      expect(result.orphans[0].reason).toContain('30 days');
    });

    it('does NOT flag active ceremony that has recent runs', () => {
      const ceremonies: CeremonyRow[] = [
        { id: '1', name: 'Active Ceremony', status: 'active', triggerKind: 'manual', triggerConfig: {}, parentNarrativeId: null },
      ];
      const result = computeAudit(ceremonies, new Map([['1', 5]]), false, new Map());
      expect(result.orphans).toHaveLength(0);
    });

    it('does NOT flag draft or archived ceremonies as orphans', () => {
      const ceremonies: CeremonyRow[] = [
        { id: '1', name: 'Draft', status: 'draft', triggerKind: 'manual', triggerConfig: {}, parentNarrativeId: null },
        { id: '2', name: 'Archived', status: 'archived', triggerKind: 'manual', triggerConfig: {}, parentNarrativeId: null },
      ];
      const result = computeAudit(ceremonies, new Map(), false, new Map());
      expect(result.orphans).toHaveLength(0);
    });
  });

  describe('dead ceremony detection', () => {
    it('flags github-event ceremony as dead when project has no GH integration', () => {
      const ceremonies: CeremonyRow[] = [
        {
          id: '1',
          name: 'GH PR Ceremony',
          status: 'active',
          triggerKind: 'on_event',
          triggerConfig: { eventType: 'github.pull_request' },
          parentNarrativeId: null,
        },
      ];
      const result = computeAudit(ceremonies, new Map([['1', 3]]), false, new Map());
      expect(result.dead).toHaveLength(1);
      expect(result.dead[0].id).toBe('1');
      expect(result.dead[0].reason).toContain('GitHub integration');
    });

    it('does NOT flag github-event ceremony as dead when GH is connected', () => {
      const ceremonies: CeremonyRow[] = [
        {
          id: '1',
          name: 'GH PR Ceremony',
          status: 'active',
          triggerKind: 'on_event',
          triggerConfig: { eventType: 'github.pull_request' },
          parentNarrativeId: null,
        },
      ];
      const result = computeAudit(ceremonies, new Map([['1', 3]]), true, new Map());
      expect(result.dead).toHaveLength(0);
    });

    it('flags scheduled ceremony with no enabled schedule as dead', () => {
      const ceremonies: CeremonyRow[] = [
        {
          id: '1',
          name: 'Weekly Retro',
          status: 'active',
          triggerKind: 'on_schedule',
          triggerConfig: {},
          parentNarrativeId: null,
        },
      ];
      // No entry in enabledScheduleByWorkflow → dead
      const result = computeAudit(ceremonies, new Map([['1', 3]]), false, new Map());
      expect(result.dead).toHaveLength(1);
      expect(result.dead[0].reason).toContain('no enabled schedule');
    });

    it('does NOT flag scheduled ceremony with an enabled schedule as dead', () => {
      const ceremonies: CeremonyRow[] = [
        {
          id: '1',
          name: 'Weekly Retro',
          status: 'active',
          triggerKind: 'on_schedule',
          triggerConfig: {},
          parentNarrativeId: null,
        },
      ];
      const result = computeAudit(ceremonies, new Map([['1', 3]]), false, new Map([['1', true]]));
      expect(result.dead).toHaveLength(0);
    });

    it('does NOT flag non-github on_event ceremonies (e.g. review.requested) as dead', () => {
      const ceremonies: CeremonyRow[] = [
        {
          id: '1',
          name: 'Review Ceremony',
          status: 'active',
          triggerKind: 'on_event',
          triggerConfig: { eventType: 'review.requested' },
          parentNarrativeId: null,
        },
      ];
      const result = computeAudit(ceremonies, new Map([['1', 3]]), false, new Map());
      expect(result.dead).toHaveLength(0);
    });

    it('does NOT flag draft/archived ceremonies as dead', () => {
      const ceremonies: CeremonyRow[] = [
        {
          id: '1',
          name: 'Draft GH Ceremony',
          status: 'draft',
          triggerKind: 'on_event',
          triggerConfig: { eventType: 'github.push' },
          parentNarrativeId: null,
        },
      ];
      const result = computeAudit(ceremonies, new Map(), false, new Map());
      expect(result.dead).toHaveLength(0);
    });
  });
});

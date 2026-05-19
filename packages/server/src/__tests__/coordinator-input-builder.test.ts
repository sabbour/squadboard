import { describe, expect, it, vi } from 'vitest';
import {
  buildCandidateAgents,
  buildCoordinatorInput,
  capabilityMapFromAgentKeywords,
  capabilitiesFromCharter,
  mapCoordinatorRecentRuns,
  priorityFromLabels,
} from '../coordinator/input-builder.js';

const ISSUE = {
  id: 'issue-1',
  title: 'Fix auth login',
  body: 'Users cannot log in.',
  status: 'ready',
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

const PROJECT = {
  id: 'project-1',
  name: 'Squadboard',
  description: 'Project rule: prefer safe defaults.',
};

const AGENTS = [
  {
    id: 'agent-1',
    name: 'verbal',
    role: 'implementer',
    charterHash: 'abc123',
    charterContent: '# Verbal\n\n## Expertise\n- backend\n- auth, api\n',
  },
  {
    id: 'agent-2',
    name: 'scribe',
    role: 'scribe',
    charterHash: null,
    charterContent: '# Scribe\n\n## Skills\n- docs\n',
  },
];

describe('coordinator input builder', () => {
  it('extracts capabilities from charter expertise sections', () => {
    expect(capabilitiesFromCharter(AGENTS[0].charterContent)).toEqual(['backend', 'auth', 'api']);
  });

  it('builds candidate agents with capabilities and availability', () => {
    const extraCapabilities = new Map([
      ['agent-1', ['login', 'backend']],
    ]);
    const candidates = buildCandidateAgents(AGENTS, new Set(['agent-2']), extraCapabilities);

    expect(candidates).toEqual([
      expect.objectContaining({
        name: 'verbal',
        charterHash: 'abc123',
        capabilities: ['backend', 'auth', 'api', 'login'],
        available: true,
      }),
      expect.objectContaining({
        name: 'scribe',
        charterHash: '',
        capabilities: ['docs'],
        available: false,
      }),
    ]);
  });

  it('builds capability maps from cached agent keywords', () => {
    expect(
      capabilityMapFromAgentKeywords([
        { agentId: 'agent-1', keywords: '["Auth","API"]', focusAreas: '["backend"]' },
      ]),
    ).toEqual(new Map([['agent-1', ['auth', 'api', 'backend']]]));
  });

  it('warns and ignores malformed cached agent keyword JSON', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(
      capabilityMapFromAgentKeywords([
        { agentId: 'agent-1', keywords: 'not-json', focusAreas: '["backend"]' },
      ]),
    ).toEqual(new Map([['agent-1', ['backend']]]));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('invalid keywords JSON'),
      expect.any(SyntaxError),
    );

    warnSpy.mockRestore();
  });

  it('maps terminal run rows into coordinator recentRuns', () => {
    const recentRuns = mapCoordinatorRecentRuns(
      [
        {
          issueId: 'issue-1',
          agentId: 'agent-1',
          status: 'completed',
          startedAt: new Date('2026-01-01T00:00:00Z'),
          completedAt: new Date('2026-01-01T00:00:10Z'),
        },
        { issueId: 'issue-1', agentId: 'agent-2', status: 'cancelled' },
        { issueId: 'issue-1', agentId: 'agent-2', status: 'running' },
      ],
      AGENTS,
      'issue-1',
    );

    expect(recentRuns).toEqual([
      { issueId: 'issue-1', agentName: 'verbal', outcome: 'success', durationMs: 10_000 },
      { issueId: 'issue-1', agentName: 'scribe', outcome: 'abandoned', durationMs: 0 },
    ]);
  });

  it('builds a full CoordinatorInput without hardcoded empty routing fields', () => {
    const agentCapabilities = new Map([['agent-1', ['login']]]);
    const input = buildCoordinatorInput({
      issue: ISSUE,
      labels: ['auth', 'backend', 'p4'],
      project: PROJECT,
      agents: AGENTS,
      busyAgentIds: new Set(['agent-2']),
      recentRuns: [],
      parentIssueIds: ['parent-1'],
      blockedParentIssueIds: ['parent-blocked'],
      agentCapabilities,
      projectRules: 'Routing rule: auth work goes to verbal.',
    });

    expect(input.issue).toMatchObject({
      id: 'issue-1',
      labels: ['auth', 'backend', 'p4'],
      parentId: 'parent-1',
      blockedParentIds: ['parent-blocked'],
      priority: 4,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(input.project.rules).toContain('Project rule: prefer safe defaults.');
    expect(input.project.rules).toContain('Routing rule: auth work goes to verbal.');
    expect(input.candidateAgents[0].capabilities).toEqual(['backend', 'auth', 'api', 'login']);
    expect(input.candidateAgents[1].available).toBe(false);
  });

  it('derives priority from common numeric labels', () => {
    expect(priorityFromLabels(['bug', 'p0'])).toBe(0);
    expect(priorityFromLabels(['priority-5'])).toBe(5);
    expect(priorityFromLabels(['bug'])).toBeNull();
  });
});

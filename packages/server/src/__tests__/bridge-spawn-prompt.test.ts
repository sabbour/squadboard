import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createAgentSessionMock,
  getCapturedSessionOptions,
  listAgentSkillsMock,
  listAgentMcpServersMock,
} = vi.hoisted(() => {
  let capturedSessionOptions: Record<string, unknown> | null = null;
  const createAgentSessionMock = vi.fn(async (options: Record<string, unknown>) => {
    capturedSessionOptions = options;
    return {
      output: 'done',
      tokensUsed: 12,
      costUsd: '0.001',
      resolvedModel: 'claude-sonnet-4.6',
      modelResolvedVia: 'agent',
      inputTokens: 6,
      outputTokens: 6,
    };
  });
  return {
    createAgentSessionMock,
    getCapturedSessionOptions: () => capturedSessionOptions,
    listAgentSkillsMock: vi.fn(),
    listAgentMcpServersMock: vi.fn(),
  };
});

const mockWhere = vi.fn().mockResolvedValue([{ defaultModel: 'gpt-5.4' }]);
const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

vi.mock('../db/index.js', () => ({
  getDb: () => ({ select: mockSelect, update: mockUpdate }),
}));

vi.mock('../db/schema.js', () => ({
  issueRuns: { id: 'issue_runs.id', status: 'issue_runs.status' },
  projects: { id: 'projects.id', defaultModel: 'projects.default_model' },
}));

vi.mock('drizzle-orm', () => ({
  eq: (left: unknown, right: unknown) => ({ __eq: [left, right] }),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('Inline charter from disk.'),
}));

vi.mock('../sdk/squad-client.js', () => ({
  createAgentSession: createAgentSessionMock,
}));

vi.mock('../sdk/output-streamer.js', () => ({
  OutputStreamer: class {
    write() { return Promise.resolve(); }
    flush() { return Promise.resolve(); }
  },
}));

vi.mock('../sdk/cost-tracker.js', () => ({
  CostTracker: class {
    record() { return Promise.resolve(); }
    recordCost() { return Promise.resolve(); }
  },
}));

vi.mock('../sdk/budget-guard.js', () => ({
  BudgetGuard: { check: vi.fn().mockResolvedValue(undefined) },
  BudgetExceededError: class BudgetExceededError extends Error {},
}));

vi.mock('../sdk/model-defaults.js', () => ({
  BUILTIN_FALLBACK: 'gpt-5.4',
}));

vi.mock('../sdk/issue-stream.js', () => ({
  RunningIssueSessionImpl: class {
    emit() { return Promise.resolve(0); }
    dispose() { return Promise.resolve(); }
  },
}));

vi.mock('../services/skills.js', () => ({
  listAgentSkills: listAgentSkillsMock,
}));

vi.mock('../services/mcp.js', () => ({
  listAgentMcpServers: listAgentMcpServersMock,
}));

import { executeAgentRun, type AgentRunInput } from '../sdk/bridge.js';

function makeInput(): AgentRunInput {
  return {
    issueRunId: 'run-1',
    projectId: 'proj-1',
    agent: {
      id: 'agent-1',
      projectId: 'proj-1',
      name: 'Fenster',
      role: 'Backend Dev',
      model: 'claude-sonnet-4.6',
      status: 'active',
      agentKind: 'squad',
      charterPath: '/repo/.squad/agents/fenster/charter.md',
      charterContent: '',
      historyPath: '/repo/.squad/agents/fenster/history.md',
      charterHash: null,
      createdAt: new Date('2026-05-18T00:00:00.000Z'),
      updatedAt: new Date('2026-05-18T00:00:00.000Z'),
    },
    issueTitle: 'Implement spawn prompt parity',
    issueBody: 'Carry CLI spawn context into server issue runs.',
    workspacePath: '/repo-worktrees/squadboard-42',
    projectSquadPath: '/repo/.squad',
    workspaceStrategy: 'worktree',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listAgentSkillsMock.mockResolvedValue([{
    key: 'spawn-fidelity',
    name: 'Spawn Fidelity',
    category: 'process',
    promptAddendum: 'Keep CLI spawn context intact.',
    source: 'custom',
  }]);
  listAgentMcpServersMock.mockResolvedValue([{
    name: 'github',
    description: 'GitHub API access',
    transport: 'http',
    url: 'https://api.github.test/mcp',
    enabled: true,
  }]);
});

describe('executeAgentRun spawn prompt wiring', () => {
  it('passes the shared spawn prompt, assigned skills, and MCP context to SquadClient', async () => {
    await executeAgentRun(makeInput());

    expect(listAgentSkillsMock).toHaveBeenCalledWith('proj-1', 'agent-1');
    expect(listAgentMcpServersMock).toHaveBeenCalledWith('proj-1', 'agent-1');
    expect(createAgentSessionMock).toHaveBeenCalledTimes(1);

    const options = getCapturedSessionOptions();
    expect(options).toBeTruthy();
    const systemPrompt = options!.systemPrompt as string;

    expect(options!.task).toBe('Begin the assigned issue run now: Implement spawn prompt parity');
    expect(options!.workspacePath).toBe('/repo-worktrees/squadboard-42');
    expect(options!.squadPath).toBe('/repo/.squad');
    expect(systemPrompt).toContain('## YOUR CHARTER (inline)');
    expect(systemPrompt).toContain('Inline charter from disk.');
    expect(systemPrompt).toContain('TEAM_ROOT: /repo');
    expect(systemPrompt).toContain('WORKSPACE_PATH: /repo-worktrees/squadboard-42');
    expect(systemPrompt).toContain('WORKTREE_MODE: true');
    expect(systemPrompt).toContain('## TEAM MEMORY READS');
    expect(systemPrompt).toContain('## SKILL DIRECTORY CHECK');
    expect(systemPrompt).toContain('## ASSIGNED SKILL PROMPT ADDENDA');
    expect(systemPrompt).toContain('Keep CLI spawn context intact.');
    expect(systemPrompt).toContain('## MCP TOOLS ASSIGNED TO THIS AGENT');
    expect(systemPrompt).toContain('github (http, enabled, url=https://api.github.test/mcp)');
    expect(systemPrompt).toContain('## DROP-BOX DECISION PATTERN');
    expect(systemPrompt).toContain('## OUTPUT AND VALIDATION EXPECTATIONS');
    expect(systemPrompt).toContain('## RESPONSE ORDER');
    expect(systemPrompt).toContain('# Implement spawn prompt parity');
    expect(systemPrompt).toContain('Carry CLI spawn context into server issue runs.');
  });
});

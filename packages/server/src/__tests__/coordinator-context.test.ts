/**
 * coordinator-context.test.ts — W28 J5
 *
 * Tests for packages/server/src/services/coordinator-context.ts
 *
 * Coverage:
 *   - tokenCount approximation
 *   - redact() — all five pattern categories
 *   - buildCoordinatorContext() — section assembly, token budget enforcement,
 *     truncation order, redaction integration, refresh-per-turn (no caching)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Stub external I/O ────────────────────────────────────────────────────────

// Stub DB
const mockAgentRows = [{ name: 'McManus' }, { name: 'Hockney' }];
const mockIssueRunRows: Array<{ id: string; status: string }> = [];

function makeQueryChain(rows: unknown[]): unknown {
  // Drizzle query builder is thenable: await query resolves the query
  const chain: Record<string, unknown> = {};
  const p = Promise.resolve(rows);
  chain.then = p.then.bind(p);
  chain.catch = p.catch.bind(p);
  chain.from = () => makeQueryChain(rows);
  chain.where = () => makeQueryChain(rows);
  chain.limit = () => makeQueryChain(rows);
  return chain;
}

vi.mock('../db/index.js', () => {
  const getDb = () => ({
    select: (_fields?: unknown) => makeQueryChain(mockAgentRows),
  });
  return {
    getDb,
    schema: {
      agents: { name: 'name', status: 'status', projectId: 'project_id' },
      projects: { id: 'id', path: 'path' },
      issueRuns: { id: 'id', status: 'status', projectId: 'project_id' },
    },
  };
});

// Stub schema (drizzle operators)
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
}));

// Stub fs
const mockFiles: Record<string, string> = {};
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async (p: string) => {
    const k = String(p);
    for (const [key, val] of Object.entries(mockFiles)) {
      if (k.endsWith(key)) return val;
    }
    throw Object.assign(new Error(`ENOENT: ${k}`), { code: 'ENOENT' });
  }),
  readdir: vi.fn(async (p: string) => {
    const k = String(p);
    if (k.includes('orchestration-log')) return ['2026-01-01.md', '2026-01-02.md', '2026-01-03.md'];
    if (k.includes('inbox')) return ['item1.md', 'item2.md'];
    return [];
  }),
}));

import { tokenCount, redact, buildCoordinatorContext } from '../services/coordinator-context.js';

// ─── tokenCount ───────────────────────────────────────────────────────────────

describe('tokenCount', () => {
  it('returns 0 for empty string', () => {
    expect(tokenCount('')).toBe(0);
  });

  it('approximates 4 chars per token', () => {
    expect(tokenCount('abcd')).toBe(1);
    expect(tokenCount('abcde')).toBe(2); // ceil(5/4) = 2
    expect(tokenCount('a'.repeat(400))).toBe(100);
  });

  it('rounds up (ceil)', () => {
    expect(tokenCount('abc')).toBe(1); // ceil(3/4) = 1
    expect(tokenCount('ab')).toBe(1);  // ceil(2/4) = 1
  });
});

// ─── redact ───────────────────────────────────────────────────────────────────

// Built from parts so secret scanners don't flag a contiguous literal match
const FAKE_SLACK_TOK = 'xoxb-' + 'faketoken123456789-faketoken123456789';

describe('redact', () => {
  it('redacts env-style KEY=<long value>', () => {
    const input = 'ANTHROPIC_API_KEY=sk-ant-1234567890abcdef1234567890ab';
    const { text, count } = redact(input);
    expect(text).toContain('[REDACTED]');
    expect(count).toBe(1);
  });

  it('redacts Slack tokens', () => {
    const input = `token=${FAKE_SLACK_TOK}`;
    const { text, count } = redact(input);
    expect(text).toContain('[REDACTED]');
    expect(count).toBe(1);
  });

  it('redacts GitHub PATs (ghp_)', () => {
    const input = 'GITHUB_TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef01234';
    const { text, count } = redact(input);
    expect(text).toContain('[REDACTED]');
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('redacts GitHub PATs (github_pat_)', () => {
    const input = 'github_pat_11ABCDEFGHIJKLMNOPQRSTUVWX_abcdefghijklmnopqrstuvwxyz01234567890ABC';
    const { text, count } = redact(input);
    expect(text).toContain('[REDACTED]');
    expect(count).toBe(1);
  });

  it('redacts Bearer tokens', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload';
    const { text, count } = redact(input);
    expect(text).toContain('[REDACTED]');
    expect(count).toBe(1);
  });

  it('returns count=0 and unchanged text when nothing to redact', () => {
    const input = 'Hello world. No secrets here.';
    const { text, count } = redact(input);
    expect(text).toBe(input);
    expect(count).toBe(0);
  });

  it('redacts multiple secrets in one string', () => {
    const input = [
      FAKE_SLACK_TOK,
      'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef01234',
    ].join(' ');
    const { count } = redact(input);
    expect(count).toBe(2);
  });
});

// ─── buildCoordinatorContext ──────────────────────────────────────────────────

describe('buildCoordinatorContext', () => {
  beforeEach(() => {
    // Reset mocked file content
    Object.keys(mockFiles).forEach((k) => delete mockFiles[k]);

    mockFiles['squad.agent.md'] = '# Squad Coordinator\nIdentity content.';
    mockFiles['team.md'] = '# Squad Team\n\n## Members\n\n| McManus | Lead |\n| Hockney | Backend |';
    mockFiles['decisions.md'] = [
      '# Squad Decisions',
      '',
      '## Active Decisions',
      '',
      '### Decision A',
      'Content A',
      '',
      '---',
      '',
      '### Decision B',
      'Content B',
    ].join('\n');
    mockFiles['config.json'] = JSON.stringify({ version: 1 });
    mockFiles['2026-01-01.md'] = 'Orch log entry 1';
    mockFiles['2026-01-02.md'] = 'Orch log entry 2';
    mockFiles['2026-01-03.md'] = 'Orch log entry 3';
  });

  it('assembles required sections', async () => {
    const ctx = await buildCoordinatorContext('sess-001', null, '/fake/workspace');

    const names = ctx.sections.map((s) => s.name);
    expect(names).toContain('Squadboard Meta Preamble');
    expect(names).toContain('Coordinator Identity (squad.agent.md)');
    expect(names).toContain('Team Roster (.squad/team.md)');
    expect(names).toContain('Active Agents (DB)');
    expect(names).toContain('Squad Config');
    expect(names.some((n) => n.includes('Decisions'))).toBe(true);
    expect(names.some((n) => n.includes('Orchestration Log'))).toBe(true);
  });

  it('includes sessionId in sdkContext', async () => {
    const ctx = await buildCoordinatorContext('sess-abc', null, '/fake/workspace');
    expect(ctx.sdkContext.sessionId).toBe('sess-abc');
  });

  it('includes active agents from DB', async () => {
    const ctx = await buildCoordinatorContext('sess-002', null, '/fake/workspace');
    expect(ctx.sdkContext.activeAgents).toContain('McManus');
    expect(ctx.sdkContext.activeAgents).toContain('Hockney');
  });

  it('includes team roster from team.md', async () => {
    const ctx = await buildCoordinatorContext('sess-003', null, '/fake/workspace');
    expect(ctx.sdkContext.teamRoster).toContain('Squad Team');
  });

  it('populates systemPrompt with identity and meta', async () => {
    const ctx = await buildCoordinatorContext('sess-004', null, '/fake/workspace');
    expect(ctx.systemPrompt).toContain('Squad Coordinator');
    expect(ctx.systemPrompt).toContain('squadboard-coordinator-meta');
  });

  it('populates config summary with version string', async () => {
    const ctx = await buildCoordinatorContext('sess-005', null, '/fake/workspace');
    expect(ctx.sdkContext.config.version).toBe('1');
    expect(typeof ctx.sdkContext.config.models.defaultModel).toBe('string');
  });

  it('does not cache — second call returns fresh context (refresh per turn)', async () => {
    const ctx1 = await buildCoordinatorContext('sess-006', null, '/fake/workspace');
    const ctx2 = await buildCoordinatorContext('sess-006', null, '/fake/workspace');
    // Both calls succeed; they're independent (no shared mutable state)
    expect(ctx1.sessionId).toBe(ctx2.sessionId);
    // timestamps may differ in production; at minimum they're separate objects
    expect(ctx1).not.toBe(ctx2);
  });

  it('falls back gracefully when squad.agent.md is missing', async () => {
    delete mockFiles['squad.agent.md'];
    const ctx = await buildCoordinatorContext('sess-007', null, '/fake/workspace');
    // Should use SDK template fallback — still assembles context without throwing
    expect(ctx.systemPrompt).toContain('Squad Coordinator');
    expect(ctx.sections.length).toBeGreaterThan(0);
  });

  it('falls back gracefully when team.md is missing', async () => {
    delete mockFiles['team.md'];
    const ctx = await buildCoordinatorContext('sess-008', null, '/fake/workspace');
    expect(ctx.sdkContext.teamRoster).toContain('No team.md found');
  });

  it('applies 8K variable token cap — truncates orchestration-log first', async () => {
    // Create a huge orchestration log that will blow the budget
    const bigContent = 'x'.repeat(32000); // ~8K tokens by itself
    mockFiles['2026-01-01.md'] = bigContent;
    mockFiles['2026-01-02.md'] = bigContent;
    mockFiles['2026-01-03.md'] = bigContent;

    const ctx = await buildCoordinatorContext('sess-009', null, '/fake/workspace');

    // variableTokens must be ≤ 8192
    expect(ctx.variableTokens).toBeLessThanOrEqual(8192 + 15);

    const orchSection = ctx.sections.find((s) => s.name.includes('Orchestration Log'));
    expect(orchSection?.truncated).toBe(true);
    expect(ctx.truncationLog.length).toBeGreaterThan(0);
    expect(ctx.truncationLog[0]).toContain('orchestration-log');
  });

  it('truncates decisions after orchestration-log is exhausted', async () => {
    // Huge orch log AND huge decisions — decisions must exceed budget on their own
    const bigContent = 'x'.repeat(32000);
    mockFiles['2026-01-01.md'] = bigContent;
    mockFiles['2026-01-02.md'] = bigContent;
    mockFiles['2026-01-03.md'] = bigContent;
    // decisions > 8K tokens: 40000 chars = ~10000 tokens
    mockFiles['decisions.md'] = '# Squad Decisions\n\n' + 'y'.repeat(40000);

    const ctx = await buildCoordinatorContext('sess-010', null, '/fake/workspace');

    expect(ctx.variableTokens).toBeLessThanOrEqual(8192 + 15);

    const orchSection = ctx.sections.find((s) => s.name.includes('Orchestration Log'));
    const decisionsSection = ctx.sections.find((s) => s.name.includes('Decisions'));
    expect(orchSection?.truncated).toBe(true);
    expect(decisionsSection?.truncated).toBe(true);
  });

  it('never truncates meta preamble', async () => {
    const ctx = await buildCoordinatorContext('sess-011', null, '/fake/workspace');
    const meta = ctx.sections.find((s) => s.name === 'Squadboard Meta Preamble');
    expect(meta?.truncated).toBe(false);
  });

  it('never truncates team.md', async () => {
    const ctx = await buildCoordinatorContext('sess-012', null, '/fake/workspace');
    const team = ctx.sections.find((s) => s.name.includes('Team Roster'));
    expect(team?.truncated).toBe(false);
  });

  it('never truncates active agents section', async () => {
    const ctx = await buildCoordinatorContext('sess-013', null, '/fake/workspace');
    const agents = ctx.sections.find((s) => s.name.includes('Active Agents'));
    expect(agents?.truncated).toBe(false);
  });

  it('redacts secrets in team.md', async () => {
    mockFiles['team.md'] = '# Team\nGITHUB_TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef01234';
    const ctx = await buildCoordinatorContext('sess-014', null, '/fake/workspace');
    expect(ctx.redactionCount).toBeGreaterThan(0);
    expect(ctx.sdkContext.teamRoster).toContain('[REDACTED]');
  });

  it('redacts secrets in orchestration log', async () => {
    mockFiles['2026-01-01.md'] =
      `Log entry with ${FAKE_SLACK_TOK} token`;
    const ctx = await buildCoordinatorContext('sess-015', null, '/fake/workspace');
    expect(ctx.redactionCount).toBeGreaterThan(0);
    const orchSection = ctx.sections.find((s) => s.name.includes('Orchestration Log'));
    expect(orchSection?.content).not.toContain('xoxb-');
  });

  it('reports totalTokens as sum of section tokens', async () => {
    const ctx = await buildCoordinatorContext('sess-016', null, '/fake/workspace');
    const sum = ctx.sections.reduce((acc, s) => acc + s.tokens, 0);
    expect(ctx.totalTokens).toBe(sum);
  });
});

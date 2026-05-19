import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { runFormulatorMock } = vi.hoisted(() => ({
  runFormulatorMock: vi.fn(),
}));

vi.mock('../services/formulator.js', () => ({
  runFormulator: runFormulatorMock,
  extractJsonObject: (raw: string) => JSON.parse(raw),
}));

import { resetBuiltinBundleCache } from '../services/builtin-bundles.js';
import {
  buildCastingRegistry,
  buildTeamMarkdown,
  normalizeSquadPath,
  scaffoldSquad,
  selectDeterministicBundle,
  suggestProjectSetup,
  type SetupTeamMember,
} from '../services/setup-lifecycle.js';

const fixtureRoot = fileURLToPath(
  new URL('../../.squad/test-runs/setup-lifecycle/', import.meta.url),
);

async function pathExists(targetPath: string): Promise<boolean> {
  return fs.access(targetPath).then(() => true, () => false);
}

describe('setup lifecycle foundations', () => {
  beforeEach(() => {
    resetBuiltinBundleCache();
    runFormulatorMock.mockReset();
  });

  it('renders team.md with init-mode Members header and member badges', () => {
    const team: SetupTeamMember[] = [
      { name: 'Lead', role: 'Lead Architect', kind: 'project-agent' },
      { name: 'Ada', role: 'Human PM', kind: 'human' },
      { name: '@copilot', role: 'Coding Agent', kind: 'virtual-copilot' },
    ];

    const markdown = buildTeamMarkdown({
      squadPath: '/workspace/example/.squad',
      projectName: 'Example',
      description: 'Example project',
      ownerName: 'Brady',
      team,
      now: new Date('2026-05-18T00:00:00.000Z'),
    });

    expect(markdown).toContain('## Members');
    expect(markdown).toContain('| Name | Role | Charter | Status | Type | Badge |');
    expect(markdown).toContain('| Lead | Lead Architect | `.squad/agents/lead/charter.md` | ✅ Active | Project agent | 🏗️ |');
    expect(markdown).toContain('| Ada | Human PM | — | ✅ Active | Human | 🎯 |');
    expect(markdown).toContain('| @copilot | Coding Agent | — | ✅ Active | Virtual Copilot | 🤖 |');
  });

  it('initializes casting registry for project and virtual members without treating humans as agents', () => {
    const registry = buildCastingRegistry([
      { name: 'Lead', role: 'Lead Architect', kind: 'project-agent' },
      { name: 'Ada', role: 'Human PM', kind: 'human' },
      { name: '@copilot', role: 'Coding Agent', kind: 'virtual-copilot' },
    ], new Date('2026-05-18T00:00:00.000Z')) as { agents: Record<string, Record<string, unknown>> };

    expect(registry.agents.lead).toMatchObject({
      persistent_name: 'lead',
      display_name: 'Lead',
      kind: 'project-agent',
      status: 'active',
    });
    expect(registry.agents.copilot).toMatchObject({
      persistent_name: '@copilot',
      display_name: '@copilot',
      kind: 'virtual-copilot',
    });
    expect(registry.agents.ada).toBeUndefined();
  });

  it('normalizes project-root input so scaffolded Squad state stays under .squad', async () => {
    const projectRoot = path.join(fixtureRoot, 'root-input-project');
    const expectedSquadPath = path.join(projectRoot, '.squad');

    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.mkdir(projectRoot, { recursive: true });

    try {
      const result = await scaffoldSquad({
        squadPath: projectRoot,
        projectName: 'Root Input Project',
        team: [{ name: 'Lead', role: 'Lead Architect', kind: 'project-agent' }],
        now: new Date('2026-05-19T14:38:22.590-07:00'),
      });

      expect(result.squadPath).toBe(expectedSquadPath);
      expect(normalizeSquadPath(projectRoot)).toBe(expectedSquadPath);
      expect(await pathExists(path.join(expectedSquadPath, 'team.md'))).toBe(true);
      expect(await pathExists(path.join(expectedSquadPath, 'agents', 'lead', 'charter.md'))).toBe(true);

      for (const rootSibling of ['team.md', 'routing.md', 'agents', 'casting', 'decisions']) {
        expect(await pathExists(path.join(projectRoot, rootSibling))).toBe(false);
      }
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('keeps deterministic bundle matching available as a safe fallback', () => {
    expect(selectDeterministicBundle('Rust cargo CLI package for developers')).toMatchObject({
      bundleId: 'library-or-sdk-project',
    });
    expect(selectDeterministicBundle('incident runbook for kubernetes alerts')).toMatchObject({
      bundleId: 'ops-runbook-project',
    });
  });

  it('uses the LLM to select a built-in setup bundle when available', async () => {
    runFormulatorMock.mockResolvedValue({
      raw: JSON.stringify({
        bundleId: 'research-spike',
        matchedKeywords: ['research'],
        rationale: 'The request is exploratory and research-heavy.',
      }),
      modelUsed: { model: 'claude-haiku-4.5', via: 'fallback' },
    });

    const suggestion = await suggestProjectSetup('Explore model options for data analysis');

    expect(runFormulatorMock).toHaveBeenCalledOnce();
    expect(suggestion.bundleId).toBe('research-spike');
    expect(suggestion.source).toBe('llm');
    expect(suggestion.rationale).toContain('exploratory');
    expect(suggestion.team.length).toBeGreaterThan(0);
    expect(suggestion.columns.length).toBeGreaterThan(0);
  });

  it('falls back deterministically if setup formulation fails', async () => {
    runFormulatorMock.mockRejectedValue(new Error('model unavailable'));

    const suggestion = await suggestProjectSetup('Build an npm SDK with release notes');

    expect(suggestion.bundleId).toBe('library-or-sdk-project');
    expect(suggestion.source).toBe('deterministic-fallback');
    expect(suggestion.matchedKeywords).toContain('npm');
  });

  it('can be forced into deterministic mode for tests and offline environments', async () => {
    const suggestion = await suggestProjectSetup('QA regression testing campaign', { useLlm: false });

    expect(runFormulatorMock).not.toHaveBeenCalled();
    expect(suggestion.bundleId).toBe('bug-bash-project');
    expect(suggestion.source).toBe('deterministic');
  });
});

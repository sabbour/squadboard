import { describe, expect, it } from 'vitest';
import { buildAgentSpawnPrompt } from '../sdk/spawn-prompt.js';

describe('buildAgentSpawnPrompt', () => {
  it('renders the CLI spawn-fidelity sections with assigned skills and MCP servers', () => {
    const prompt = buildAgentSpawnPrompt({
      agentName: 'Fenster',
      agentRole: 'Backend Dev',
      charter: 'You own server-side implementation and tests.',
      teamRoot: '/repo',
      currentDateTime: '2026-05-18T14:00:00.000Z',
      requesterName: 'Brady',
      workspacePath: '/repo-worktrees/squadboard-42',
      workspaceMode: 'worktree',
      inputArtifacts: ['packages/server/src/sdk/bridge.ts'],
      taskTitle: 'Fix issue run prompt context',
      taskBody: 'Match the CLI spawn ceremony in server issue runs.',
      assignedSkills: [{
        key: 'spawn-fidelity',
        name: 'Spawn Fidelity',
        category: 'process',
        promptAddendum: 'Preserve charter, team root, requester, skills, MCP, and response-order blocks.',
        source: 'custom',
      }],
      assignedMcpServers: [{
        name: 'github',
        description: 'GitHub API access',
        transport: 'http',
        url: 'https://api.github.test/mcp',
        enabled: true,
      }],
    });

    expect(prompt).toMatchInlineSnapshot(`
"## Agent Spawn Prompt

You are Fenster, the Backend Dev on this project.

## YOUR CHARTER (inline)

You own server-side implementation and tests.

## SPAWN CONTEXT
TEAM_ROOT: /repo
CURRENT_DATETIME: 2026-05-18T14:00:00.000Z
Requested by: Brady
WORKSPACE_PATH: /repo-worktrees/squadboard-42
WORKSPACE_MODE: worktree
WORKTREE_PATH: /repo-worktrees/squadboard-42
WORKTREE_MODE: true
All \`.squad/\` paths are relative to TEAM_ROOT.

## WORKTREE INSTRUCTIONS
You are working in a dedicated worktree at \`/repo-worktrees/squadboard-42\`.
- Keep all file operations relative to WORKSPACE_PATH.
- Do NOT switch branches; the worktree is already the branch for this run.
- Build and test in the worktree.

## TEAM MEMORY READS
- Read \`.squad/agents/fenster/history.md\` for your project knowledge.
- Read \`.squad/decisions.md\` for team decisions to respect.
- If \`.squad/identity/wisdom.md\` exists, read it before starting work.
- If \`.squad/identity/now.md\` exists, read it at spawn time.

## SKILL DIRECTORY CHECK
- Check \`.copilot/skills/\` for Copilot-level process, workflow, and protocol skills.
- Check \`.squad/skills/\` for team-level patterns discovered during prior work.
- Read any relevant \`SKILL.md\` files before working.

## ASSIGNED SKILL PROMPT ADDENDA

These skills are assigned to you through \`agent_skills\`; treat them as part of your working instructions.

### spawn-fidelity — Spawn Fidelity
_category=process, source=custom_
Preserve charter, team root, requester, skills, MCP, and response-order blocks.

## MCP TOOLS ASSIGNED TO THIS AGENT
These MCP servers are assigned to you through \`agent_mcp_servers\`. Use them when relevant; fall back gracefully if unavailable.
- github (http, enabled, url=https://api.github.test/mcp) — GitHub API access

## INPUT ARTIFACTS
- packages/server/src/sdk/bridge.ts

## TASK

# Fix issue run prompt context

Match the CLI spawn ceremony in server issue runs.

## DROP-BOX DECISION PATTERN
Do NOT edit \`.squad/decisions.md\` directly.
If you make a team-relevant decision, write a drop file at \`.squad/decisions/inbox/fenster-{brief-slug}.md\` for Scribe to merge later.
Append personal learnings only to \`.squad/agents/fenster/history.md\`.

## OUTPUT AND VALIDATION EXPECTATIONS
- Do the assigned work in WORKSPACE_PATH.
- Run focused validation that already exists for the files or behavior you change.
- If validation cannot be run, say why in your final summary.
- Report outcomes in human terms. Never expose SQL, tool internals, secrets, or unrelated implementation noise.
- When writing dates in files, use only CURRENT_DATETIME above.

## RESPONSE ORDER
After ALL tool calls, write a 2-3 sentence plain text summary as your FINAL output.
Do not call tools after that final summary."
`);
  });

  it('omits optional assigned context blocks when no assignments are provided', () => {
    const prompt = buildAgentSpawnPrompt({
      agentName: 'Hockney',
      agentRole: 'Tester',
      charter: 'Test carefully.',
      teamRoot: '/repo',
      currentDateTime: '2026-05-18T14:00:00.000Z',
      workspacePath: '/repo',
      workspaceMode: 'dir',
      taskTitle: 'Check behavior',
      taskBody: null,
    });

    expect(prompt).not.toContain('ASSIGNED SKILL PROMPT ADDENDA');
    expect(prompt).not.toContain('MCP TOOLS ASSIGNED TO THIS AGENT');
    expect(prompt).toContain('WORKTREE_MODE: false');
    expect(prompt).toContain('(issue body only; no specific file paths were declared)');
  });
});

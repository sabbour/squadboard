export interface SpawnSkillContext {
  key?: string | null;
  name: string;
  category?: string | null;
  promptAddendum?: string | null;
  source?: string | null;
  sourceUri?: string | null;
}

export interface SpawnMcpServerContext {
  name: string;
  description?: string | null;
  transport?: string | null;
  url?: string | null;
  command?: string | null;
  enabled?: boolean | null;
}

export interface BuildAgentSpawnPromptInput {
  agentName: string;
  agentRole?: string | null;
  charter: string;
  teamRoot: string;
  currentDateTime: string;
  requesterName?: string | null;
  workspacePath: string;
  workspaceMode?: string | null;
  inputArtifacts?: string[];
  taskTitle: string;
  taskBody?: string | null;
  assignedSkills?: SpawnSkillContext[];
  assignedMcpServers?: SpawnMcpServerContext[];
}

function clean(value: string | null | undefined, fallback = ''): string {
  const trimmed = (value ?? '').trim();
  return trimmed || fallback;
}

function agentSlug(agentName: string): string {
  return agentName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'agent';
}

function bulletList(items: string[], empty: string): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : `- ${empty}`;
}

function renderSkill(skill: SpawnSkillContext): string {
  const key = clean(skill.key, clean(skill.name, 'unnamed-skill'));
  const name = clean(skill.name, key);
  const meta = [
    skill.category ? `category=${skill.category}` : null,
    skill.source ? `source=${skill.source}` : null,
    skill.sourceUri ? `uri=${skill.sourceUri}` : null,
  ].filter(Boolean).join(', ');

  return [
    `### ${key} — ${name}`,
    meta ? `_${meta}_` : null,
    clean(skill.promptAddendum, '(no prompt addendum provided)'),
  ].filter((line): line is string => Boolean(line)).join('\n');
}

function renderMcpServer(server: SpawnMcpServerContext): string {
  const status = server.enabled === false ? 'disabled' : 'enabled';
  const transport = clean(server.transport, 'transport unknown');
  const endpoint = server.url
    ? `url=${server.url}`
    : server.command
      ? `command=${server.command}`
      : 'endpoint not configured';
  const description = server.description ? ` — ${server.description}` : '';
  return `- ${server.name} (${transport}, ${status}, ${endpoint})${description}`;
}

export function buildAgentSpawnPrompt(input: BuildAgentSpawnPromptInput): string {
  const name = clean(input.agentName, 'Agent');
  const role = clean(input.agentRole, 'Squad agent');
  const slug = agentSlug(name);
  const workspaceMode = clean(input.workspaceMode, 'dir');
  const worktreeMode = workspaceMode === 'worktree';
  const requester = clean(input.requesterName, 'Unknown requester');
  const artifacts = input.inputArtifacts?.map((p) => p.trim()).filter(Boolean) ?? [];
  const skills = input.assignedSkills ?? [];
  const mcpServers = input.assignedMcpServers ?? [];

  const sections = [
    '## Agent Spawn Prompt',
    `You are ${name}, the ${role} on this project.`,
    [
      '## YOUR CHARTER (inline)',
      clean(input.charter, `(charter not available for ${name})`),
    ].join('\n\n'),
    [
      '## SPAWN CONTEXT',
      `TEAM_ROOT: ${input.teamRoot}`,
      `CURRENT_DATETIME: ${input.currentDateTime}`,
      `Requested by: ${requester}`,
      `WORKSPACE_PATH: ${input.workspacePath}`,
      `WORKSPACE_MODE: ${workspaceMode}`,
      `WORKTREE_PATH: ${worktreeMode ? input.workspacePath : 'n/a'}`,
      `WORKTREE_MODE: ${worktreeMode ? 'true' : 'false'}`,
      'All `.squad/` paths are relative to TEAM_ROOT.',
    ].join('\n'),
    worktreeMode
      ? [
          '## WORKTREE INSTRUCTIONS',
          `You are working in a dedicated worktree at \`${input.workspacePath}\`.`,
          '- Keep all file operations relative to WORKSPACE_PATH.',
          '- Do NOT switch branches; the worktree is already the branch for this run.',
          '- Build and test in the worktree.',
        ].join('\n')
      : null,
    [
      '## TEAM MEMORY READS',
      `- Read \`.squad/agents/${slug}/history.md\` for your project knowledge.`,
      '- Read `.squad/decisions.md` for team decisions to respect.',
      '- If `.squad/identity/wisdom.md` exists, read it before starting work.',
      '- If `.squad/identity/now.md` exists, read it at spawn time.',
    ].join('\n'),
    [
      '## SKILL DIRECTORY CHECK',
      '- Check `.copilot/skills/` for Copilot-level process, workflow, and protocol skills.',
      '- Check `.squad/skills/` for team-level patterns discovered during prior work.',
      '- Read any relevant `SKILL.md` files before working.',
    ].join('\n'),
    skills.length > 0
      ? [
          '## ASSIGNED SKILL PROMPT ADDENDA',
          'These skills are assigned to you through `agent_skills`; treat them as part of your working instructions.',
          skills.map(renderSkill).join('\n\n'),
        ].join('\n\n')
      : null,
    mcpServers.length > 0
      ? [
          '## MCP TOOLS ASSIGNED TO THIS AGENT',
          'These MCP servers are assigned to you through `agent_mcp_servers`. Use them when relevant; fall back gracefully if unavailable.',
          mcpServers.map(renderMcpServer).join('\n'),
        ].join('\n')
      : null,
    [
      '## INPUT ARTIFACTS',
      bulletList(artifacts, '(issue body only; no specific file paths were declared)'),
    ].join('\n'),
    [
      '## TASK',
      `# ${clean(input.taskTitle, 'Untitled task')}`,
      clean(input.taskBody, '(no task body provided)'),
    ].join('\n\n'),
    [
      '## DROP-BOX DECISION PATTERN',
      'Do NOT edit `.squad/decisions.md` directly.',
      `If you make a team-relevant decision, write a drop file at \`.squad/decisions/inbox/${slug}-{brief-slug}.md\` for Scribe to merge later.`,
      `Append personal learnings only to \`.squad/agents/${slug}/history.md\`.`,
    ].join('\n'),
    [
      '## OUTPUT AND VALIDATION EXPECTATIONS',
      '- Do the assigned work in WORKSPACE_PATH.',
      '- Run focused validation that already exists for the files or behavior you change.',
      '- If validation cannot be run, say why in your final summary.',
      '- Report outcomes in human terms. Never expose SQL, tool internals, secrets, or unrelated implementation noise.',
      '- When writing dates in files, use only CURRENT_DATETIME above.',
    ].join('\n'),
    [
      '## RESPONSE ORDER',
      'After ALL tool calls, write a 2-3 sentence plain text summary as your FINAL output.',
      'Do not call tools after that final summary.',
    ].join('\n'),
  ];

  return sections.filter((section): section is string => Boolean(section)).join('\n\n');
}

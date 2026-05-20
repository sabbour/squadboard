import fs from 'node:fs/promises';
import path from 'node:path';
import type { SquadboardBundle } from '@sabbour/squadboard-sdk/bundle';
import {
  extractJsonObject,
  runFormulator,
  type ResolveModelResult,
} from './formulator.js';
import { getBuiltinBundle, getBuiltinProjectTemplateBundles } from './builtin-bundles.js';
import {
  assertSafeSquadScaffoldTarget,
  normalizeSquadPath,
} from './squad-path-safety.js';

export {
  assertSafeSquadScaffoldTarget,
  normalizeSquadPath,
} from './squad-path-safety.js';

export type SetupMemberKind = 'project-agent' | 'human' | 'virtual-copilot';

export interface SetupTeamMember {
  name: string;
  role: string;
  kind?: SetupMemberKind;
  charter?: string | null;
  status?: 'active' | 'disabled' | 'retired';
}

export interface SetupRoutingRule {
  pattern: string;
  matchType?: string;
  agentName: string;
  rawRule?: string;
}

export interface ScaffoldSquadOptions {
  squadPath: string;
  projectName: string;
  description?: string | null;
  ownerName?: string | null;
  team?: SetupTeamMember[];
  routingRules?: SetupRoutingRule[];
  now?: Date;
}

export interface ScaffoldSquadResult {
  squadPath: string;
  projectRoot: string;
  createdFiles: string[];
  skippedFiles: string[];
  createdDirs: string[];
  teamMemberCount: number;
}

export interface ProjectSuggestionTeamMember extends SetupTeamMember {
  badge: string;
}

export interface ProjectSuggestionCeremony {
  name: string;
  cadence: string;
}

export interface ProjectSuggestionColumn {
  slug: string;
  label: string;
}

export interface ProjectSuggestion {
  bundleId: string;
  bundleName: string;
  description: string;
  team: ProjectSuggestionTeamMember[];
  ceremonies: ProjectSuggestionCeremony[];
  columns: ProjectSuggestionColumn[];
  skills: string[];
  matchedKeywords: string[];
  source: 'llm' | 'deterministic' | 'deterministic-fallback';
  rationale: string | null;
  modelUsed?: ResolveModelResult | null;
}

const KEYWORD_MAP: Array<{ keywords: string[]; bundleId: string }> = [
  {
    keywords: ['research', 'spike', 'analysis', 'explore', 'investigation', 'data', 'ml', 'machine learning', 'ai', 'experiment', 'python', 'jupyter', 'notebook'],
    bundleId: 'research-spike',
  },
  {
    keywords: ['writing', 'blog', 'content', 'article', 'newsletter', 'editorial', 'copywriting', 'post', 'publication', 'script', 'copy'],
    bundleId: 'content-writing-project',
  },
  {
    keywords: ['open source', 'oss', 'github', 'repository', 'repo', 'pull request', 'pr', 'maintainer', 'contributor', 'community', 'npm', 'pypi', 'pip', 'gem', 'nuget', 'crate', 'package', 'sdk', 'library', 'cli', 'semver', 'versioning'],
    bundleId: 'open-source-project',
  },
  {
    keywords: ['feature', 'product', 'pm', 'prd', 'prototype', 'roadmap', 'customer', 'signal', 'signals', 'persona', 'launch', 'release note', 'release-note', 'changelog', 'disclosure', 'docs', 'documentation', 'naming', 'beta', 'ga', 'quality', 'validation', 'test', 'bug', 'app', 'application', 'web', 'api', 'software', 'workflow'],
    bundleId: 'feature-kanban',
  },
];

const DEFAULT_BUNDLE_ID = 'feature-kanban';

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function slugifySetupName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/^@/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'member';
}

function roleBadge(role: string, name?: string): string {
  const subject = `${name ?? ''} ${role}`.toLowerCase();
  if (subject.includes('@copilot') || subject.includes('copilot')) return '🤖';
  if (subject.includes('pm') || subject.includes('product')) return '🎯';
  if (subject.includes('designer') || subject.includes('ux') || subject.includes('frontend') || subject.includes('ui')) return '🎨';
  if (subject.includes('founder') || subject.includes('ceo') || subject.includes('executive')) return '👔';
  if (subject.includes('lead') || subject.includes('architect')) return '🏗️';
  if (subject.includes('backend') || subject.includes('api') || subject.includes('server')) return '🔧';
  if (subject.includes('test') || subject.includes('qa') || subject.includes('quality')) return '🧪';
  if (subject.includes('devops') || subject.includes('infra') || subject.includes('platform') || subject.includes('sre')) return '⚙️';
  if (subject.includes('docs') || subject.includes('writer') || subject.includes('devrel')) return '📝';
  if (subject.includes('data') || subject.includes('database') || subject.includes('analytics')) return '📊';
  if (subject.includes('security') || subject.includes('auth')) return '🔒';
  if (subject.includes('sales') || subject.includes('account')) return '💼';
  if (subject.includes('marketing') || subject.includes('growth')) return '📣';
  if (subject.includes('customer') || subject.includes('support')) return '🎧';
  if (subject.includes('research')) return '🔬';
  if (subject.includes('scribe')) return '📋';
  if (subject.includes('ralph') || subject.includes('monitor')) return '🔄';
  return '👤';
}

function statusLabel(status: SetupTeamMember['status'] = 'active'): string {
  if (status === 'retired') return '⚪ Retired';
  if (status === 'disabled') return '🟡 Disabled';
  return '✅ Active';
}

function kindLabel(kind: SetupMemberKind = 'project-agent'): string {
  if (kind === 'human') return 'Human';
  if (kind === 'virtual-copilot') return 'Virtual Copilot';
  return 'Project agent';
}

export function buildTeamMarkdown(options: ScaffoldSquadOptions): string {
  const now = (options.now ?? new Date()).toISOString();
  const team = options.team ?? [];
  const description = options.description?.trim() || 'Squad-managed project.';
  const owner = options.ownerName?.trim() || 'Unknown';

  const rows = team.map((member) => {
    const slug = slugifySetupName(member.name);
    const charter = member.kind === 'virtual-copilot' || member.kind === 'human'
      ? '—'
      : `\`.squad/agents/${slug}/charter.md\``;
    const badge = roleBadge(member.role, member.name);
    return `| ${member.name} | ${member.role} | ${charter} | ${statusLabel(member.status)} | ${kindLabel(member.kind)} | ${badge} |`;
  });

  return [
    `# ${options.projectName}`,
    '',
    `> ${description}`,
    '',
    '## Coordinator',
    '',
    '| Name | Role | Notes |',
    '|------|------|-------|',
    '| Squad | Coordinator | Routes work, enforces handoffs, and keeps reviewer gates intact. |',
    '',
    '## Members',
    '',
    '| Name | Role | Charter | Status | Type | Badge |',
    '|------|------|---------|--------|------|-------|',
    ...(rows.length > 0 ? rows : ['| _No members yet_ | _Cast a team to finish setup_ | — | — | — | — |']),
    '',
    '## Project Context',
    '',
    `- **Owner:** ${owner}`,
    `- **Description:** ${description}`,
    `- **Created:** ${now}`,
    '',
  ].join('\n');
}

export function buildRoutingMarkdown(rules: SetupRoutingRule[] = [], team: SetupTeamMember[] = []): string {
  const lead = team.find((m) => /lead|architect/i.test(m.role))?.name ?? team[0]?.name ?? 'Lead';
  const rows = rules.length > 0
    ? rules.map((rule) => `| ${rule.pattern} | ${rule.agentName} | ${rule.rawRule ?? rule.matchType ?? 'setup rule'} |`)
    : [`| * | ${lead} | Unmatched work routes to the lead for triage. |`];

  return [
    '# Work Routing',
    '',
    '## Routing Table',
    '',
    '| Work Type | Route To | Notes |',
    '|-----------|----------|-------|',
    ...rows,
    '',
    '## Issue Routing',
    '',
    '| Label | Action | Who |',
    '|-------|--------|-----|',
    '| `squad` | Triage and assign the right `squad:{member}` label | Lead |',
    '| `squad:{name}` | Pick up the issue and complete the work | Named member |',
    '',
  ].join('\n');
}

export function buildCastingRegistry(team: SetupTeamMember[] = [], now = new Date()): Record<string, unknown> {
  const createdAt = now.toISOString();
  const agents: Record<string, unknown> = {};
  for (const member of team) {
    if (member.kind === 'human') continue;
    const key = member.kind === 'virtual-copilot' ? 'copilot' : slugifySetupName(member.name);
    agents[key] = {
      persistent_name: member.kind === 'virtual-copilot' ? '@copilot' : key,
      display_name: member.name,
      role: member.role,
      universe: 'Squadboard',
      created_at: createdAt,
      legacy_named: false,
      status: member.status ?? 'active',
      kind: member.kind ?? 'project-agent',
    };
  }
  return { agents };
}

function buildCastingHistory(team: SetupTeamMember[] = [], now = new Date()): Record<string, unknown> {
  const assignmentId = `setup-${now.toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`;
  const members = team
    .filter((member) => member.kind !== 'human')
    .map((member) => ({
      name: member.name,
      persistent_name: member.kind === 'virtual-copilot' ? '@copilot' : slugifySetupName(member.name),
      role: member.role,
      kind: member.kind ?? 'project-agent',
    }));

  return {
    universe_usage_history: members.length
      ? [{ assignment_id: assignmentId, universe: 'Squadboard', assigned_at: now.toISOString(), members }]
      : [],
    assignment_cast_snapshots: members.length
      ? { [assignmentId]: { assigned_at: now.toISOString(), members } }
      : {},
  };
}

function buildPolicy(): Record<string, unknown> {
  return {
    casting_policy_version: '1.1',
    allowlist_universes: [
      'The Usual Suspects',
      "Ocean's Eleven",
      'The Office',
      'Seinfeld',
      'The Simpsons',
      'Parks and Recreation',
      'Squadboard',
    ],
    universe_capacity: {
      Squadboard: 99,
    },
  };
}

async function mkdirTracked(dirPath: string, result: ScaffoldSquadResult): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
  result.createdDirs.push(dirPath);
}

async function writeFileIfMissing(filePath: string, content: string, result: ScaffoldSquadResult): Promise<void> {
  try {
    await fs.access(filePath);
    result.skippedFiles.push(filePath);
    return;
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
    result.createdFiles.push(filePath);
  }
}

async function ensureGitattributes(projectRoot: string, result: ScaffoldSquadResult): Promise<void> {
  const gitattributesPath = path.join(projectRoot, '.gitattributes');
  const required = [
    '.squad/decisions.md merge=union',
    '.squad/agents/*/history.md merge=union',
    '.squad/log/** merge=union',
    '.squad/orchestration-log/** merge=union',
  ];

  let existing = '';
  try {
    existing = await fs.readFile(gitattributesPath, 'utf-8');
  } catch {
    // File does not exist yet.
  }

  const missing = required.filter((line) => !existing.includes(line));
  if (missing.length === 0) {
    result.skippedFiles.push(gitattributesPath);
    return;
  }

  const next = [existing.trimEnd(), ...missing].filter(Boolean).join('\n') + '\n';
  await fs.writeFile(gitattributesPath, next, 'utf-8');
  result.createdFiles.push(gitattributesPath);
}

function buildCharter(member: SetupTeamMember, projectName: string, description?: string | null): string {
  if (member.charter?.trim()) return member.charter.trimEnd() + '\n';
  return [
    `# ${member.name} — ${member.role}`,
    '',
    `> ${member.role} for ${projectName}.`,
    '',
    '## Identity',
    '',
    `- **Name:** ${member.name}`,
    `- **Role:** ${member.role}`,
    '- **Model:** auto',
    '',
    '## Project Context',
    '',
    description?.trim() || 'No project description captured yet.',
    '',
    '## How I Work',
    '',
    '- Read `.squad/team.md` and `.squad/routing.md` before starting.',
    '- Keep decisions visible by writing durable notes to `.squad/decisions/inbox/` when needed.',
    '- Ask the coordinator for another specialist when work crosses boundaries.',
    '',
  ].join('\n');
}

function buildHistory(member: SetupTeamMember, options: ScaffoldSquadOptions): string {
  const now = (options.now ?? new Date()).toISOString();
  return [
    `# ${member.name} — History`,
    '',
    '## Core Context',
    '',
    `- **Role:** ${member.role}`,
    `- **Project:** ${options.projectName}`,
    `- **Joined:** ${now}`,
    `- **Setup note:** ${options.description?.trim() || 'Initial Squadboard setup.'}`,
    '',
    '## Learnings',
    '',
    '<!-- Append learnings below -->',
    '',
  ].join('\n');
}

export async function scaffoldSquad(options: ScaffoldSquadOptions): Promise<ScaffoldSquadResult> {
  const squadPath = normalizeSquadPath(options.squadPath);
  const projectRoot = path.dirname(squadPath);
  const team = options.team ?? [];
  const now = options.now ?? new Date();
  const result: ScaffoldSquadResult = {
    squadPath,
    projectRoot,
    createdFiles: [],
    skippedFiles: [],
    createdDirs: [],
    teamMemberCount: team.length,
  };

  const dirs = [
    squadPath,
    path.join(squadPath, 'agents'),
    path.join(squadPath, 'casting'),
    path.join(squadPath, 'decisions', 'inbox'),
    path.join(squadPath, 'orchestration-log'),
    path.join(squadPath, 'skills'),
    path.join(squadPath, 'log'),
    path.join(squadPath, 'squadboard', 'templates', 'project'),
    path.join(squadPath, 'squadboard', 'templates', 'team'),
    path.join(squadPath, 'squadboard', 'templates', 'workflow'),
  ];
  for (const dir of dirs) {
    await mkdirTracked(dir, result);
  }

  await writeFileIfMissing(path.join(squadPath, 'team.md'), buildTeamMarkdown({ ...options, squadPath, now }), result);
  await writeFileIfMissing(path.join(squadPath, 'routing.md'), buildRoutingMarkdown(options.routingRules, team), result);
  await writeFileIfMissing(path.join(squadPath, 'ceremonies.md'), '# Ceremonies\n\nProject ceremonies will be listed here.\n', result);
  await writeFileIfMissing(path.join(squadPath, 'decisions.md'), '# Decisions\n\n', result);
  await writeFileIfMissing(path.join(squadPath, 'casting', 'policy.json'), `${JSON.stringify(buildPolicy(), null, 2)}\n`, result);
  await writeFileIfMissing(path.join(squadPath, 'casting', 'registry.json'), `${JSON.stringify(buildCastingRegistry(team, now), null, 2)}\n`, result);
  await writeFileIfMissing(path.join(squadPath, 'casting', 'history.json'), `${JSON.stringify(buildCastingHistory(team, now), null, 2)}\n`, result);

  for (const dir of dirs.filter((d) => d !== squadPath)) {
    await writeFileIfMissing(path.join(dir, '.gitkeep'), '', result);
  }

  for (const member of team) {
    if (member.kind === 'human' || member.kind === 'virtual-copilot') continue;
    const slug = slugifySetupName(member.name);
    const agentDir = path.join(squadPath, 'agents', slug);
    await mkdirTracked(agentDir, result);
    await writeFileIfMissing(path.join(agentDir, 'charter.md'), buildCharter(member, options.projectName, options.description), result);
    await writeFileIfMissing(path.join(agentDir, 'history.md'), buildHistory(member, { ...options, now }), result);
  }

  await ensureGitattributes(projectRoot, result);
  return result;
}

function memberFromBundle(member: NonNullable<SquadboardBundle['team']>[number]): SetupTeamMember {
  return {
    name: member.name,
    role: member.role,
    kind: 'project-agent',
    charter: member.charter ?? null,
    status: 'active',
  };
}

export function teamFromBundle(bundle: SquadboardBundle): SetupTeamMember[] {
  return (bundle.team ?? []).map(memberFromBundle);
}

export function routingFromBundle(bundle: SquadboardBundle): SetupRoutingRule[] {
  return (bundle.routing ?? []).map((rule) => ({
    pattern: rule.pattern,
    matchType: rule.matchType,
    agentName: rule.agentName,
    rawRule: rule.rawRule,
  }));
}

export async function scaffoldSquadFromBundle(
  bundle: SquadboardBundle,
  options: { squadPath: string; projectName?: string; description?: string | null; now?: Date },
): Promise<ScaffoldSquadResult> {
  return scaffoldSquad({
    squadPath: options.squadPath,
    projectName: options.projectName ?? bundle.project?.name ?? bundle.manifest.name,
    description: options.description ?? bundle.project?.description ?? bundle.manifest.description,
    team: teamFromBundle(bundle),
    routingRules: routingFromBundle(bundle),
    now: options.now,
  });
}

export function selectDeterministicBundle(description: string): { bundleId: string; matchedKeywords: string[] } {
  const lower = description.toLowerCase();
  for (const { keywords, bundleId } of KEYWORD_MAP) {
    const matchedKeywords = keywords.filter((keyword) => keywordMatches(lower, keyword));
    if (matchedKeywords.length > 0) return { bundleId, matchedKeywords };
  }
  return { bundleId: DEFAULT_BUNDLE_ID, matchedKeywords: [] };
}

function keywordMatches(lowerDescription: string, keyword: string): boolean {
  const lowerKeyword = keyword.toLowerCase();
  if (/^[a-z0-9+#.]+$/.test(lowerKeyword)) {
    const escaped = lowerKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(lowerDescription);
  }
  return lowerDescription.includes(lowerKeyword);
}

function ceremonyCadence(ceremony: NonNullable<SquadboardBundle['ceremonies']>[number]): string {
  const trigger = asObject(ceremony.trigger);
  const kind = typeof trigger.kind === 'string' ? trigger.kind : 'on-demand';
  if (kind === 'on_issue_entry') return 'on issue';
  if (kind === 'github') return 'GitHub event';
  if (kind === 'schedule') return 'scheduled';
  return kind.replace(/_/g, ' ');
}

function suggestionFromBundle(
  bundle: SquadboardBundle,
  args: {
    matchedKeywords: string[];
    source: ProjectSuggestion['source'];
    rationale?: string | null;
    modelUsed?: ResolveModelResult | null;
  },
): ProjectSuggestion {
  const columns = (bundle.kanban?.columns ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((column) => ({ slug: column.slug, label: column.label }));

  return {
    bundleId: bundle.manifest.bundleId,
    bundleName: bundle.manifest.name,
    description: bundle.manifest.description || bundle.project?.description || '',
    team: teamFromBundle(bundle).map((member) => ({
      ...member,
      badge: roleBadge(member.role, member.name),
    })),
    ceremonies: (bundle.ceremonies ?? []).map((ceremony) => ({
      name: ceremony.name,
      cadence: ceremonyCadence(ceremony),
    })),
    columns,
    skills: (bundle.skills ?? []).map((skill) => skill.key),
    matchedKeywords: args.matchedKeywords,
    source: args.source,
    rationale: args.rationale ?? null,
    modelUsed: args.modelUsed ?? null,
  };
}

function buildSetupPrompt(description: string, bundles: Awaited<ReturnType<typeof getBuiltinProjectTemplateBundles>>): string {
  const bundleLines = bundles.map((bundle) => (
    `- ${bundle.bundleId}: ${bundle.name} — ${bundle.description}`
  )).join('\n');

  return [
    'You are helping configure a Squadboard project. Choose the single best built-in setup bundle for the project description.',
    '',
    'Available bundles:',
    bundleLines,
    '',
    "User's project description:",
    '"""',
    description,
    '"""',
    '',
    'Respond ONLY with JSON matching:',
    '{',
    '  "bundleId": string,',
    '  "matchedKeywords": string[],',
    '  "rationale": string',
    '}',
  ].join('\n');
}

function normalizeLlmChoice(parsed: unknown): { bundleId: string; matchedKeywords: string[]; rationale: string | null } {
  const obj = asObject(parsed);
  const bundleId = typeof obj.bundleId === 'string' ? obj.bundleId.trim() : '';
  const matchedKeywords = Array.isArray(obj.matchedKeywords)
    ? obj.matchedKeywords.filter((kw): kw is string => typeof kw === 'string').map((kw) => kw.trim()).filter(Boolean).slice(0, 8)
    : [];
  const rationale = typeof obj.rationale === 'string' ? obj.rationale.trim().slice(0, 300) : null;
  return { bundleId, matchedKeywords, rationale };
}

export async function suggestProjectSetup(
  description: string,
  options: { projectId?: string | null; useLlm?: boolean } = {},
): Promise<ProjectSuggestion> {
  const trimmed = description.trim();
  if (!trimmed) {
    throw Object.assign(new Error('description is required'), { status: 400 });
  }

  const deterministic = selectDeterministicBundle(trimmed);
  const bundles = await getBuiltinProjectTemplateBundles();
  const bundleIds = new Set(bundles.map((bundle) => bundle.bundleId));

  if (options.useLlm !== false && bundles.length > 0) {
    try {
      const { raw, modelUsed } = await runFormulator({
        projectId: options.projectId ?? null,
        prompt: buildSetupPrompt(trimmed, bundles),
      });
      const choice = normalizeLlmChoice(extractJsonObject(raw));
      const bundleId = bundleIds.has(choice.bundleId) ? choice.bundleId : deterministic.bundleId;
      const bundle = await getBuiltinBundle(bundleId);
      if (bundle) {
        return suggestionFromBundle(bundle, {
          matchedKeywords: choice.matchedKeywords.length > 0 ? choice.matchedKeywords : deterministic.matchedKeywords,
          source: 'llm',
          rationale: choice.rationale,
          modelUsed,
        });
      }
    } catch (err) {
      console.warn('[setup-lifecycle] LLM setup suggestion failed; using deterministic fallback:', err);
    }
  }

  const fallbackBundle = await getBuiltinBundle(deterministic.bundleId) ?? await getBuiltinBundle(DEFAULT_BUNDLE_ID);
  if (!fallbackBundle) {
    throw new Error('No built-in project setup bundles are available');
  }

  return suggestionFromBundle(fallbackBundle, {
    matchedKeywords: deterministic.matchedKeywords,
    source: options.useLlm === false ? 'deterministic' : 'deterministic-fallback',
    rationale: deterministic.matchedKeywords.length > 0
      ? `Matched ${deterministic.matchedKeywords.slice(0, 3).join(', ')}.`
      : 'No specific setup keywords matched; using the Feature Kanban setup.',
    modelUsed: null,
  });
}

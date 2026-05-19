import type { CoordinatorInput } from './types.js';
import { parseCharterContent } from '../services/charter-compiler.js';

export interface CoordinatorIssueRow {
  id: string;
  title: string;
  body?: string | null;
  status: string;
  createdAt: Date | string;
}

export interface CoordinatorProjectRow {
  id: string;
  name: string;
  description?: string | null;
}

export interface CoordinatorAgentRow {
  id: string;
  name: string;
  role: string;
  charterHash?: string | null;
  charterContent: string;
}

export interface CoordinatorAgentKeywordRow {
  agentId: string;
  keywords?: string | null;
  focusAreas?: string | null;
}

export interface CoordinatorRunRow {
  issueId?: string;
  agentId: string;
  status: string;
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
}

export interface BuildCoordinatorInputParams {
  issue: CoordinatorIssueRow;
  labels: string[];
  project: CoordinatorProjectRow;
  agents: CoordinatorAgentRow[];
  busyAgentIds?: ReadonlySet<string>;
  recentRuns?: CoordinatorRunRow[];
  parentIssueIds?: string[];
  blockedParentIssueIds?: string[];
  agentCapabilities?: ReadonlyMap<string, string[]>;
  projectRules?: string | null;
  priority?: number | null;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toTime(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function uniq(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeCapability(value: string): string {
  return value.replace(/[`*_()[\]]/g, '').trim().toLowerCase();
}

function parseStringArrayJson(value: string | null | undefined, source: string): string[] {
  if (!value) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch (err) {
    console.warn(`[coordinator-input-builder] invalid ${source} JSON in agent_keywords; ignoring cached capabilities`, err);
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((entry): entry is string => typeof entry === 'string');
}

export function capabilitiesFromCharter(charterContent: string): string[] {
  const meta = parseCharterContent(charterContent);
  return uniq(
    (meta.expertise ?? []).flatMap((entry) =>
      entry
        .split(/[,;/|]+/)
        .map((part) => normalizeCapability(part))
        .filter((part) => part.length > 0),
    ),
  );
}

export function capabilityMapFromAgentKeywords(
  rows: CoordinatorAgentKeywordRow[],
): Map<string, string[]> {
  const capabilitiesByAgent = new Map<string, string[]>();

  for (const row of rows) {
    const capabilities = uniq([
      ...parseStringArrayJson(row.keywords, 'keywords').map(normalizeCapability),
      ...parseStringArrayJson(row.focusAreas, 'focusAreas').map(normalizeCapability),
    ]);
    capabilitiesByAgent.set(row.agentId, capabilities);
  }

  return capabilitiesByAgent;
}

export function buildCandidateAgents(
  agents: CoordinatorAgentRow[],
  busyAgentIds: ReadonlySet<string> = new Set(),
  agentCapabilities: ReadonlyMap<string, string[]> = new Map(),
): CoordinatorInput['candidateAgents'] {
  return agents.map((agent) => ({
    name: agent.name,
    role: agent.role,
    charterHash: agent.charterHash ?? '',
    charterContent: agent.charterContent,
    capabilities: uniq([
      ...capabilitiesFromCharter(agent.charterContent),
      ...(agentCapabilities.get(agent.id) ?? []),
    ]),
    available: !busyAgentIds.has(agent.id),
  }));
}

export function mapCoordinatorRecentRuns(
  rows: CoordinatorRunRow[] = [],
  agents: CoordinatorAgentRow[],
  fallbackIssueId: string,
): CoordinatorInput['recentRuns'] {
  const agentIdToName = new Map(agents.map((agent) => [agent.id, agent.name]));

  return rows
    .filter((row) => ['completed', 'failed', 'cancelled'].includes(row.status))
    .slice(0, 5)
    .map((row) => {
      const started = toTime(row.startedAt);
      const completed = toTime(row.completedAt);
      return {
        issueId: row.issueId ?? fallbackIssueId,
        agentName: agentIdToName.get(row.agentId) ?? row.agentId,
        outcome:
          row.status === 'completed'
            ? 'success' as const
            : row.status === 'failed'
              ? 'failed' as const
              : 'abandoned' as const,
        durationMs: started != null && completed != null ? Math.max(0, completed - started) : 0,
      };
    });
}

export function priorityFromLabels(labels: string[]): number | null {
  for (const label of labels) {
    const normalized = label.trim().toLowerCase();
    const match = normalized.match(/^(?:p|priority[:/_-]?)([0-5])$/);
    if (match) return Number(match[1]);
  }
  return null;
}

export function buildCoordinatorInput(params: BuildCoordinatorInputParams): CoordinatorInput {
  const parentId = params.parentIssueIds?.find((id) => Boolean(id)) ?? null;
  const blockedParentIds = uniq(params.blockedParentIssueIds ?? []);
  const projectRules = uniq([params.project.description ?? '', params.projectRules ?? '']).join('\n\n');

  return {
    issue: {
      id: params.issue.id,
      title: params.issue.title,
      body: params.issue.body ?? null,
      labels: uniq(params.labels),
      column: params.issue.status,
      parentId,
      blockedParentIds,
      priority: params.priority ?? priorityFromLabels(params.labels),
      createdAt: toIso(params.issue.createdAt),
    },
    candidateAgents: buildCandidateAgents(params.agents, params.busyAgentIds, params.agentCapabilities),
    project: {
      id: params.project.id,
      name: params.project.name,
      rules: projectRules,
    },
    recentRuns: mapCoordinatorRecentRuns(params.recentRuns, params.agents, params.issue.id),
  };
}

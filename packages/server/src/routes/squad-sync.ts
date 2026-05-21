/**
 * Project-scoped Squad sync status and repair routes.
 *
 * These endpoints are intentionally explicit: they report mode authority and
 * run opt-in repairs, but they do not start a background filesystem mirror.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { eq } from 'drizzle-orm';
import { getDb, getPool, schema } from '../db/index.js';
import {
  getProjectSyncOwnershipStatus,
  ProjectNotFoundError,
} from '../services/sdk-state.js';
import type {
  SquadSyncOwnershipStatus,
  SquadSyncProjectionArtifact,
  SquadSyncRepairAction,
} from '../sdk/sync-ownership.js';

type RepairActionId =
  | 'repair-scaffold-squad'
  | 'seed-ceremony-defaults'
  | 'project-copilot-agent-file'
  | 'generate-client-artifact'
  | 'generate-github-agent'
  | 'project-squad-to-fs'
  | 'validate-mcp-broker-guidance'
  | 'write-mcp-config';

type RepairActionStatus = 'applied' | 'dry-run' | 'skipped' | 'failed';
type RepairChangeStatus = 'applied' | 'would-apply' | 'unchanged' | 'skipped' | 'failed';

interface ProjectContext {
  id: string;
  name: string;
  description: string | null;
  squadPath: string;
  projectRoot: string;
}

interface SquadStorageMetadata {
  available: boolean;
  rowCount: number | null;
  lastUpdatedAt: string | null;
  error?: {
    code: string;
    message: string;
  };
}

interface StatusEnvelope {
  ok: true;
  data: {
    projectId: string;
    contractVersion: SquadSyncOwnershipStatus['contractVersion'];
    authority: {
      storageMode: SquadSyncOwnershipStatus['storage']['mode'];
      sourceOfTruth: SquadSyncOwnershipStatus['storage']['authority'];
      rawProvider: string | null;
      importBehavior: SquadSyncOwnershipStatus['storage']['importBehavior'];
      mirrorBehavior: SquadSyncOwnershipStatus['storage']['mirrorBehavior'];
      sharedExternalAccess: SquadSyncOwnershipStatus['storage']['sharedExternalAccess'];
      continuousSync: false;
      runtime: {
        kind: 'filesystem' | 'local-pglite' | 'hosted-postgresql';
        note: string;
      };
    };
    storage: {
      squadStorage: SquadStorageMetadata | null;
    };
    bootstrap: SquadSyncOwnershipStatus['bootstrap'];
    projection: SquadSyncOwnershipStatus['projection'];
    drift: {
      detected: boolean;
      level: 'ready' | 'warning' | 'error';
      summary: string;
      issues: Array<{
        code: string;
        severity: 'info' | 'warning' | 'error';
        artifactId?: string;
        message: string;
      }>;
      continuousSync: false;
    };
    repair: {
      dryRunSupported: true;
      actions: ApiRepairAction[];
    };
  };
}

interface ApiRepairAction {
  id: RepairActionId;
  aliases: RepairActionId[];
  owner: SquadSyncRepairAction['owner'];
  reason: string;
  mode: SquadSyncRepairAction['mode'];
  available: boolean;
  required: boolean;
  destructive: false;
  endpoint: string;
}

interface RepairChange {
  path: string;
  operation: 'create-dir' | 'write-file' | 'export-db-file';
  status: RepairChangeStatus;
  reason?: string;
  message?: string;
}

interface RepairResult {
  action: RepairActionId;
  status: RepairActionStatus;
  reason: string;
  changes: RepairChange[];
}

interface RepairResponseData {
  projectId: string;
  dryRun: boolean;
  results: RepairResult[];
  statusAfter?: StatusEnvelope['data'];
}

interface RepairOptions {
  dryRun: boolean;
  actions?: RepairActionId[];
}

interface StorageRow extends Record<string, unknown> {
  path: string;
  content: string;
}

const router = Router({ mergeParams: true });
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const DEFAULT_CEREMONIES_MD = `# Ceremonies

> Team meetings that happen before or after work. Each squad configures their own.

## Design Review

| Field | Value |
|-------|-------|
| **Trigger** | auto |
| **When** | before |
| **Condition** | multi-agent task involving 2+ agents modifying shared systems |
| **Facilitator** | lead |
| **Participants** | all-relevant |
| **Time budget** | focused |
| **Enabled** | yes |

**Agenda:**
1. Review the task and requirements
2. Agree on interfaces and contracts between components
3. Identify risks and edge cases
4. Assign action items

---

## Retrospective

| Field | Value |
|-------|-------|
| **Trigger** | auto |
| **When** | after |
| **Condition** | build failure, test failure, or reviewer rejection |
| **Facilitator** | lead |
| **Participants** | all-involved |
| **Time budget** | focused |
| **Enabled** | yes |

**Agenda:**
1. What happened? (facts only)
2. Root cause analysis
3. What should change?
4. Action items for next iteration

---

## Retrospective with Enforcement

| Field | Value |
|-------|-------|
| **Trigger** | auto |
| **When** | weekly |
| **Condition** | No retrospective log in .squad/log/ within the last 7 days |
| **Facilitator** | lead |
| **Participants** | all |
| **Time budget** | focused |
| **Enabled** | yes |
| **Enforcement skill** | retro-enforcement |

**Agenda:**
1. What shipped this week? (closed issues, merged PRs)
2. What did not ship? (open issues, blockers)
3. Root cause on any failures
4. Action items -- each MUST become a tracked follow-up
`;

const FALLBACK_GITHUB_AGENT = `---
name: Squad
description: "Your AI team. Describe what you're building, get a team of specialists that live in your repo."
---

You are **Squad (Coordinator)** — the orchestrator for this project's AI team.

Before starting work:

1. Read \`.squad/team.md\` for the current roster and agent identities.
2. Read \`.squad/routing.md\` for ownership and handoff rules.
3. Read \`.squad/decisions.md\` for durable project decisions.
4. Write new durable decisions to \`.squad/decisions/inbox/\`.

If any of those files are missing, ask the user to run Squadboard sync repair for this project before continuing.
`;

const MCP_CONFIG_RELATIVE_PATH = '.mcp.json';

const ACTION_ALIASES: Record<RepairActionId, RepairActionId> = {
  'repair-scaffold-squad': 'repair-scaffold-squad',
  'seed-ceremony-defaults': 'seed-ceremony-defaults',
  'project-copilot-agent-file': 'generate-github-agent',
  'generate-client-artifact': 'generate-github-agent',
  'generate-github-agent': 'generate-github-agent',
  'project-squad-to-fs': 'project-squad-to-fs',
  'validate-mcp-broker-guidance': 'validate-mcp-broker-guidance',
  'write-mcp-config': 'write-mcp-config',
};

function normalizeSquadPath(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  return path.basename(resolved) === '.squad'
    ? resolved
    : path.join(resolved, '.squad');
}

function toProjectRoot(squadPath: string): string {
  return path.dirname(squadPath);
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isErrno(err: unknown, code: string): boolean {
  return typeof err === 'object'
    && err !== null
    && 'code' in err
    && (err as { code?: unknown }).code === code;
}

async function fetchProject(projectId: string): Promise<ProjectContext> {
  const db = getDb();
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);

  if (!project) {
    throw new ProjectNotFoundError(projectId);
  }

  const squadPath = normalizeSquadPath(project.path);
  return {
    id: project.id,
    name: project.name,
    description: project.description ?? null,
    squadPath,
    projectRoot: toProjectRoot(squadPath),
  };
}

async function getSquadStorageMetadata(
  projectId: string,
  status: SquadSyncOwnershipStatus,
): Promise<SquadStorageMetadata | null> {
  if (status.storage.mode !== 'postgresql') {
    return null;
  }

  try {
    const { rows } = await getPool().query<{
      row_count: string | number | null;
      last_updated_at: string | Date | null;
    }>(
      'SELECT COUNT(*) AS row_count, MAX(updated_at) AS last_updated_at FROM squad_storage WHERE scope = $1',
      [projectId],
    );
    const row = rows[0];
    const lastUpdatedAt = row?.last_updated_at
      ? new Date(row.last_updated_at).toISOString()
      : null;
    return {
      available: true,
      rowCount: Number(row?.row_count ?? 0),
      lastUpdatedAt,
    };
  } catch (err) {
    return {
      available: false,
      rowCount: null,
      lastUpdatedAt: null,
      error: {
        code: 'squad_storage_metadata_unavailable',
        message: toErrorMessage(err),
      },
    };
  }
}

function runtimeFor(status: SquadSyncOwnershipStatus): StatusEnvelope['data']['authority']['runtime'] {
  if (status.storage.mode === 'filesystem') {
    return {
      kind: 'filesystem',
      note: 'Filesystem mode uses the real .squad/ directory as live authority.',
    };
  }
  if (process.env['DATABASE_URL']?.trim()) {
    return {
      kind: 'hosted-postgresql',
      note: 'PostgreSQL mode can be shared by external clients that use the same hosted database scope or the Squadboard API/MCP broker.',
    };
  }
  return {
    kind: 'local-pglite',
    note: 'PostgreSQL mode is backed by local in-process PGlite; external clients must use Squadboard API/MCP rather than opening this DB directly.',
  };
}

function buildDrift(
  status: SquadSyncOwnershipStatus,
  metadata: SquadStorageMetadata | null,
): StatusEnvelope['data']['drift'] {
  const issues: StatusEnvelope['data']['drift']['issues'] = [];
  const artifactById = new Map<string, SquadSyncProjectionArtifact>(
    status.projection.artifacts.map((artifact) => [artifact.id, artifact]),
  );

  for (const id of status.bootstrap.missingRequired) {
    const artifact = artifactById.get(id);
    issues.push({
      code: id === 'ceremoniesDefaultsPresent' ? 'ceremony_defaults_missing' : 'required_projection_missing',
      severity: 'error',
      artifactId: id,
      message: artifact
        ? `Required projection is missing: ${artifact.path}`
        : `Required projection is missing: ${id}`,
    });
  }

  for (const id of status.bootstrap.missingRecommended) {
    const artifact = artifactById.get(id);
    issues.push({
      code: 'recommended_projection_missing',
      severity: 'warning',
      artifactId: id,
      message: artifact
        ? `Recommended projection is missing: ${artifact.path}`
        : `Recommended projection is missing: ${id}`,
    });
  }

  if (metadata?.available === false) {
    issues.push({
      code: metadata.error?.code ?? 'squad_storage_metadata_unavailable',
      severity: 'warning',
      message: metadata.error?.message ?? 'Could not read squad_storage metadata.',
    });
  }

  const hasError = issues.some((issue) => issue.severity === 'error');
  const hasWarning = issues.some((issue) => issue.severity === 'warning');
  const level = hasError ? 'error' : hasWarning ? 'warning' : 'ready';
  return {
    detected: issues.length > 0,
    level,
    summary: issues.length === 0
      ? 'No missing required or recommended projection artifacts detected. No continuous filesystem mirror is running; use the MCP/API broker for CLI/Copilot changes and preview manual export before projecting database state to files.'
      : `${issues.length} sync health issue(s) detected. Repairs are preview-first and explicit; no continuous filesystem mirror is running.`,
    issues,
    continuousSync: false,
  };
}

function adaptRepairActions(status: SquadSyncOwnershipStatus): ApiRepairAction[] {
  const fromSdk = status.repairActions
    .filter((action) => action.id !== 'expose-sync-status-api')
    .map((action): ApiRepairAction => {
      const id = ACTION_ALIASES[action.id as RepairActionId] ?? action.id as RepairActionId;
      const isGuidanceOnly = action.id === 'validate-mcp-broker-guidance';
      const aliases = id === 'generate-github-agent'
        ? [...new Set(['project-copilot-agent-file', 'generate-client-artifact', ...(action.legacyIds ?? [])])] as RepairActionId[]
        : [];
      return {
        id,
        aliases,
        owner: action.owner,
        reason: action.reason,
        mode: action.mode,
        available: !isGuidanceOnly,
        required: !isGuidanceOnly,
        destructive: false,
        endpoint: id === 'generate-github-agent'
          ? 'POST /api/projects/:projectId/squad-sync/generate-github-agent'
          : 'POST /api/projects/:projectId/squad-sync/repair',
      };
    });

  const byId = new Map<RepairActionId, ApiRepairAction>();
  for (const action of fromSdk) {
    byId.set(action.id, action);
  }

  if (status.storage.mode === 'postgresql') {
    byId.set('project-squad-to-fs', {
      id: 'project-squad-to-fs',
      aliases: [],
      owner: 'Hockney',
      reason: 'Explicitly project missing squad_storage files to the repository .squad/ tree without overwriting divergent files.',
      mode: 'manual',
      available: true,
      required: false,
      destructive: false,
      endpoint: 'POST /api/projects/:projectId/squad-sync/project-squad-to-fs',
    });

    byId.set('write-mcp-config', {
      id: 'write-mcp-config',
      aliases: [],
      owner: 'Hockney',
      reason: 'Write the MCP broker config to .mcp.json so Copilot CLI can connect to this Squadboard instance.',
      mode: 'manual',
      available: true,
      required: false,
      destructive: false,
      endpoint: 'POST /api/projects/:projectId/squad-sync/repair',
    });
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function buildSquadSyncStatusEnvelope(projectId: string): Promise<StatusEnvelope> {
  const status = await getProjectSyncOwnershipStatus(projectId);
  const metadata = await getSquadStorageMetadata(projectId, status);

  return {
    ok: true,
    data: {
      projectId,
      contractVersion: status.contractVersion,
      authority: {
        storageMode: status.storage.mode,
        sourceOfTruth: status.storage.authority,
        rawProvider: status.storage.rawProvider,
        importBehavior: status.storage.importBehavior,
        mirrorBehavior: status.storage.mirrorBehavior,
        sharedExternalAccess: status.storage.sharedExternalAccess,
        continuousSync: false,
        runtime: runtimeFor(status),
      },
      storage: {
        squadStorage: metadata,
      },
      bootstrap: status.bootstrap,
      projection: status.projection,
      drift: buildDrift(status, metadata),
      repair: {
        dryRunSupported: true,
        actions: adaptRepairActions(status),
      },
    },
  };
}

function parseRepairAction(value: unknown): RepairActionId | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim() as RepairActionId;
  return ACTION_ALIASES[trimmed] ? trimmed : null;
}

async function defaultRepairActions(projectId: string): Promise<RepairActionId[]> {
  const status = await getProjectSyncOwnershipStatus(projectId);
  const actions = adaptRepairActions(status)
    .filter((action) => action.required)
    .map((action) => action.id);
  return [...new Set(actions)];
}

async function parseRepairRequest(projectId: string, body: unknown): Promise<RepairOptions> {
  const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const dryRunValue = parseDryRun(input);

  const rawActions = input['actions'] ?? input['action'];
  let actions: RepairActionId[] | undefined;
  if (rawActions !== undefined) {
    const values = Array.isArray(rawActions) ? rawActions : [rawActions];
    actions = [];
    for (const value of values) {
      if (value === 'all') {
        actions.push('repair-scaffold-squad', 'seed-ceremony-defaults', 'generate-github-agent', 'project-squad-to-fs');
        continue;
      }
      const parsed = parseRepairAction(value);
      if (!parsed) {
        throw Object.assign(new Error(`Unsupported repair action: ${String(value)}`), { status: 400 });
      }
      actions.push(ACTION_ALIASES[parsed]);
    }
    actions = [...new Set(actions)];
  } else {
    actions = await defaultRepairActions(projectId);
  }

  return {
    dryRun: dryRunValue,
    actions,
  };
}

function parseDryRun(input: Record<string, unknown>): boolean {
  const dryRunValue = input['dryRun'];
  if (dryRunValue !== undefined && typeof dryRunValue !== 'boolean') {
    throw Object.assign(new Error('`dryRun` must be a boolean when provided'), { status: 400 });
  }
  return dryRunValue === true;
}

function resultFor(
  action: RepairActionId,
  changes: RepairChange[],
  fallbackReason = 'already_up_to_date',
): RepairResult {
  const failed = changes.find((change) => change.status === 'failed');
  if (failed) {
    return {
      action,
      status: 'failed',
      reason: failed.reason ?? 'repair_failed',
      changes,
    };
  }
  const applied = changes.some((change) => change.status === 'applied');
  if (applied) {
    return { action, status: 'applied', reason: 'changes_applied', changes };
  }
  const wouldApply = changes.some((change) => change.status === 'would-apply');
  if (wouldApply) {
    return { action, status: 'dry-run', reason: 'dry_run_changes_available', changes };
  }
  const skipped = changes.find((change) => change.status === 'skipped');
  if (skipped) {
    return {
      action,
      status: 'skipped',
      reason: skipped.reason ?? fallbackReason,
      changes,
    };
  }
  return { action, status: 'skipped', reason: fallbackReason, changes };
}

function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function statKind(targetPath: string): Promise<'missing' | 'file' | 'directory' | 'symlink' | 'other' | 'inaccessible'> {
  try {
    const stat = await fs.lstat(targetPath);
    if (stat.isSymbolicLink()) return 'symlink';
    if (stat.isFile()) return 'file';
    if (stat.isDirectory()) return 'directory';
    return 'other';
  } catch (err) {
    if (isErrno(err, 'ENOENT')) return 'missing';
    return 'inaccessible';
  }
}

async function rootIsWritable(projectRoot: string): Promise<{ ok: true } | { ok: false; reason: string; message?: string }> {
  try {
    const stat = await fs.lstat(projectRoot);
    if (stat.isSymbolicLink()) {
      return { ok: false, reason: 'project_root_is_symlink' };
    }
    if (!stat.isDirectory()) {
      return { ok: false, reason: 'project_root_not_directory' };
    }
    return { ok: true };
  } catch (err) {
    if (isErrno(err, 'ENOENT')) {
      return { ok: false, reason: 'project_root_missing' };
    }
    return { ok: false, reason: 'project_root_inaccessible', message: toErrorMessage(err) };
  }
}

async function ensureParentDirs(
  projectRoot: string,
  targetPath: string,
  dryRun: boolean,
): Promise<RepairChange | null> {
  if (!isPathInside(projectRoot, targetPath)) {
    return {
      path: targetPath,
      operation: 'create-dir',
      status: 'skipped',
      reason: 'target_outside_project_root',
    };
  }

  const parent = path.dirname(targetPath);
  if (!isPathInside(projectRoot, parent)) {
    return {
      path: parent,
      operation: 'create-dir',
      status: 'skipped',
      reason: 'parent_outside_project_root',
    };
  }

  const relative = path.relative(projectRoot, parent);
  const parts = relative ? relative.split(path.sep) : [];
  let current = projectRoot;
  for (const part of parts) {
    current = path.join(current, part);
    const kind = await statKind(current);
    if (kind === 'symlink') {
      return {
        path: current,
        operation: 'create-dir',
        status: 'skipped',
        reason: 'parent_contains_symlink',
      };
    }
    if (kind !== 'missing' && kind !== 'directory') {
      return {
        path: current,
        operation: 'create-dir',
        status: 'skipped',
        reason: 'parent_component_not_directory',
      };
    }
  }

  const kind = await statKind(parent);
  if (kind === 'directory') return null;
  if (kind === 'missing') {
    if (dryRun) {
      return {
        path: parent,
        operation: 'create-dir',
        status: 'would-apply',
        reason: 'directory_missing',
      };
    }
    await fs.mkdir(parent, { recursive: true });
    return {
      path: parent,
      operation: 'create-dir',
      status: 'applied',
      reason: 'directory_created',
    };
  }

  return {
    path: parent,
    operation: 'create-dir',
    status: 'skipped',
    reason: kind === 'symlink' ? 'parent_is_symlink' : 'parent_not_directory',
  };
}

async function writeFileIfSafe(
  projectRoot: string,
  filePath: string,
  content: string,
  dryRun: boolean,
  operation: RepairChange['operation'],
  allowPlaceholderOverwrite = false,
): Promise<RepairChange[]> {
  const changes: RepairChange[] = [];
  const rootCheck = await rootIsWritable(projectRoot);
  if (!rootCheck.ok) {
    return [{
      path: projectRoot,
      operation,
      status: 'skipped',
      reason: rootCheck.reason,
      message: rootCheck.message,
    }];
  }

  if (!isPathInside(projectRoot, filePath)) {
    return [{
      path: filePath,
      operation,
      status: 'skipped',
      reason: 'target_outside_project_root',
    }];
  }

  const parentChange = await ensureParentDirs(projectRoot, filePath, dryRun);
  if (parentChange) {
    changes.push(parentChange);
    if (parentChange.status === 'skipped' || parentChange.status === 'failed') {
      return changes;
    }
  }

  const kind = await statKind(filePath);
  if (kind === 'symlink') {
    changes.push({ path: filePath, operation, status: 'skipped', reason: 'target_is_symlink' });
    return changes;
  }
  if (kind === 'directory' || kind === 'other' || kind === 'inaccessible') {
    changes.push({ path: filePath, operation, status: 'skipped', reason: `target_${kind}` });
    return changes;
  }
  if (kind === 'file') {
    let existing: string;
    try {
      existing = await fs.readFile(filePath, 'utf-8');
    } catch (err) {
      changes.push({
        path: filePath,
        operation,
        status: 'failed',
        reason: 'read_existing_failed',
        message: toErrorMessage(err),
      });
      return changes;
    }
    if (existing === content) {
      changes.push({ path: filePath, operation, status: 'unchanged', reason: 'already_up_to_date' });
      return changes;
    }
    if (!allowPlaceholderOverwrite || !isReplaceableCeremonyPlaceholder(existing)) {
      changes.push({
        path: filePath,
        operation,
        status: 'skipped',
        reason: allowPlaceholderOverwrite
          ? 'custom_ceremonies_present'
          : 'target_exists_with_different_content',
      });
      return changes;
    }
  }

  if (dryRun) {
    changes.push({
      path: filePath,
      operation,
      status: 'would-apply',
      reason: kind === 'file' ? 'placeholder_would_be_replaced' : 'file_missing',
    });
    return changes;
  }

  try {
    await fs.writeFile(filePath, content, 'utf-8');
    changes.push({
      path: filePath,
      operation,
      status: 'applied',
      reason: kind === 'file' ? 'placeholder_replaced' : 'file_created',
    });
  } catch (err) {
    changes.push({
      path: filePath,
      operation,
      status: 'failed',
      reason: 'write_failed',
      message: toErrorMessage(err),
    });
  }

  return changes;
}

async function ensureDirIfSafe(
  projectRoot: string,
  dirPath: string,
  dryRun: boolean,
): Promise<RepairChange> {
  const rootCheck = await rootIsWritable(projectRoot);
  if (!rootCheck.ok) {
    return {
      path: projectRoot,
      operation: 'create-dir',
      status: 'skipped',
      reason: rootCheck.reason,
      message: rootCheck.message,
    };
  }

  if (!isPathInside(projectRoot, dirPath)) {
    return {
      path: dirPath,
      operation: 'create-dir',
      status: 'skipped',
      reason: 'target_outside_project_root',
    };
  }

  const parentChange = await ensureParentDirs(projectRoot, dirPath, dryRun);
  if (parentChange?.status === 'skipped' || parentChange?.status === 'failed') {
    return parentChange;
  }

  const kind = await statKind(dirPath);
  if (kind === 'directory') {
    return { path: dirPath, operation: 'create-dir', status: 'unchanged', reason: 'already_exists' };
  }
  if (kind !== 'missing') {
    return {
      path: dirPath,
      operation: 'create-dir',
      status: 'skipped',
      reason: kind === 'symlink' ? 'target_is_symlink' : 'target_not_directory',
    };
  }
  if (dryRun) {
    return { path: dirPath, operation: 'create-dir', status: 'would-apply', reason: 'directory_missing' };
  }
  await fs.mkdir(dirPath, { recursive: true });
  return { path: dirPath, operation: 'create-dir', status: 'applied', reason: 'directory_created' };
}

function buildTeamMarkdown(project: ProjectContext): string {
  const description = project.description?.trim() || 'Squad-managed project.';
  return `# ${project.name}

> ${description}

## Coordinator

| Name | Role | Notes |
|------|------|-------|
| Squad | Coordinator | Routes work, enforces handoffs, and keeps reviewer gates intact. |

## Members

| Name | Role | Charter | Status | Type | Badge |
|------|------|---------|--------|------|-------|
| _No members yet_ | _Cast a team to finish setup_ | — | — | — | — |

## Project Context

- **Description:** ${description}
`;
}

function buildRoutingMarkdown(): string {
  return `# Work Routing

## Routing Table

| Work Type | Route To | Notes |
|-----------|----------|-------|
| * | Lead | Unmatched work routes to the lead for triage. |

## Issue Routing

| Label | Action | Who |
|-------|--------|-----|
| \`squad\` | Triage and assign the right \`squad:{member}\` label | Lead |
| \`squad:{name}\` | Pick up the issue and complete the work | Named member |
`;
}

async function repairScaffold(project: ProjectContext, dryRun: boolean): Promise<RepairResult> {
  const changes: RepairChange[] = [];
  const dirs = [
    project.squadPath,
    path.join(project.squadPath, 'agents'),
    path.join(project.squadPath, 'decisions'),
    path.join(project.squadPath, 'decisions', 'inbox'),
  ];

  for (const dir of dirs) {
    changes.push(await ensureDirIfSafe(project.projectRoot, dir, dryRun));
  }

  const files: Array<[string, string]> = [
    [path.join(project.squadPath, 'team.md'), buildTeamMarkdown(project)],
    [path.join(project.squadPath, 'routing.md'), buildRoutingMarkdown()],
    [path.join(project.squadPath, 'decisions.md'), '# Decisions\n\n'],
    [path.join(project.squadPath, 'ceremonies.md'), DEFAULT_CEREMONIES_MD],
  ];

  for (const [filePath, content] of files) {
    changes.push(...await writeFileIfSafe(project.projectRoot, filePath, content, dryRun, 'write-file'));
  }

  return resultFor('repair-scaffold-squad', changes);
}

function isReplaceableCeremonyPlaceholder(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.length === 0 || /^#\s*Ceremonies\s*Project ceremonies will be listed here\.\s*$/is.test(trimmed);
}

async function seedCeremonyDefaults(project: ProjectContext, dryRun: boolean): Promise<RepairResult> {
  const filePath = path.join(project.squadPath, 'ceremonies.md');
  const changes = await writeFileIfSafe(
    project.projectRoot,
    filePath,
    DEFAULT_CEREMONIES_MD,
    dryRun,
    'write-file',
    true,
  );
  return resultFor('seed-ceremony-defaults', changes);
}

async function readGithubAgentTemplate(project: ProjectContext): Promise<{ content: string; source: string }> {
  const candidates = [
    path.join(project.squadPath, 'templates', 'squad.agent.md.template'),
    path.join(process.cwd(), '.squad', 'templates', 'squad.agent.md.template'),
  ];

  for (const candidate of candidates) {
    try {
      const content = await fs.readFile(candidate, 'utf-8');
      if (content.trim()) {
        return { content, source: candidate };
      }
    } catch (err) {
      if (!isErrno(err, 'ENOENT')) {
        throw err;
      }
    }
  }

  return { content: FALLBACK_GITHUB_AGENT, source: 'built-in-fallback' };
}

async function generateGithubAgent(project: ProjectContext, dryRun: boolean): Promise<RepairResult> {
  let template: { content: string; source: string };
  try {
    template = await readGithubAgentTemplate(project);
  } catch (err) {
    return {
      action: 'generate-github-agent',
      status: 'failed',
      reason: 'template_read_failed',
      changes: [{
        path: path.join(project.projectRoot, '.github', 'agents', 'squad.agent.md'),
        operation: 'write-file',
        status: 'failed',
        reason: 'template_read_failed',
        message: toErrorMessage(err),
      }],
    };
  }

  const target = path.join(project.projectRoot, '.github', 'agents', 'squad.agent.md');
  const changes = await writeFileIfSafe(project.projectRoot, target, template.content, dryRun, 'write-file');
  const result = resultFor('generate-github-agent', changes);
  if (result.status === 'applied' || result.status === 'dry-run') {
    result.reason = template.source === 'built-in-fallback'
      ? `${result.reason}:built_in_fallback_template`
      : `${result.reason}:template=${template.source}`;
  }
  return result;
}

function normalizeStoragePath(storagePath: string): string | null {
  const normalized = path.posix.normalize(storagePath.replace(/\\/g, '/')).replace(/^\.squad\//, '');
  if (!normalized || normalized === '.' || normalized === '/') return null;
  if (path.posix.isAbsolute(normalized)) return null;
  if (normalized.split('/').some((part) => part === '..')) return null;
  return normalized;
}

async function listSquadStorageRows(projectId: string): Promise<StorageRow[]> {
  const { rows } = await getPool().query<StorageRow>(
    'SELECT path, content FROM squad_storage WHERE scope = $1 ORDER BY path ASC',
    [projectId],
  );
  return rows;
}

function buildSquadboardMcpServerConfig(): Record<string, unknown> {
  const port = process.env.PORT ?? '3000';
  return {
    url: `http://localhost:${port}/mcp`,
  };
}

async function writeMcpConfig(project: ProjectContext, status: SquadSyncOwnershipStatus, dryRun: boolean): Promise<RepairResult> {
  const targetPath = path.join(project.projectRoot, MCP_CONFIG_RELATIVE_PATH);
  const changes: RepairChange[] = [];

  if (status.storage.mode !== 'postgresql') {
    return {
      action: 'write-mcp-config',
      status: 'skipped',
      reason: 'write_mcp_config_requires_postgresql',
      changes: [{
        path: MCP_CONFIG_RELATIVE_PATH,
        operation: 'write-file',
        status: 'skipped',
        reason: 'write_mcp_config_requires_postgresql',
      }],
    };
  }

  const desiredServerConfig = buildSquadboardMcpServerConfig();
  const kind = await statKind(targetPath);
  if (kind === 'symlink') {
    changes.push({ path: MCP_CONFIG_RELATIVE_PATH, operation: 'write-file', status: 'skipped', reason: 'target_is_symlink' });
    return resultFor('write-mcp-config', changes);
  }
  if (kind === 'directory' || kind === 'other' || kind === 'inaccessible') {
    changes.push({ path: MCP_CONFIG_RELATIVE_PATH, operation: 'write-file', status: 'skipped', reason: `target_${kind}` });
    return resultFor('write-mcp-config', changes);
  }

  let config: Record<string, unknown> = {};
  let existingServer: unknown;
  if (kind === 'file') {
    let raw: string;
    try {
      raw = await fs.readFile(targetPath, 'utf-8');
    } catch (err) {
      return {
        action: 'write-mcp-config',
        status: 'failed',
        reason: 'read_existing_failed',
        changes: [{
          path: MCP_CONFIG_RELATIVE_PATH,
          operation: 'write-file',
          status: 'failed',
          reason: 'read_existing_failed',
          message: toErrorMessage(err),
        }],
      };
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isJsonObject(parsed)) {
        throw new Error(`${MCP_CONFIG_RELATIVE_PATH} must contain a JSON object.`);
      }
      config = parsed;
      const existingServers = config['mcpServers'];
      if (isJsonObject(existingServers)) {
        existingServer = existingServers['squadboard'];
      }
    } catch (err) {
      return {
        action: 'write-mcp-config',
        status: 'failed',
        reason: 'invalid_mcp_config_json',
        changes: [{
          path: MCP_CONFIG_RELATIVE_PATH,
          operation: 'write-file',
          status: 'failed',
          reason: 'invalid_mcp_config_json',
          message: toErrorMessage(err),
        }],
      };
    }
  }

  if (kind === 'file' && isDeepStrictEqual(existingServer, desiredServerConfig)) {
    changes.push({
      path: MCP_CONFIG_RELATIVE_PATH,
      operation: 'write-file',
      status: 'skipped',
      reason: 'already_up_to_date',
      message: 'already up to date',
    });
    return resultFor('write-mcp-config', changes);
  }

  const existingServers = isJsonObject(config['mcpServers']) ? config['mcpServers'] : {};
  const mergedConfig = {
    ...config,
    mcpServers: {
      ...existingServers,
      squadboard: desiredServerConfig,
    },
  };

  if (dryRun) {
    changes.push({
      path: MCP_CONFIG_RELATIVE_PATH,
      operation: 'write-file',
      status: 'would-apply',
      reason: kind === 'file' ? 'mcp_config_would_be_updated' : 'file_missing',
      message: 'would write squadboard MCP server entry',
    });
    return resultFor('write-mcp-config', changes);
  }

  try {
    await fs.writeFile(targetPath, `${JSON.stringify(mergedConfig, null, 2)}\n`, 'utf-8');
    changes.push({
      path: MCP_CONFIG_RELATIVE_PATH,
      operation: 'write-file',
      status: 'applied',
      reason: kind === 'file' ? 'mcp_config_updated' : 'file_created',
      message: 'wrote squadboard MCP server entry',
    });
  } catch (err) {
    changes.push({
      path: MCP_CONFIG_RELATIVE_PATH,
      operation: 'write-file',
      status: 'failed',
      reason: 'write_failed',
      message: toErrorMessage(err),
    });
  }

  return resultFor('write-mcp-config', changes);
}

async function projectSquadToFs(
  project: ProjectContext,
  status: SquadSyncOwnershipStatus,
  dryRun: boolean,
): Promise<RepairResult> {
  if (status.storage.mode !== 'postgresql') {
    return {
      action: 'project-squad-to-fs',
      status: 'skipped',
      reason: 'filesystem_mode_is_authoritative',
      changes: [{
        path: project.squadPath,
        operation: 'export-db-file',
        status: 'skipped',
        reason: 'filesystem_mode_is_authoritative',
      }],
    };
  }

  let rows: StorageRow[];
  try {
    rows = await listSquadStorageRows(project.id);
  } catch (err) {
    return {
      action: 'project-squad-to-fs',
      status: 'failed',
      reason: 'squad_storage_list_failed',
      changes: [{
        path: project.squadPath,
        operation: 'export-db-file',
        status: 'failed',
        reason: 'squad_storage_list_failed',
        message: toErrorMessage(err),
      }],
    };
  }

  if (rows.length === 0) {
    return {
      action: 'project-squad-to-fs',
      status: 'skipped',
      reason: 'squad_storage_empty',
      changes: [{
        path: project.squadPath,
        operation: 'export-db-file',
        status: 'skipped',
        reason: 'squad_storage_empty',
      }],
    };
  }

  const changes: RepairChange[] = [];
  for (const row of rows) {
    const normalized = normalizeStoragePath(row.path);
    if (!normalized) {
      changes.push({
        path: row.path,
        operation: 'export-db-file',
        status: 'skipped',
        reason: 'unsafe_storage_path',
      });
      continue;
    }
    const target = path.join(project.squadPath, ...normalized.split('/'));
    changes.push(...await writeFileIfSafe(
      project.projectRoot,
      target,
      row.content,
      dryRun,
      'export-db-file',
    ));
  }

  return resultFor('project-squad-to-fs', changes);
}

async function runAction(
  action: RepairActionId,
  project: ProjectContext,
  status: SquadSyncOwnershipStatus,
  dryRun: boolean,
): Promise<RepairResult> {
  switch (ACTION_ALIASES[action]) {
    case 'repair-scaffold-squad':
      return repairScaffold(project, dryRun);
    case 'seed-ceremony-defaults':
      return seedCeremonyDefaults(project, dryRun);
    case 'generate-github-agent':
      return generateGithubAgent(project, dryRun);
    case 'project-squad-to-fs':
      return projectSquadToFs(project, status, dryRun);
    case 'write-mcp-config':
      return writeMcpConfig(project, status, dryRun);
    case 'validate-mcp-broker-guidance':
      return {
        action: 'validate-mcp-broker-guidance',
        status: 'skipped',
        reason: 'manual_guidance_only',
        changes: [{
          path: project.projectRoot,
          operation: 'write-file',
          status: 'skipped',
          reason: 'manual_guidance_only',
          message: 'Generated client guidance is validated by status; no filesystem write is required for this action.',
        }],
      };
    default:
      return {
        action,
        status: 'failed',
        reason: 'unsupported_action',
        changes: [],
      };
  }
}

export async function runSquadSyncRepair(
  projectId: string,
  options: RepairOptions,
): Promise<RepairResponseData> {
  const project = await fetchProject(projectId);
  const status = await getProjectSyncOwnershipStatus(projectId);
  const actions = options.actions ?? [];
  const results: RepairResult[] = [];

  for (const action of actions) {
    results.push(await runAction(action, project, status, options.dryRun));
  }

  const response: RepairResponseData = {
    projectId,
    dryRun: options.dryRun,
    results,
  };

  if (!options.dryRun) {
    response.statusAfter = (await buildSquadSyncStatusEnvelope(projectId)).data;
  }

  return response;
}

function sendRouteError(res: Response, err: unknown): void {
  if (err instanceof ProjectNotFoundError) {
    res.status(404).json({
      ok: false,
      error: {
        code: 'project_not_found',
        message: err.message,
      },
    });
    return;
  }

  const status = typeof err === 'object' && err !== null && 'status' in err
    ? Number((err as { status?: unknown }).status)
    : 500;
  res.status(Number.isFinite(status) && status >= 400 ? status : 500).json({
    ok: false,
    error: {
      code: status === 400 ? 'bad_request' : 'internal_error',
      message: toErrorMessage(err),
    },
  });
}

router.get('/status', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    res.json(await buildSquadSyncStatusEnvelope(projectId));
  } catch (err) {
    sendRouteError(res, err);
  }
});

router.post('/repair', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const options = await parseRepairRequest(projectId, req.body);
    const data = await runSquadSyncRepair(projectId, options);
    res.json({ ok: true, data });
  } catch (err) {
    sendRouteError(res, err);
  }
});

router.post('/project-squad-to-fs', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const dryRun = parseDryRun(req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {});
    const data = await runSquadSyncRepair(projectId, {
      dryRun,
      actions: ['project-squad-to-fs'],
    });
    res.json({ ok: true, data });
  } catch (err) {
    sendRouteError(res, err);
  }
});

router.post('/generate-github-agent', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const dryRun = parseDryRun(req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {});
    const data = await runSquadSyncRepair(projectId, {
      dryRun,
      actions: ['generate-github-agent'],
    });
    res.json({ ok: true, data });
  } catch (err) {
    sendRouteError(res, err);
  }
});

export default router;

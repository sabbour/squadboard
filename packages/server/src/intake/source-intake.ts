import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { createWorkflowRun, type TriggerSource } from '../engine/workflow-runner.js';
import { eventBus } from '../realtime/event-bus.js';

export interface SourceCursorValue {
  sourceKey: string;
  cursor: string | null;
  checkpoint?: string | null;
  lastSuccessfulAt: string;
  updatedAt: string;
}

export interface SourceIssueInput {
  title: string;
  body: string;
  status: string;
  idempotencyKey: string;
  labels?: string[];
  createdBy?: string;
  deliverableType?: string;
  deliverableLink?: string | null;
  deliverableAcceptanceCriteria?: string | null;
  source?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SourceIssueOutcome {
  kind: 'created' | 'updated' | 'skipped';
  issueId: string;
  labelNames: string[];
}

const NON_TERMINAL_RUN_STATUSES = ['pending', 'running', 'splitting', 'waiting_children'] as const;

export function projectSettingKey(projectId: string, key: string): string {
  return `project:${projectId}:${key}`;
}

export function sourceCursorSettingKey(projectId: string, sourceKey: string): string {
  return projectSettingKey(projectId, `sourceCursor:${stableSourceKey(sourceKey)}`);
}

export function stableSourceKey(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 32);
}

export async function readJsonSetting<T>(
  keys: string[],
): Promise<T | null> {
  const db = getDb();
  const rows = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(inArray(schema.settings.key, keys))
    .limit(1);
  const raw = rows[0]?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as T : null;
  } catch {
    return null;
  }
}

export async function readSourceCursor(
  projectId: string,
  sourceKey: string,
): Promise<SourceCursorValue | null> {
  return readJsonSetting<SourceCursorValue>([sourceCursorSettingKey(projectId, sourceKey)]);
}

export async function writeSourceCursor(
  projectId: string,
  sourceKey: string,
  cursor: SourceCursorValue,
): Promise<void> {
  const db = getDb();
  const key = sourceCursorSettingKey(projectId, sourceKey);
  const value = JSON.stringify(cursor);
  const [existing] = await db
    .select({ id: schema.settings.id })
    .from(schema.settings)
    .where(eq(schema.settings.key, key))
    .limit(1);

  if (existing) {
    await db
      .update(schema.settings)
      .set({ value, projectId })
      .where(eq(schema.settings.id, existing.id));
    return;
  }

  await db.insert(schema.settings).values({ key, value, projectId });
}

export async function upsertSourceIssue(
  projectId: string,
  input: SourceIssueInput,
): Promise<SourceIssueOutcome> {
  const db = getDb();
  const status = await resolveIssueColumnForProject(projectId, input.status);
  const labelNames = uniqueStrings(input.labels ?? []);
  const now = input.updatedAt ?? new Date();

  const [existing] = await db
    .select()
    .from(schema.issues)
    .where(and(
      eq(schema.issues.projectId, projectId),
      eq(schema.issues.idempotencyKey, input.idempotencyKey),
    ))
    .limit(1);

  if (!existing) {
    const [maxRow] = await db
      .select({ maxPos: sql<number>`COALESCE(MAX(${schema.issues.position}), -1)` })
      .from(schema.issues)
      .where(and(
        eq(schema.issues.projectId, projectId),
        eq(schema.issues.status, status),
        eq(schema.issues.archived, 0),
      ));

    const [created] = await db
      .insert(schema.issues)
      .values({
        projectId,
        title: input.title,
        body: input.body,
        status,
        position: (maxRow?.maxPos ?? -1) + 1,
        idempotencyKey: input.idempotencyKey,
        createdBy: input.createdBy ?? 'source-intake',
        deliverableType: input.deliverableType ?? 'none',
        deliverableLink: input.deliverableLink ?? null,
        deliverableAcceptanceCriteria: input.deliverableAcceptanceCriteria ?? null,
        createdAt: input.createdAt ?? now,
        updatedAt: now,
      })
      .returning();

    await syncIssueLabels(projectId, created.id, labelNames);
    eventBus.emitIssueEvent('issue.created', projectId, {
      issue: created,
      source: input.source ?? 'source-intake',
    });
    return { kind: 'created', issueId: created.id, labelNames };
  }

  const unchanged =
    existing.title === input.title &&
    (existing.body ?? '') === input.body &&
    existing.status === status &&
    existing.deliverableType === (input.deliverableType ?? existing.deliverableType) &&
    existing.deliverableLink === (input.deliverableLink ?? existing.deliverableLink);

  await syncIssueLabels(projectId, existing.id, labelNames);
  if (unchanged) {
    return { kind: 'skipped', issueId: existing.id, labelNames };
  }

  const [updated] = await db
    .update(schema.issues)
    .set({
      title: input.title,
      body: input.body,
      status,
      deliverableType: input.deliverableType ?? existing.deliverableType,
      deliverableLink: input.deliverableLink ?? existing.deliverableLink,
      deliverableAcceptanceCriteria:
        input.deliverableAcceptanceCriteria ?? existing.deliverableAcceptanceCriteria,
      updatedAt: now,
    })
    .where(eq(schema.issues.id, existing.id))
    .returning();

  eventBus.emitIssueEvent('issue.updated', projectId, {
    issue: updated,
    source: input.source ?? 'source-intake',
  });
  return { kind: 'updated', issueId: existing.id, labelNames };
}

export async function syncIssueLabels(
  projectId: string,
  issueId: string,
  labelNames: string[],
): Promise<void> {
  const names = uniqueStrings(labelNames);
  if (names.length === 0) return;
  const db = getDb();
  const existing = await db
    .select({ id: schema.labels.id, name: schema.labels.name })
    .from(schema.labels)
    .where(eq(schema.labels.projectId, projectId));
  const byName = new Map(existing.map((label) => [label.name.toLowerCase(), label.id]));

  const labelIds: string[] = [];
  for (const name of names) {
    const key = name.toLowerCase();
    let labelId = byName.get(key);
    if (!labelId) {
      const [created] = await db
        .insert(schema.labels)
        .values({ projectId, name })
        .returning({ id: schema.labels.id });
      labelId = created.id;
      byName.set(key, labelId);
    }
    labelIds.push(labelId);
  }

  await db
    .insert(schema.issueLabels)
    .values(labelIds.map((labelId) => ({ issueId, labelId })))
    .onConflictDoNothing();
}

export async function enqueueIssueEntryWorkflows(params: {
  projectId: string;
  issueId: string;
  column: string;
  labelNames: string[];
  preferredWorkflowSlug?: string;
  trigger: TriggerSource | undefined;
}): Promise<number> {
  const db = getDb();
  const candidates = await db
    .select({
      workflowId: schema.workflows.id,
      workflowName: schema.workflows.name,
      workflowSlug: schema.workflows.slug,
      triggerConfig: schema.workflows.triggerConfig,
      versionId: schema.workflowVersions.id,
    })
    .from(schema.workflows)
    .innerJoin(schema.workflowVersions, eq(schema.workflowVersions.workflowId, schema.workflows.id))
    .where(and(
      eq(schema.workflows.projectId, params.projectId),
      eq(schema.workflows.triggerKind, 'on_issue_entry'),
      eq(schema.workflows.status, 'active'),
      eq(schema.workflowVersions.isActive, true),
    ));

  let started = 0;
  for (const candidate of candidates) {
    if (params.preferredWorkflowSlug && !sameWorkflowKey(params.preferredWorkflowSlug, candidate)) {
      continue;
    }
    if (!issueEntryTriggerMatches(candidate.triggerConfig, params.column, params.labelNames)) {
      continue;
    }

    const startedRun = await startWorkflowVersionForIssue({
      issueId: params.issueId,
      workflowVersionId: candidate.versionId,
      trigger: params.trigger,
    });
    if (startedRun) started += 1;
  }

  return started;
}

export async function startWorkflowForIssue(params: {
  workflowId: string;
  issueId: string;
  trigger: TriggerSource | undefined;
}): Promise<string | null> {
  const db = getDb();
  const [workflow] = await db
    .select({
      workflowId: schema.workflows.id,
      workflowKind: schema.workflows.kind,
      workflowStatus: schema.workflows.status,
      versionId: schema.workflowVersions.id,
    })
    .from(schema.workflows)
    .innerJoin(schema.workflowVersions, eq(schema.workflowVersions.workflowId, schema.workflows.id))
    .where(and(
      eq(schema.workflows.id, params.workflowId),
      eq(schema.workflowVersions.isActive, true),
    ))
    .limit(1);

  if (!workflow || workflow.workflowKind === 'narrative' || workflow.workflowStatus !== 'active') {
    return null;
  }

  return startWorkflowVersionForIssue({
    issueId: params.issueId,
    workflowVersionId: workflow.versionId,
    trigger: params.trigger,
  });
}

async function startWorkflowVersionForIssue(params: {
  issueId: string;
  workflowVersionId: string;
  trigger: TriggerSource | undefined;
}): Promise<string | null> {
  const db = getDb();
  const [active] = await db
    .select({ id: schema.workflowRuns.id })
    .from(schema.workflowRuns)
    .where(and(
      eq(schema.workflowRuns.issueId, params.issueId),
      eq(schema.workflowRuns.workflowVersionId, params.workflowVersionId),
      inArray(schema.workflowRuns.status, [...NON_TERMINAL_RUN_STATUSES]),
    ))
    .limit(1);
  if (active) return null;

  await db
    .insert(schema.issueWorkflows)
    .values({ issueId: params.issueId, workflowVersionId: params.workflowVersionId })
    .onConflictDoUpdate({
      target: schema.issueWorkflows.issueId,
      set: { workflowVersionId: params.workflowVersionId, attachedAt: new Date() },
    });

  return createWorkflowRun(params.issueId, params.workflowVersionId, params.trigger);
}

export async function resolveIssueColumnForProject(
  projectId: string,
  preferred: string,
): Promise<string> {
  const db = getDb();
  const [preferredColumn] = await db
    .select({ columnId: schema.columnMeta.columnId })
    .from(schema.columnMeta)
    .where(and(eq(schema.columnMeta.projectId, projectId), eq(schema.columnMeta.columnId, preferred)))
    .limit(1);
  if (preferredColumn) return preferred;

  const [defaultColumn] = await db
    .select({ columnId: schema.columnMeta.columnId })
    .from(schema.columnMeta)
    .where(and(eq(schema.columnMeta.projectId, projectId), eq(schema.columnMeta.isDefault, true)))
    .limit(1);
  return defaultColumn?.columnId ?? 'backlog';
}

function issueEntryTriggerMatches(
  rawConfig: unknown,
  column: string,
  labelNames: string[],
): boolean {
  const config = rawConfig && typeof rawConfig === 'object'
    ? rawConfig as Record<string, unknown>
    : {};
  const configuredColumn = stringValue(config['column'])
    ?? stringValue(config['columnSlug'])
    ?? stringValue(config['targetColumn'])
    ?? stringValue(config['status']);
  const configuredLabels = stringArray(config['labels'])
    .concat(stringArray(config['labelNames']))
    .map((label) => label.toLowerCase());

  if (!configuredColumn && configuredLabels.length === 0) return true;
  if (configuredColumn && configuredColumn === column) return true;
  if (configuredLabels.length > 0) {
    const incoming = new Set(labelNames.map((label) => label.toLowerCase()));
    return configuredLabels.some((label) => incoming.has(label));
  }
  return false;
}

function sameWorkflowKey(
  key: string,
  candidate: { workflowId: string; workflowName: string; workflowSlug: string },
): boolean {
  const normalized = normalizeWorkflowKey(key);
  return normalized === normalizeWorkflowKey(candidate.workflowId)
    || normalized === normalizeWorkflowKey(candidate.workflowSlug)
    || normalized === normalizeWorkflowKey(candidate.workflowName);
}

function normalizeWorkflowKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

/**
 * ceremonies.ts — Phase 10 ceremony API surface
 *
 * Ceremonies are the unification of workflows + scheduled jobs + event
 * reactions + narrative documentation. The DB tables stay named
 * `workflows*` for migration cost reasons (see Phase 10 plan); the rename
 * happens at the API + UI boundary.
 *
 * Mounts:
 *   ceremoniesRouter        → /api/projects/:projectId/ceremonies
 *   ceremoniesTopRouter     → /api/ceremonies          (templates, validate)
 *
 * Endpoints (project-scoped):
 *   GET    /                         list (filters: kind, triggerKind)
 *   POST   /                         create (yamlContent + triggerKind + …)
 *   GET    /audit                   ceremony audit summary
 *   GET    /:id                      get + active version + versions[]
 *   GET    /:id/runs                 list execution runs + step logs
 *   PATCH  /:id                      update name/desc/triggerKind/triggerConfig/kind/yaml
 *   DELETE /:id                      archive (deactivate all versions)
 *   POST   /:id/run                  ad-hoc spawn (Run-now button)
 *   POST   /:id/preview-cron         { cronExpr, timezone?, count? } → next N
 *   POST   /:id/convert              501 (Phase 11 narrative → executable)
 *   GET    /:id/schedules            list ceremony_schedules
 *   POST   /:id/schedules            create
 *   PATCH  /:id/schedules/:sId       update
 *   DELETE /:id/schedules/:sId       delete
 *
 * Endpoints (top-level):
 *   GET    /templates                bundled templates
 *   POST   /validate                 { yamlContent } → { valid, errors }
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { eq, and, sql, gte, count, isNotNull, inArray, desc, asc } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { parseWorkflowYaml, validateWorkflowYaml } from '../services/workflow-parser.js';
import { deriveOrigin, type CeremonyOrigin } from '../services/ceremony-origin.js';
import {
  spawnCeremonyRun,
  previewNextFireTimes,
  computeNextFire,
} from '../services/ceremony-scheduler.js';
import {
  translateNarrative,
  translateProse,
  refineProse,
  TranslatorError,
  TranslatorThrottledError,
  invokeBuiltInCeremony,
  type TranslatorAvailableAgent,
} from '../services/ceremony-translator.js';
import { getBuiltinTemplates } from '../workflows/templates/index.js';
import { exportCeremonyAsYaml } from '../services/ceremony-yaml-export.js';
import { importCeremonyFromYaml, type ImportResult } from '../services/ceremony-yaml-import.js';
import { isProtectedBuiltInCeremony } from '../ceremonies/built-in/protection.js';
import { getBuiltInCeremonyMetadata } from '../ceremonies/built-in/index.js';
import {
  buildRunLifecycleMetadata,
  resolveWorktreeExists,
  type CeremonyLifecycleMetadata,
  type LifecycleRunLike,
} from '../services/worktree-lifecycle.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_TRIGGER_KINDS = ['on_issue_entry', 'on_schedule', 'on_event', 'manual', 'agent-signal'] as const;
const VALID_KINDS = ['workflow', 'ceremony', 'review_policy', 'narrative'] as const;
const VALID_STATUSES = ['active', 'draft', 'paused', 'archived'] as const;

type TriggerKind = (typeof VALID_TRIGGER_KINDS)[number];
type CeremonyKind = (typeof VALID_KINDS)[number];
type CeremonyStatus = (typeof VALID_STATUSES)[number];

function handleError(res: Response, err: unknown): void {
  console.error('[ceremonies] error:', err);
  const msg = err instanceof Error ? err.message : 'Internal server error';
  res.status(500).json({ error: msg });
}

function manualRunContext(body: unknown): Record<string, unknown> | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const record = body as Record<string, unknown>;
  const explicit = record['context'] ?? record['runContext'];
  if (explicit && typeof explicit === 'object' && !Array.isArray(explicit)) {
    return explicit as Record<string, unknown>;
  }

  const context: Record<string, unknown> = {};
  for (const key of ['mode', 'selectedDocs', 'source', 'reason']) {
    if (record[key] !== undefined) context[key] = record[key];
  }
  return Object.keys(context).length > 0 ? context : undefined;
}

function isValidTriggerKind(s: unknown): s is TriggerKind {
  return typeof s === 'string' && (VALID_TRIGGER_KINDS as readonly string[]).includes(s);
}

function isValidKind(s: unknown): s is CeremonyKind {
  return typeof s === 'string' && (VALID_KINDS as readonly string[]).includes(s);
}

function isValidStatus(s: unknown): s is CeremonyStatus {
  return typeof s === 'string' && (VALID_STATUSES as readonly string[]).includes(s);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

type WorkflowRunLifecycleRow = Omit<LifecycleRunLike, 'id'> & {
  id: string;
  workflowId: string;
};

type IssueRunLifecycleRow = Omit<LifecycleRunLike, 'id'> & {
  id: string;
  workflowRunId: string;
};

function chooseIssueRunForLifecycle(rows: IssueRunLifecycleRow[]): IssueRunLifecycleRow | null {
  return rows.find((row) => row.status === 'running' || row.status === 'pending')
    ?? rows[0]
    ?? null;
}

async function loadCeremonyLifecycleMap(workflowIds: string[]): Promise<Map<string, CeremonyLifecycleMetadata>> {
  const lifecycleByWorkflow = new Map<string, CeremonyLifecycleMetadata>();
  if (workflowIds.length === 0) return lifecycleByWorkflow;

  const db = getDb();
  const runRows = await db
    .select({
      workflowId: schema.workflowVersions.workflowId,
      id: schema.workflowRuns.id,
      status: schema.workflowRuns.status,
      createdAt: schema.workflowRuns.createdAt,
      updatedAt: schema.workflowRuns.updatedAt,
    })
    .from(schema.workflowRuns)
    .innerJoin(
      schema.workflowVersions,
      eq(schema.workflowRuns.workflowVersionId, schema.workflowVersions.id),
    )
    .where(inArray(schema.workflowVersions.workflowId, workflowIds))
    .orderBy(desc(schema.workflowRuns.createdAt));

  const latestRunByWorkflow = new Map<string, WorkflowRunLifecycleRow>();
  for (const row of runRows) {
    if (row.id && !latestRunByWorkflow.has(row.workflowId)) {
      latestRunByWorkflow.set(row.workflowId, row);
    }
  }

  const runIds = [...latestRunByWorkflow.values()].map((row) => row.id).filter(Boolean) as string[];
  const issueRunRows = runIds.length > 0
    ? await db
      .select({
        workflowRunId: schema.stepRuns.workflowRunId,
        id: schema.issueRuns.id,
        status: schema.issueRuns.status,
        workspaceStrategy: schema.issueRuns.workspaceStrategy,
        workspacePath: schema.issueRuns.workspacePath,
        gitBranch: schema.issueRuns.gitBranch,
        startedAt: schema.issueRuns.startedAt,
        completedAt: schema.issueRuns.completedAt,
        createdAt: schema.issueRuns.createdAt,
        updatedAt: schema.issueRuns.updatedAt,
      })
      .from(schema.stepRuns)
      .leftJoin(schema.issueRuns, eq(schema.stepRuns.issueRunId, schema.issueRuns.id))
      .where(inArray(schema.stepRuns.workflowRunId, runIds))
      .orderBy(desc(schema.stepRuns.updatedAt))
    : [];

  const issueRunsByWorkflowRun = new Map<string, IssueRunLifecycleRow[]>();
  for (const row of issueRunRows) {
    if (!row.id) continue;
    const rows = issueRunsByWorkflowRun.get(row.workflowRunId) ?? [];
    rows.push({ ...row, id: row.id });
    issueRunsByWorkflowRun.set(row.workflowRunId, rows);
  }

  await Promise.all([...latestRunByWorkflow].map(async ([workflowId, workflowRun]) => {
    const issueRun = chooseIssueRunForLifecycle(issueRunsByWorkflowRun.get(workflowRun.id) ?? []);
    const worktreePath = issueRun?.workspaceStrategy === 'worktree' ? issueRun.workspacePath : null;
    lifecycleByWorkflow.set(workflowId, buildRunLifecycleMetadata({
      workflowRun,
      issueRun,
      worktreeExists: await resolveWorktreeExists(worktreePath),
    }));
  }));

  return lifecycleByWorkflow;
}

async function loadActiveVersionIdMap(workflowIds: string[]): Promise<Map<string, string>> {
  const versionByWorkflow = new Map<string, string>();
  if (workflowIds.length === 0) return versionByWorkflow;
  const db = getDb();
  const rows = await db
    .select({
      workflowId: schema.workflowVersions.workflowId,
      id: schema.workflowVersions.id,
    })
    .from(schema.workflowVersions)
    .where(and(
      inArray(schema.workflowVersions.workflowId, workflowIds),
      eq(schema.workflowVersions.isActive, true),
    ));
  for (const row of rows) {
    if (!versionByWorkflow.has(row.workflowId)) {
      versionByWorkflow.set(row.workflowId, row.id);
    }
  }
  return versionByWorkflow;
}

function parseRunLimit(value: unknown): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(parsed)) return 25;
  return Math.min(Math.max(parsed, 1), 100);
}

function sourceYamlPath(row: { triggerConfig: unknown }): string | null {
  if (!row.triggerConfig || typeof row.triggerConfig !== 'object') return null;
  const value = (row.triggerConfig as { sourceYamlPath?: unknown }).sourceYamlPath;
  return typeof value === 'string' ? value : null;
}

function ceremonyOrigin(row: { parentNarrativeId?: string | null; triggerConfig: unknown }): CeremonyOrigin {
  return deriveOrigin({
    parentNarrativeId: row.parentNarrativeId,
    sourceYamlPath: sourceYamlPath(row),
    templateId: sourceYamlPath(row)?.startsWith('import:built-in/') ? 'built-in' : null,
  });
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function triggerConfigRecord(row: { triggerConfig: unknown }): Record<string, unknown> {
  return row.triggerConfig && typeof row.triggerConfig === 'object'
    ? row.triggerConfig as Record<string, unknown>
    : {};
}

function ceremonyTags(row: { slug: string; triggerConfig: unknown }): string[] {
  const configTags = stringArray(triggerConfigRecord(row).tags);
  if (configTags.length > 0) return configTags;
  if (sourceYamlPath(row)?.startsWith('import:built-in/')) {
    return [...(getBuiltInCeremonyMetadata(row.slug)?.tags ?? [])];
  }
  return [];
}

function ceremonyCategory(row: { slug: string; triggerConfig: unknown }): string | null {
  const configCategory = triggerConfigRecord(row).category;
  if (typeof configCategory === 'string' && configCategory.trim().length > 0) {
    return configCategory;
  }
  if (sourceYamlPath(row)?.startsWith('import:built-in/')) {
    return getBuiltInCeremonyMetadata(row.slug)?.category ?? null;
  }
  return null;
}

/** Extract `# Heading` (or `## Heading`) from the first non-blank markdown line. */
function extractFirstMarkdownHeading(markdown: string): string | null {
  for (const line of markdown.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^#{1,6}\s+(.+?)\s*#*$/);
    if (m) return m[1];
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// ceremoniesRouter — project-scoped
// ---------------------------------------------------------------------------

export const ceremoniesRouter = Router({ mergeParams: true });

// GET / — list ceremonies for a project (filters: kind, triggerKind)
ceremoniesRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const { kind, triggerKind } = req.query as Record<string, string | undefined>;
    const db = getDb();

    const conditions = [eq(schema.workflows.projectId, projectId)];
    if (kind) conditions.push(eq(schema.workflows.kind, kind));
    if (triggerKind) conditions.push(eq(schema.workflows.triggerKind, triggerKind));

    const rows = await db
      .select()
      .from(schema.workflows)
      .where(and(...conditions));

    const workflowIds = rows.map((row) => row.id);
    const lifecycleByWorkflow = await loadCeremonyLifecycleMap(workflowIds);
    const activeVersionIds = await loadActiveVersionIdMap(workflowIds);

    // CER-1: attach computed origin field (no schema change; derived from existing columns)
    const result = rows.map((row) => ({
      ...row,
      origin: ceremonyOrigin(row) satisfies CeremonyOrigin,
      category: ceremonyCategory(row),
      tags: ceremonyTags(row),
      activeVersionId: activeVersionIds.get(row.id) ?? null,
      protected: isProtectedBuiltInCeremony(row),
      lifecycle: lifecycleByWorkflow.get(row.id) ?? buildRunLifecycleMetadata({}),
    }));

    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// POST / — create a ceremony.
// Body: { yamlContent, triggerKind?, triggerConfig?, kind? }
ceremoniesRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const {
      yamlContent,
      triggerKind = 'on_issue_entry',
      triggerConfig = {},
      kind = 'ceremony',
    } = req.body as {
      yamlContent?: string;
      triggerKind?: string;
      triggerConfig?: Record<string, unknown>;
      kind?: string;
    };

    if (!yamlContent) {
      res.status(400).json({ error: '`yamlContent` is required' });
      return;
    }
    if (!isValidTriggerKind(triggerKind)) {
      res.status(400).json({ error: `triggerKind must be one of: ${VALID_TRIGGER_KINDS.join(', ')}` });
      return;
    }
    if (!isValidKind(kind)) {
      res.status(400).json({ error: `kind must be one of: ${VALID_KINDS.join(', ')}` });
      return;
    }

    // Narrative rows store markdown verbatim in yamlContent — skip the YAML
    // validator and synthesise name/slug from the request body or the first
    // markdown heading.
    if (kind === 'narrative') {
      const db = getDb();
      const { name, description } = req.body as { name?: string; description?: string };
      const derivedName = (name && name.trim()) || extractFirstMarkdownHeading(yamlContent) || 'Narrative ceremony';
      const slug = slugify(derivedName);

      const [narrative] = await db
        .insert(schema.workflows)
        .values({
          projectId,
          name: derivedName,
          slug,
          description: description ?? null,
          triggerKind,
          triggerConfig,
          kind,
        })
        .returning();

      const [version] = await db
        .insert(schema.workflowVersions)
        .values({
          workflowId: narrative.id,
          version: 1,
          yamlContent,
          isActive: true,
        })
        .returning();

      res.status(201).json({ ceremony: narrative, version });
      return;
    }

    const { valid, errors } = validateWorkflowYaml(yamlContent);
    if (!valid) {
      res.status(422).json({ error: 'Invalid ceremony YAML', errors });
      return;
    }

    const definition = await parseWorkflowYaml(yamlContent);
    const slug = slugify(definition.name);
    const db = getDb();

    const [workflow] = await db
      .insert(schema.workflows)
      .values({
        projectId,
        name: definition.name,
        slug,
        description: definition.description,
        triggerKind,
        triggerConfig,
        kind,
      })
      .returning();

    const [version] = await db
      .insert(schema.workflowVersions)
      .values({
        workflowId: workflow.id,
        version: 1,
        yamlContent,
        jsonSchema: definition.outputSchema ? JSON.stringify(definition.outputSchema) : null,
        isActive: true,
      })
      .returning();

    res.status(201).json({ ceremony: workflow, version });
  } catch (err) {
    handleError(res, err);
  }
});

// Static GET routes must be registered before /:id so Express does not treat
// reserved path segments such as "audit" as ceremony ids.
ceremoniesRouter.get('/audit', getCeremonyAudit);

// GET /:id
ceremoniesRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const { projectId, id } = req.params as Record<string, string>;
    const db = getDb();

    const [workflow] = await db
      .select()
      .from(schema.workflows)
      .where(and(eq(schema.workflows.id, id), eq(schema.workflows.projectId, projectId)))
      .limit(1);

    if (!workflow) {
      res.status(404).json({ error: 'Ceremony not found' });
      return;
    }

    const versions = await db
      .select()
      .from(schema.workflowVersions)
      .where(eq(schema.workflowVersions.workflowId, id));

    const activeVersion = versions.find((v) => v.isActive) ?? versions[versions.length - 1] ?? null;

    const lifecycleByWorkflow = await loadCeremonyLifecycleMap([workflow.id]);

    // CER-1: attach computed origin field
    const ceremonyWithOrigin = {
      ...workflow,
      origin: ceremonyOrigin(workflow) satisfies CeremonyOrigin,
      activeVersionId: activeVersion?.id ?? null,
      protected: isProtectedBuiltInCeremony(workflow),
      lifecycle: lifecycleByWorkflow.get(workflow.id) ?? buildRunLifecycleMetadata({}),
    };

    res.json({ ceremony: ceremonyWithOrigin, activeVersion, versions });
  } catch (err) {
    handleError(res, err);
  }
});

// GET /:id/yaml — CER-3: export ceremony as canonical workflow YAML
ceremoniesRouter.get('/:id/yaml', async (req: Request, res: Response) => {
  try {
    const { projectId, id } = req.params as Record<string, string>;
    const db = getDb();

    // Verify ceremony belongs to this project
    const [row] = await db
      .select({ id: schema.workflows.id })
      .from(schema.workflows)
      .where(and(eq(schema.workflows.id, id), eq(schema.workflows.projectId, projectId)))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: 'Ceremony not found' });
      return;
    }

    const yamlText = await exportCeremonyAsYaml(id);

    res
      .status(200)
      .set('Content-Type', 'text/yaml; charset=utf-8')
      .set('Cache-Control', 'no-cache, no-store, must-revalidate')
      .send(yamlText);
  } catch (err) {
    const status = (err as Error & { status?: number }).status;
    if (status === 404) {
      res.status(404).json({ error: 'Ceremony not found' });
      return;
    }
    handleError(res, err);
  }
});

// GET /:id/runs — execution history and step-level logs for one ceremony.
ceremoniesRouter.get('/:id/runs', async (req: Request, res: Response) => {
  try {
    const { projectId, id } = req.params as Record<string, string>;
    const limit = parseRunLimit((req.query as Record<string, unknown>)['limit']);
    const db = getDb();

    const [ceremony] = await db
      .select({
        id: schema.workflows.id,
        projectId: schema.workflows.projectId,
        name: schema.workflows.name,
        slug: schema.workflows.slug,
        triggerKind: schema.workflows.triggerKind,
        kind: schema.workflows.kind,
      })
      .from(schema.workflows)
      .where(and(eq(schema.workflows.id, id), eq(schema.workflows.projectId, projectId)))
      .limit(1);

    if (!ceremony) {
      res.status(404).json({ error: 'Ceremony not found' });
      return;
    }

    const versions = await db
      .select({
        id: schema.workflowVersions.id,
        version: schema.workflowVersions.version,
        createdAt: schema.workflowVersions.createdAt,
      })
      .from(schema.workflowVersions)
      .where(eq(schema.workflowVersions.workflowId, id))
      .orderBy(desc(schema.workflowVersions.version));

    const versionIds = versions.map((version) => version.id);
    if (versionIds.length === 0) {
      res.json({ ceremony, versions, runs: [] });
      return;
    }

    const runRows = await db
      .select({
        id: schema.workflowRuns.id,
        issueId: schema.workflowRuns.issueId,
        issueTitle: schema.issues.title,
        issueStatus: schema.issues.status,
        workflowVersionId: schema.workflowRuns.workflowVersionId,
        workflowVersionNumber: schema.workflowVersions.version,
        status: schema.workflowRuns.status,
        currentStepIndex: schema.workflowRuns.currentStepIndex,
        triggerSource: schema.workflowRuns.triggerSource,
        premiumRequests: schema.workflowRuns.premiumRequests,
        createdAt: schema.workflowRuns.createdAt,
        updatedAt: schema.workflowRuns.updatedAt,
      })
      .from(schema.workflowRuns)
      .innerJoin(schema.workflowVersions, eq(schema.workflowRuns.workflowVersionId, schema.workflowVersions.id))
      .leftJoin(schema.issues, eq(schema.workflowRuns.issueId, schema.issues.id))
      .where(inArray(schema.workflowRuns.workflowVersionId, versionIds))
      .orderBy(desc(schema.workflowRuns.createdAt))
      .limit(limit);

    const workflowRunIds = runRows.map((run) => run.id);
    const stepRows = workflowRunIds.length > 0
      ? await db
        .select({
          id: schema.stepRuns.id,
          workflowRunId: schema.stepRuns.workflowRunId,
          issueRunId: schema.stepRuns.issueRunId,
          stepIndex: schema.stepRuns.stepIndex,
          stepType: schema.stepRuns.stepType,
          status: schema.stepRuns.status,
          output: schema.stepRuns.output,
          reviewDecision: schema.stepRuns.reviewDecision,
          reviewComment: schema.stepRuns.reviewComment,
          sessionId: schema.stepRuns.sessionId,
          startedAt: schema.stepRuns.startedAt,
          createdAt: schema.stepRuns.createdAt,
          updatedAt: schema.stepRuns.updatedAt,
          issueRunStatus: schema.issueRuns.status,
          issueRunOutput: schema.issueRuns.output,
          issueRunError: schema.issueRuns.errorMessage,
          agentId: schema.issueRuns.agentId,
          agentName: schema.agents.name,
        })
        .from(schema.stepRuns)
        .leftJoin(schema.issueRuns, eq(schema.stepRuns.issueRunId, schema.issueRuns.id))
        .leftJoin(schema.agents, eq(schema.issueRuns.agentId, schema.agents.id))
        .where(inArray(schema.stepRuns.workflowRunId, workflowRunIds))
        .orderBy(asc(schema.stepRuns.workflowRunId), asc(schema.stepRuns.stepIndex))
      : [];

    const issueRunIds = stepRows
      .map((step) => step.issueRunId)
      .filter((issueRunId): issueRunId is string => Boolean(issueRunId));

    const eventRows = issueRunIds.length > 0
      ? await db
        .select({
          id: schema.issueRunEvents.id,
          runId: schema.issueRunEvents.runId,
          seq: schema.issueRunEvents.seq,
          eventType: schema.issueRunEvents.eventType,
          payload: schema.issueRunEvents.payload,
          createdAt: schema.issueRunEvents.createdAt,
        })
        .from(schema.issueRunEvents)
        .where(inArray(schema.issueRunEvents.runId, issueRunIds))
        .orderBy(desc(schema.issueRunEvents.createdAt), desc(schema.issueRunEvents.seq))
        .limit(200)
      : [];

    const eventsByIssueRun = new Map<string, typeof eventRows>();
    for (const event of eventRows) {
      const events = eventsByIssueRun.get(event.runId) ?? [];
      if (events.length < 10) events.push(event);
      eventsByIssueRun.set(event.runId, events);
    }

    const stepsByWorkflowRun = new Map<string, Array<typeof stepRows[number] & { events: typeof eventRows }>>();
    for (const step of stepRows) {
      const steps = stepsByWorkflowRun.get(step.workflowRunId) ?? [];
      steps.push({
        ...step,
        events: step.issueRunId
          ? [...(eventsByIssueRun.get(step.issueRunId) ?? [])].reverse()
          : [],
      });
      stepsByWorkflowRun.set(step.workflowRunId, steps);
    }

    res.json({
      ceremony,
      versions,
      runs: runRows.map((run) => ({
        ...run,
        steps: stepsByWorkflowRun.get(run.id) ?? [],
      })),
    });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /import-yaml — CER-3: upsert ceremony from canonical YAML
ceremoniesRouter.post('/import-yaml', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const { yaml } = req.body as { yaml?: string };

    if (typeof yaml !== 'string' || !yaml.trim()) {
      res.status(400).json({ error: '`yaml` field is required' });
      return;
    }

    // Verify project exists (access control: same pattern as neighbor endpoints)
    const db = getDb();
    const [project] = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .limit(1);

    if (!project) {
      res.status(403).json({ error: 'Project not found or access denied' });
      return;
    }

    let result: ImportResult;
    try {
      result = await importCeremonyFromYaml(yaml, projectId);
    } catch (parseErr) {
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      // Extract path from message: "Invalid workflow YAML at <path>: <msg>"
      const pathMatch = msg.match(/^Invalid workflow YAML at ([^:]+): (.+)$/);
      if (pathMatch) {
        res.status(400).json({
          error: { path: pathMatch[1], message: pathMatch[2] },
        });
      } else {
        res.status(400).json({ error: { path: '', message: msg } });
      }
      return;
    }

    res
      .status(200)
      .set('Cache-Control', 'no-cache, no-store, must-revalidate')
      .json(result);
  } catch (err) {
    handleError(res, err);
  }
});


// PATCH /:id — update metadata + (optionally) yaml. New yaml ⇒ new version.
ceremoniesRouter.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { projectId, id } = req.params as Record<string, string>;
    const body = req.body as {
      name?: string;
      description?: string | null;
      triggerKind?: string;
      triggerConfig?: Record<string, unknown>;
      kind?: string;
      yamlContent?: string;
    };

    if (body.triggerKind !== undefined && !isValidTriggerKind(body.triggerKind)) {
      res.status(400).json({ error: `triggerKind must be one of: ${VALID_TRIGGER_KINDS.join(', ')}` });
      return;
    }
    if (body.kind !== undefined && !isValidKind(body.kind)) {
      res.status(400).json({ error: `kind must be one of: ${VALID_KINDS.join(', ')}` });
      return;
    }

    const db = getDb();

    const [workflow] = await db
      .select()
      .from(schema.workflows)
      .where(and(eq(schema.workflows.id, id), eq(schema.workflows.projectId, projectId)))
      .limit(1);

    if (!workflow) {
      res.status(404).json({ error: 'Ceremony not found' });
      return;
    }

    let newVersion: typeof schema.workflowVersions.$inferSelect | null = null;

    if (body.yamlContent !== undefined) {
      // Narrative ceremonies store markdown verbatim — skip the YAML validator.
      const targetKind = body.kind ?? workflow.kind;
      const isNarrative = targetKind === 'narrative';

      let definition: Awaited<ReturnType<typeof parseWorkflowYaml>> | null = null;
      if (!isNarrative) {
        const { valid, errors } = validateWorkflowYaml(body.yamlContent);
        if (!valid) {
          res.status(422).json({ error: 'Invalid ceremony YAML', errors });
          return;
        }
        definition = await parseWorkflowYaml(body.yamlContent);
      }

      const existing = await db
        .select({ version: schema.workflowVersions.version })
        .from(schema.workflowVersions)
        .where(eq(schema.workflowVersions.workflowId, id));

      const nextVer = existing.length > 0 ? Math.max(...existing.map((v) => v.version)) + 1 : 1;

      await db
        .update(schema.workflowVersions)
        .set({ isActive: false })
        .where(
          and(
            eq(schema.workflowVersions.workflowId, id),
            eq(schema.workflowVersions.isActive, true),
          ),
        );

      const [created] = await db
        .insert(schema.workflowVersions)
        .values({
          workflowId: id,
          version: nextVer,
          yamlContent: body.yamlContent,
          jsonSchema: definition?.outputSchema ? JSON.stringify(definition.outputSchema) : null,
          isActive: true,
        })
        .returning();
      newVersion = created;

      // Auto-sync ceremony name/description from YAML when yaml is updated.
      if (definition) {
        if (body.name === undefined) body.name = definition.name;
        if (body.description === undefined && definition.description) {
          body.description = definition.description;
        }
      } else if (isNarrative && body.name === undefined) {
        const heading = extractFirstMarkdownHeading(body.yamlContent);
        if (heading) body.name = heading;
      }
    }

    const updates: Partial<typeof schema.workflows.$inferInsert> = { updatedAt: new Date() };
    if (body.name !== undefined) {
      updates.name = body.name;
      updates.slug = slugify(body.name);
    }
    if (body.description !== undefined) updates.description = body.description;
    if (body.triggerKind !== undefined) updates.triggerKind = body.triggerKind;
    if (body.triggerConfig !== undefined) updates.triggerConfig = body.triggerConfig;
    if (body.kind !== undefined) updates.kind = body.kind;

    const [updated] = await db
      .update(schema.workflows)
      .set(updates)
      .where(eq(schema.workflows.id, id))
      .returning();

    res.json({ ceremony: updated, version: newVersion });
  } catch (err) {
    handleError(res, err);
  }
});

// DELETE /:id — archive (deactivate all versions). Schedules cascade-deleted.
//
// Phase 11 protection: hard-delete is disallowed for active ceremonies (the
// review page's Discard button is the only call site that needs hard delete,
// and it only ever targets drafts). Pass `?force=true` to override and
// archive a non-draft row regardless of status.
ceremoniesRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { projectId, id } = req.params as Record<string, string>;
    const force = (req.query.force as string | undefined) === 'true';
    const db = getDb();

    const [workflow] = await db
      .select()
      .from(schema.workflows)
      .where(and(eq(schema.workflows.id, id), eq(schema.workflows.projectId, projectId)))
      .limit(1);

    if (!workflow) {
      res.status(404).json({ error: 'Ceremony not found' });
      return;
    }
    if (isProtectedBuiltInCeremony(workflow)) {
      res.status(409).json({
        error: `${workflow.name} is a required built-in ceremony and cannot be deleted or archived.`,
      });
      return;
    }

    // For draft ceremonies (typically auto-translated rows on the review page)
    // we hard-delete the row + its versions. For active rows we soft-archive
    // so the audit trail is preserved unless ?force=true is passed.
    if (workflow.status === 'draft' || force) {
      // Detach any other rows that reference this one as their narrative
      // source (parent_narrative_id ON DELETE SET NULL is enforced by the FK).
      await db.delete(schema.workflows).where(eq(schema.workflows.id, id));
      res.json({ message: 'Ceremony deleted', ceremonyId: id });
      return;
    }

    await db
      .update(schema.workflowVersions)
      .set({ isActive: false })
      .where(eq(schema.workflowVersions.workflowId, id));

    await db
      .update(schema.workflows)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(eq(schema.workflows.id, id));

    res.json({ message: 'Ceremony archived', ceremonyId: id });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /:id/run — ad-hoc spawn (Run-now button). Body may include
// { anchorIssueId?: string, context?: object }. The context is persisted in
// trigger_source so reusable manual ceremonies can receive selected-doc/source
// payloads without a ceremony-specific endpoint.
ceremoniesRouter.post('/:id/run', async (req: Request, res: Response) => {
  try {
    const { projectId, id } = req.params as Record<string, string>;
    const { anchorIssueId } = (req.body ?? {}) as { anchorIssueId?: string };
    const context = manualRunContext(req.body);
    const db = getDb();

    const [workflow] = await db
      .select()
      .from(schema.workflows)
      .where(and(eq(schema.workflows.id, id), eq(schema.workflows.projectId, projectId)))
      .limit(1);
    if (!workflow) {
      res.status(404).json({ error: 'Ceremony not found' });
      return;
    }

    const runId = await spawnCeremonyRun(id, {
      trigger: 'manual',
      anchorIssueId,
      triggerSource: {
        kind: 'manual',
        anchorIssueId,
        ...(context ? { context } : {}),
        detail: 'POST /ceremonies/:id/run',
      },
    });
    if (!runId) {
      res.status(409).json({
        error: 'Could not spawn ceremony run — no active version, no anchor issue, or kind=narrative',
      });
      return;
    }

    const [workflowRun] = await db
      .select({
        id: schema.workflowRuns.id,
        status: schema.workflowRuns.status,
        createdAt: schema.workflowRuns.createdAt,
        updatedAt: schema.workflowRuns.updatedAt,
      })
      .from(schema.workflowRuns)
      .where(eq(schema.workflowRuns.id, runId))
      .limit(1);

    res.status(201).json({
      workflowRunId: runId,
      message: 'Ceremony run started',
      lifecycle: buildRunLifecycleMetadata({
        workflowRun: workflowRun ?? { id: runId, status: 'pending', createdAt: new Date(), updatedAt: new Date() },
      }),
    });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /:id/preview-cron — body { cronExpr, timezone?, count? }
// Returns the next N fire times. Used by the rich editor.
ceremoniesRouter.post('/:id/preview-cron', (req: Request, res: Response) => {
  try {
    const { cronExpr, timezone, count } = req.body as {
      cronExpr?: string;
      timezone?: string;
      count?: number;
    };
    if (!cronExpr || typeof cronExpr !== 'string') {
      res.status(400).json({ error: '`cronExpr` is required' });
      return;
    }
    const n = Math.min(Math.max(typeof count === 'number' ? count : 3, 1), 10);
    const next = previewNextFireTimes(cronExpr, n, timezone ?? 'UTC');
    res.json({ cronExpr, timezone: timezone ?? 'UTC', next });
  } catch (err) {
    res
      .status(400)
      .json({ error: 'Invalid cron expression', details: err instanceof Error ? err.message : String(err) });
  }
});

// POST /:id/convert — Phase 11: translate the narrative source row into a
// draft executable ceremony. The narrative row is preserved (kind='narrative')
// and the new draft row links back via parent_narrative_id. Caller must
// activate the draft (PATCH or /activate) before triggers fire.
ceremoniesRouter.post('/:id/convert', async (req: Request, res: Response) => {
  try {
    const { projectId, id } = req.params as Record<string, string>;
    const result = await runTranslateForNarrative({ projectId, narrativeId: id });
    if (result.kind === 'error') {
      res.status(result.status).json(result.body);
      return;
    }
    res.status(201).json(result.body);
  } catch (err) {
    handleError(res, err);
  }
});

// POST /:id/activate — Phase 11: flip a draft ceremony to status='active'.
// From this moment its triggers (schedule / event / on_issue_entry) can fire.
ceremoniesRouter.post('/:id/activate', async (req: Request, res: Response) => {
  try {
    const { projectId, id } = req.params as Record<string, string>;
    const db = getDb();

    const [workflow] = await db
      .select()
      .from(schema.workflows)
      .where(and(eq(schema.workflows.id, id), eq(schema.workflows.projectId, projectId)))
      .limit(1);

    if (!workflow) {
      res.status(404).json({ error: 'Ceremony not found' });
      return;
    }
    if (workflow.kind === 'narrative') {
      res.status(409).json({
        error: "narrative ceremonies have no executable steps — convert first, then activate the draft",
      });
      return;
    }

    const [updated] = await db
      .update(schema.workflows)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(schema.workflows.id, id))
      .returning();

    res.json({ ceremony: updated, message: 'Ceremony activated' });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /:id/translate — Phase 11 retry hook. Re-runs the translator on the
// most recent narrative version. Honours an exponential-backoff between
// attempts persisted in last_translation_attempt_at:
//   1st retry: immediate · 2nd: ≥30s · 3rd+: ≥2min
ceremoniesRouter.post('/:id/translate', async (req: Request, res: Response) => {
  try {
    const { projectId, id } = req.params as Record<string, string>;
    const db = getDb();
    const [narrative] = await db
      .select()
      .from(schema.workflows)
      .where(and(eq(schema.workflows.id, id), eq(schema.workflows.projectId, projectId)))
      .limit(1);

    if (!narrative) {
      res.status(404).json({ error: 'Ceremony not found' });
      return;
    }
    if (narrative.kind !== 'narrative') {
      res.status(409).json({ error: '/translate can only be invoked on kind=narrative ceremonies' });
      return;
    }

    const backoffWaitMs = computeRetryBackoffMs(narrative.lastTranslationAttemptAt ?? null);
    if (backoffWaitMs > 0) {
      res.status(429).json({
        error: 'translator backoff in effect',
        retryAfterMs: backoffWaitMs,
      });
      return;
    }

    const result = await runTranslateForNarrative({ projectId, narrativeId: id });
    if (result.kind === 'error') {
      res.status(result.status).json(result.body);
      return;
    }
    res.status(201).json(result.body);
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// Phase 16 — author/refine ceremony from prose
// ---------------------------------------------------------------------------

/**
 * Resolve the project's agents into the shape the translator expects.
 * Returns an empty array if the project has no agents (the translator falls
 * back to "@role" mentions in that case).
 */
async function loadAvailableAgents(projectId: string): Promise<TranslatorAvailableAgent[]> {
  const db = getDb();
  const rows = await db
    .select({ name: schema.agents.name, role: schema.agents.role })
    .from(schema.agents)
    .where(eq(schema.agents.projectId, projectId));
  return rows.map((a) => ({ name: a.name, role: a.role }));
}

/**
 * GET /api/projects/:projectId/ceremonies/audit — CER-8
 *
 * Returns aggregated statistics and diagnostics for the project's ceremonies:
 *   - total count
 *   - byOrigin: count per origin value
 *   - byTrigger: count per triggerKind
 *   - byStatus: count per status
 *   - orphans: active ceremonies with zero runs in last 30 days
 *   - dead: active ceremonies whose trigger condition cannot currently fire
 *
 * "Orphans" = status='active' but no workflowRun in last 30 days.
 * "Dead"    = status='active' + triggerKind is github-event-based but the project
 *             has no GitHub integration configured (githubOwner/githubRepo null).
 */
async function getCeremonyAudit(req: Request, res: Response): Promise<void> {
  try {
    const { projectId } = req.params as Record<string, string>;
    const db = getDb();

    // Fetch all ceremonies for this project
    const ceremonies = await db
      .select()
      .from(schema.workflows)
      .where(eq(schema.workflows.projectId, projectId));

    // Fetch project for GitHub connectivity check
    const [project] = await db
      .select({
        githubOwner: schema.projects.githubOwner,
        githubRepo: schema.projects.githubRepo,
        githubSyncEnabled: schema.projects.githubSyncEnabled,
      })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .limit(1);

    const githubConnected = Boolean(
      project && project.githubSyncEnabled && project.githubOwner && project.githubRepo,
    );

    // Count runs per workflowId in last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const runCounts = await db
      .select({
        workflowId: schema.workflowVersions.workflowId,
        runCount: count(schema.workflowRuns.id),
      })
      .from(schema.workflowRuns)
      .innerJoin(
        schema.workflowVersions,
        eq(schema.workflowRuns.workflowVersionId, schema.workflowVersions.id),
      )
      .where(gte(schema.workflowRuns.createdAt, thirtyDaysAgo))
      .groupBy(schema.workflowVersions.workflowId);

    const runCountByWorkflow = new Map<string, number>(
      runCounts.map((r) => [r.workflowId, Number(r.runCount)]),
    );

    // Fetch active ceremony schedule info (for dead-detection of on_schedule ceremonies)
    const ceremonyIds = ceremonies.map((c) => c.id);
    const schedules = ceremonyIds.length > 0
      ? await db
          .select({ workflowId: schema.ceremonySchedules.workflowId, enabled: schema.ceremonySchedules.enabled })
          .from(schema.ceremonySchedules)
          .where(inArray(schema.ceremonySchedules.workflowId, ceremonyIds))
      : [];

    const enabledScheduleByWorkflow = new Map<string, boolean>();
    for (const sched of schedules) {
      const existing = enabledScheduleByWorkflow.get(sched.workflowId) ?? false;
      enabledScheduleByWorkflow.set(sched.workflowId, existing || sched.enabled);
    }

    // Accumulate aggregates
    const byOrigin: Record<CeremonyOrigin, number> = {
      'built-in': 0,
      'yaml-import': 0,
      'conjure-llm': 0,
      'user-created': 0,
    };
    const byTrigger: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const orphans: Array<{ id: string; name: string; reason: string }> = [];
    const dead: Array<{ id: string; name: string; reason: string }> = [];

    for (const ceremony of ceremonies) {
      // origin
      const origin = deriveOrigin({ parentNarrativeId: ceremony.parentNarrativeId });
      byOrigin[origin] = (byOrigin[origin] ?? 0) + 1;

      // trigger
      byTrigger[ceremony.triggerKind] = (byTrigger[ceremony.triggerKind] ?? 0) + 1;

      // status
      const status = ceremony.status ?? 'active';
      byStatus[status] = (byStatus[status] ?? 0) + 1;

      // orphan: active, no runs in 30 days
      if (status === 'active') {
        const runs = runCountByWorkflow.get(ceremony.id) ?? 0;
        if (runs === 0) {
          orphans.push({
            id: ceremony.id,
            name: ceremony.name,
            reason: 'No runs in the last 30 days',
          });
        }

        // dead: trigger condition cannot fire
        const triggerConfig = (ceremony.triggerConfig ?? {}) as Record<string, unknown>;
        const eventType = typeof triggerConfig.eventType === 'string' ? triggerConfig.eventType : '';
        const isGithubTrigger =
          ceremony.triggerKind === 'on_event' &&
          (eventType.startsWith('github.') || eventType.startsWith('gh.'));
        if (isGithubTrigger && !githubConnected) {
          dead.push({
            id: ceremony.id,
            name: ceremony.name,
            reason:
              'Trigger requires GitHub integration, but no GitHub repo is connected to this project',
          });
        }

        const isScheduleTrigger = ceremony.triggerKind === 'on_schedule';
        if (isScheduleTrigger && !enabledScheduleByWorkflow.get(ceremony.id)) {
          dead.push({
            id: ceremony.id,
            name: ceremony.name,
            reason: 'Scheduled ceremony has no enabled schedule (trigger cannot fire)',
          });
        }
      }
    }

    res.json({
      total: ceremonies.length,
      byOrigin,
      byTrigger,
      byStatus,
      orphans,
      dead,
    });
  } catch (err) {
    handleError(res, err);
  }
}

/**
 * POST /api/projects/:projectId/ceremonies/invoke
 *
 * Body: { ceremonySlug: string, context?: object }
 *
 * Invokes a built-in ceremony for the given project.
 * Close-out ceremonies are intentionally excluded from this ad-hoc surface:
 * they run from daemon/coordinator lifecycle paths.
 *
 * Returns: { ok: true, result: <ceremony result object> }
 */
ceremoniesRouter.post('/invoke', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const { ceremonySlug, context } = (req.body ?? {}) as {
      ceremonySlug?: string;
      context?: Record<string, unknown>;
    };

    if (typeof ceremonySlug !== 'string' || !ceremonySlug.trim()) {
      res.status(400).json({ error: '`ceremonySlug` is required' });
      return;
    }

    const slug = ceremonySlug.trim();
    if (slug === 'scribe-close-out') {
      res.status(403).json({
        error: 'Scribe close-out is automatic; use daemon or coordinator lifecycle triggers.',
      });
      return;
    }

    let result: Record<string, unknown>;
    try {
      result = await invokeBuiltInCeremony(slug, {
        projectId,
        ...(context ?? {}),
        extra: { ...(context ?? {}), caller: 'api-invoke' },
      });
    } catch (err) {
      if (err instanceof TranslatorError) {
        res.status(err.retryable ? 502 : 400).json({ error: err.message });
        return;
      }
      throw err;
    }

    res.json({ ok: true, result });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * POST /api/projects/:projectId/ceremonies/generate-from-prose
 *
 * Body: { prose: string, ceremonyName?: string }
 *
 * Returns: { yamlContent, triggerKind, triggerConfig, rationale, warnings }
 *
 * Used by the Phase 16 Prose tab "Generate" button. The endpoint never
 * persists anything — the client previews the YAML and then either accepts
 * (which triggers the existing PATCH or POST flow) or discards it.
 */
ceremoniesRouter.post('/generate-from-prose', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const { prose, ceremonyName } = (req.body ?? {}) as {
      prose?: string;
      ceremonyName?: string;
    };
    if (typeof prose !== 'string' || !prose.trim()) {
      res.status(400).json({ error: '`prose` is required' });
      return;
    }

    const availableAgents = await loadAvailableAgents(projectId);

    let result;
    try {
      result = await translateProse({
        prose,
        projectId,
        ceremonyName: typeof ceremonyName === 'string' ? ceremonyName : undefined,
        availableAgents,
      });
    } catch (err) {
      if (err instanceof TranslatorThrottledError) {
        res.status(429).json({ error: err.message, retryable: false });
        return;
      }
      if (err instanceof TranslatorError) {
        res.status(502).json({ error: err.message, retryable: err.retryable });
        return;
      }
      throw err;
    }

    res.json({
      yamlContent: result.yamlContent,
      triggerKind: result.triggerKind,
      triggerConfig: result.triggerConfig,
      rationale: result.rationale,
      warnings: result.warnings,
    });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * POST /api/projects/:projectId/ceremonies/:id/refine-with-prose
 *
 * Body: { instruction: string, currentYaml: string }
 *
 * Returns: { yamlContent, triggerKind, triggerConfig, rationale,
 *            diffSummary, warnings }
 *
 * Used by the Phase 16 Prose tab "Refine" panel. As with generate-from-prose
 * the endpoint never persists — the client shows a side-by-side diff and
 * either accepts (PATCH the ceremony) or discards.
 */
ceremoniesRouter.post('/:id/refine-with-prose', async (req: Request, res: Response) => {
  try {
    const { projectId, id } = req.params as Record<string, string>;
    const { instruction, currentYaml } = (req.body ?? {}) as {
      instruction?: string;
      currentYaml?: string;
    };
    if (typeof instruction !== 'string' || !instruction.trim()) {
      res.status(400).json({ error: '`instruction` is required' });
      return;
    }
    if (typeof currentYaml !== 'string' || !currentYaml.trim()) {
      res.status(400).json({ error: '`currentYaml` is required' });
      return;
    }

    const availableAgents = await loadAvailableAgents(projectId);

    let result;
    try {
      result = await refineProse({
        instruction,
        currentYaml,
        projectId,
        ceremonyKey: id,
        availableAgents,
      });
    } catch (err) {
      if (err instanceof TranslatorThrottledError) {
        res.status(429).json({ error: err.message, retryable: false });
        return;
      }
      if (err instanceof TranslatorError) {
        res.status(502).json({ error: err.message, retryable: err.retryable });
        return;
      }
      throw err;
    }

    res.json({
      yamlContent: result.yamlContent,
      triggerKind: result.triggerKind,
      triggerConfig: result.triggerConfig,
      rationale: result.rationale,
      diffSummary: result.diffSummary,
      warnings: result.warnings,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// Schedule CRUD — /:id/schedules
// ---------------------------------------------------------------------------

ceremoniesRouter.get('/:id/schedules', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as Record<string, string>;
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.ceremonySchedules)
      .where(eq(schema.ceremonySchedules.workflowId, id));
    res.json(rows);
  } catch (err) {
    handleError(res, err);
  }
});

ceremoniesRouter.post('/:id/schedules', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as Record<string, string>;
    const { cronExpr, timezone, enabled } = req.body as {
      cronExpr?: string;
      timezone?: string;
      enabled?: boolean;
    };
    if (!cronExpr || typeof cronExpr !== 'string') {
      res.status(400).json({ error: '`cronExpr` is required' });
      return;
    }
    const tz = typeof timezone === 'string' && timezone.length > 0 ? timezone : 'UTC';
    let nextFire: Date;
    try {
      nextFire = computeNextFire(cronExpr, tz);
    } catch (err) {
      res.status(400).json({
        error: 'Invalid cron expression',
        details: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const db = getDb();
    const [row] = await db
      .insert(schema.ceremonySchedules)
      .values({
        workflowId: id,
        cronExpr,
        timezone: tz,
        nextFireAt: nextFire,
        enabled: enabled ?? true,
      })
      .returning();

    res.status(201).json(row);
  } catch (err) {
    handleError(res, err);
  }
});

ceremoniesRouter.patch('/:id/schedules/:sId', async (req: Request, res: Response) => {
  try {
    const { sId } = req.params as Record<string, string>;
    const body = req.body as {
      cronExpr?: string;
      timezone?: string;
      enabled?: boolean;
    };

    const db = getDb();
    const [existing] = await db
      .select()
      .from(schema.ceremonySchedules)
      .where(eq(schema.ceremonySchedules.id, sId))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: 'Schedule not found' });
      return;
    }

    const updates: Partial<typeof schema.ceremonySchedules.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (body.timezone !== undefined) updates.timezone = body.timezone;
    if (body.enabled !== undefined) updates.enabled = body.enabled;
    if (body.cronExpr !== undefined) {
      try {
        updates.nextFireAt = computeNextFire(
          body.cronExpr,
          body.timezone ?? existing.timezone ?? 'UTC',
        );
      } catch (err) {
        res.status(400).json({
          error: 'Invalid cron expression',
          details: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      updates.cronExpr = body.cronExpr;
    }

    const [updated] = await db
      .update(schema.ceremonySchedules)
      .set(updates)
      .where(eq(schema.ceremonySchedules.id, sId))
      .returning();

    res.json(updated);
  } catch (err) {
    handleError(res, err);
  }
});

ceremoniesRouter.delete('/:id/schedules/:sId', async (req: Request, res: Response) => {
  try {
    const { sId } = req.params as Record<string, string>;
    const db = getDb();
    await db
      .delete(schema.ceremonySchedules)
      .where(eq(schema.ceremonySchedules.id, sId));
    res.json({ message: 'Schedule deleted', scheduleId: sId });
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// Phase 11 helpers — narrative translation
// ---------------------------------------------------------------------------

/**
 * Compute the minimum delay (ms) callers must wait between translation
 * attempts on the same narrative. Returns 0 when the call is allowed.
 *
 *   - 1st attempt (no previous attempt) ........... 0 ms
 *   - 2nd attempt (≤30s after previous) ......... 30s
 *   - 3rd+ attempt (≤2min after previous) ..... 120s
 *
 * This is a best-effort check; the in-memory throttle inside the translator
 * service is the hard ceiling.
 */
export function computeRetryBackoffMs(lastAttemptAt: Date | string | null): number {
  if (!lastAttemptAt) return 0;
  const last = typeof lastAttemptAt === 'string' ? new Date(lastAttemptAt) : lastAttemptAt;
  const elapsed = Date.now() - last.getTime();
  if (elapsed >= 120_000) return 0;
  if (elapsed >= 30_000) return 0;
  return Math.max(0, 30_000 - elapsed);
}

interface TranslateOk {
  kind: 'ok';
  body: {
    narrativeId: string;
    draftCeremonyId: string;
    yamlContent: string;
    triggerKind: TriggerKind;
    triggerConfig: Record<string, unknown>;
    rationale: string;
    warnings: string[];
  };
}

interface TranslateFail {
  kind: 'error';
  status: number;
  body: { narrativeId?: string; error: string; retryable: boolean };
}

/**
 * Translate the narrative ceremony at `narrativeId` and persist the resulting
 * draft executable ceremony. On failure, the narrative row is marked with
 * `lastTranslationError` and `lastTranslationAttemptAt`.
 *
 * Used by /:id/convert, /:id/translate, /import-narrative, and the starter
 * project materialiser.
 */
export async function runTranslateForNarrative(opts: {
  projectId: string;
  narrativeId: string;
}): Promise<TranslateOk | TranslateFail> {
  const { projectId, narrativeId } = opts;
  const db = getDb();

  const [narrative] = await db
    .select()
    .from(schema.workflows)
    .where(and(eq(schema.workflows.id, narrativeId), eq(schema.workflows.projectId, projectId)))
    .limit(1);

  if (!narrative) {
    return { kind: 'error', status: 404, body: { error: 'Ceremony not found', retryable: false } };
  }
  if (narrative.kind !== 'narrative') {
    return {
      kind: 'error',
      status: 409,
      body: {
        narrativeId,
        error: 'convert can only be invoked on kind=narrative ceremonies',
        retryable: false,
      },
    };
  }

  // Pull the narrative markdown from the latest version row. Narrative rows
  // store their markdown verbatim in `yamlContent` (the column is reused).
  const versions = await db
    .select()
    .from(schema.workflowVersions)
    .where(eq(schema.workflowVersions.workflowId, narrativeId));

  const latest = versions.find((v) => v.isActive) ?? versions.sort((a, b) => b.version - a.version)[0];
  if (!latest || !latest.yamlContent || !latest.yamlContent.trim()) {
    return {
      kind: 'error',
      status: 422,
      body: {
        narrativeId,
        error: 'narrative has no markdown content to translate',
        retryable: false,
      },
    };
  }

  // Resolve the project's agents so the translator picks valid names.
  const agentRows = await db
    .select({ name: schema.agents.name, role: schema.agents.role })
    .from(schema.agents)
    .where(eq(schema.agents.projectId, projectId));
  const availableAgents: TranslatorAvailableAgent[] = agentRows.map((a) => ({
    name: a.name,
    role: a.role,
  }));

  // Mark the attempt timestamp before invoking — even on failure we want the
  // backoff window to start from "now".
  await db
    .update(schema.workflows)
    .set({ lastTranslationAttemptAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.workflows.id, narrativeId));

  let translation;
  try {
    translation = await translateNarrative({
      narrativeMarkdown: latest.yamlContent,
      ceremonyName: narrative.name,
      projectId,
      availableAgents,
    });
  } catch (err) {
    const retryable = err instanceof TranslatorError ? err.retryable : true;
    const status = err instanceof TranslatorThrottledError ? 429 : 502;
    const message = err instanceof Error ? err.message : String(err);

    await db
      .update(schema.workflows)
      .set({ lastTranslationError: message, updatedAt: new Date() })
      .where(eq(schema.workflows.id, narrativeId));

    return {
      kind: 'error',
      status,
      body: { narrativeId, error: message, retryable },
    };
  }

  // Translation succeeded — clear any prior error.
  await db
    .update(schema.workflows)
    .set({ lastTranslationError: null, updatedAt: new Date() })
    .where(eq(schema.workflows.id, narrativeId));

  // Persist the draft executable ceremony.
  const definition = await parseWorkflowYaml(translation.yamlContent);
  const slug = slugify(definition.name || `${narrative.slug}-executable`);

  const [draft] = await db
    .insert(schema.workflows)
    .values({
      projectId,
      name: definition.name || `${narrative.name} (executable)`,
      slug,
      description: definition.description ?? narrative.description ?? null,
      triggerKind: translation.triggerKind,
      triggerConfig: translation.triggerConfig,
      kind: 'ceremony',
      status: 'draft',
      parentNarrativeId: narrative.id,
    })
    .returning();

  await db
    .insert(schema.workflowVersions)
    .values({
      workflowId: draft.id,
      version: 1,
      yamlContent: translation.yamlContent,
      jsonSchema: definition.outputSchema ? JSON.stringify(definition.outputSchema) : null,
      isActive: true,
    });

  return {
    kind: 'ok',
    body: {
      narrativeId: narrative.id,
      draftCeremonyId: draft.id,
      yamlContent: translation.yamlContent,
      triggerKind: translation.triggerKind,
      triggerConfig: translation.triggerConfig,
      rationale: translation.rationale,
      warnings: translation.warnings,
    },
  };
}

// ---------------------------------------------------------------------------
// Top-level /api/ceremonies router (templates, validate)
// ---------------------------------------------------------------------------

export const ceremoniesTopRouter = Router();

ceremoniesTopRouter.get('/templates', (_req: Request, res: Response) => {
  try {
    res.json({ ok: true, data: getBuiltinTemplates() });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

ceremoniesTopRouter.post('/validate', (req: Request, res: Response) => {
  const { yamlContent } = req.body as { yamlContent?: string };
  if (typeof yamlContent !== 'string') {
    res.status(400).json({ valid: false, errors: ['`yamlContent` is required'] });
    return;
  }
  const result = validateWorkflowYaml(yamlContent);
  res.json(result);
});

/**
 * POST /api/ceremonies/import-narrative
 *
 * One-call import: takes a markdown ceremony definition, creates the
 * kind='narrative' parent row + initial version, and immediately runs the
 * translator to produce a draft executable ceremony.
 *
 * Body: { projectId, name, markdown, description? }
 *
 * Response shape:
 *   On success ............ { narrativeId, draftCeremonyId, yamlContent,
 *                             triggerKind, triggerConfig, rationale, warnings }
 *   On translate failure .. { narrativeId, error, retryable }
 *                            (status 200 — the narrative WAS created; only
 *                             the translation failed and can be retried via
 *                             /api/projects/:projectId/ceremonies/:id/translate)
 */
ceremoniesTopRouter.post('/import-narrative', async (req: Request, res: Response) => {
  const body = req.body as {
    projectId?: string;
    name?: string;
    markdown?: string;
    description?: string | null;
  };
  const { projectId, name, markdown, description } = body;

  if (typeof projectId !== 'string' || !projectId.trim()) {
    res.status(400).json({ error: '`projectId` is required' });
    return;
  }
  if (typeof markdown !== 'string' || !markdown.trim()) {
    res.status(400).json({ error: '`markdown` is required' });
    return;
  }

  const finalName =
    typeof name === 'string' && name.trim()
      ? name.trim()
      : (extractFirstMarkdownHeading(markdown) ?? 'Imported ceremony');

  try {
    const db = getDb();

    const slug = slugify(finalName);
    const [narrative] = await db
      .insert(schema.workflows)
      .values({
        projectId,
        name: finalName,
        slug,
        description: typeof description === 'string' ? description : null,
        triggerKind: 'manual',
        triggerConfig: {},
        kind: 'narrative',
        status: 'draft',
      })
      .returning();

    await db.insert(schema.workflowVersions).values({
      workflowId: narrative.id,
      version: 1,
      yamlContent: markdown,
      isActive: true,
    });

    const result = await runTranslateForNarrative({ projectId, narrativeId: narrative.id });

    if (result.kind === 'ok') {
      res.json(result.body);
      return;
    }

    // The narrative was successfully created; only the translation failed.
    // Return 200 so the caller can decide whether to retry — the resource
    // exists and is addressable via /api/projects/:projectId/ceremonies/:id.
    res.status(200).json({
      narrativeId: narrative.id,
      error: result.body.error,
      retryable: result.body.retryable,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// Re-export sql for unused-import suppression in TS strict mode
void sql;

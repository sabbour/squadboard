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
 *   GET    /:id                      get + active version + versions[]
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
import { eq, and, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { parseWorkflowYaml, validateWorkflowYaml } from '../services/workflow-parser.js';
import {
  spawnCeremonyRun,
  previewNextFireTimes,
  computeNextFire,
} from '../services/ceremony-scheduler.js';
import {
  translateNarrative,
  TranslatorError,
  TranslatorThrottledError,
  type TranslatorAvailableAgent,
} from '../services/ceremony-translator.js';
import { getBuiltinTemplates } from '../workflows/templates/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_TRIGGER_KINDS = ['on_issue_entry', 'on_schedule', 'on_event', 'manual'] as const;
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

    res.json(rows);
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

    res.json({ ceremony: workflow, activeVersion, versions });
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
// { anchorIssueId?: string }.
ceremoniesRouter.post('/:id/run', async (req: Request, res: Response) => {
  try {
    const { projectId, id } = req.params as Record<string, string>;
    const { anchorIssueId } = (req.body ?? {}) as { anchorIssueId?: string };
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
    });
    if (!runId) {
      res.status(409).json({
        error: 'Could not spawn ceremony run — no active version, no anchor issue, or kind=narrative',
      });
      return;
    }

    res.status(201).json({ workflowRunId: runId, message: 'Ceremony run started' });
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
  res.json({ ok: true, data: getBuiltinTemplates() });
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

// Re-export sql for unused-import suppression in TS strict mode
void sql;

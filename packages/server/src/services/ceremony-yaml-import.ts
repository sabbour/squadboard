/**
 * ceremony-yaml-import.ts — CER-3: Import a canonical YAML string as a
 * ceremony DB row (upsert by metadata.name + projectId).
 *
 * Integration with ceremony-origin.ts (CER-1):
 *   The DB workflows table has no sourceYamlPath column (schema unchanged).
 *   We signal yaml-import provenance by storing `sourceYamlPath` inside the
 *   `triggerConfig` JSON column. When the route or any consumer calls
 *   `deriveOrigin`, they pass `sourceYamlPath: row.triggerConfig?.sourceYamlPath`
 *   so that `deriveOrigin` correctly returns 'yaml-import'.
 *
 *   Example:
 *     triggerConfig = { event: 'pull_request', sourceYamlPath: 'import:design-review' }
 *
 * Field-name mappings (YAML -> DB):
 *   metadata.name        -> slug   (canonical kebab identifier)
 *   metadata.displayName -> name   (user-facing, falls back to metadata.name)
 *   metadata.description -> description
 *   spec.trigger.type    -> triggerKind  (see mapYamlTriggerToDb)
 *   spec.trigger.*       -> triggerConfig
 *   spec.steps           -> stored in workflowVersions.yamlContent (re-emitted)
 */

import { eq, and } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { parseWorkflowYaml, stringifyWorkflowYaml } from '../ceremonies/yaml-canonicalize.js';
import type { WorkflowTrigger } from '../ceremonies/types.js';
import { builtInSourceMarker, isProtectedBuiltInCeremony } from '../ceremonies/built-in/protection.js';

export interface ImportResult {
  ceremonyId: string;
  created: boolean;
}

export interface ImportCeremonyOptions {
  sourceMarker?: string;
}

function normalizedTags(tags: readonly string[] | undefined): string[] {
  if (!tags) return [];
  return tags.map((tag) => tag.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Trigger mapping: YAML trigger.type -> DB triggerKind + triggerConfig
// ---------------------------------------------------------------------------

function mapYamlTriggerToDb(
  trigger: WorkflowTrigger,
  sourceMarker: string,
): { triggerKind: string; triggerConfig: Record<string, unknown> } {
  const base: Record<string, unknown> = {
    // Persist sourceYamlPath so ceremony-origin.ts deriveOrigin() returns 'yaml-import'
    sourceYamlPath: sourceMarker,
  };

  switch (trigger.type) {
    case 'github-event':
      return {
        triggerKind: 'on_event',
        triggerConfig: {
          ...base,
          event: trigger.event,
          ...(trigger.filters ? { filters: trigger.filters } : {}),
        },
      };

    case 'cron':
      return {
        triggerKind: 'on_schedule',
        triggerConfig: { ...base, schedule: trigger.schedule },
      };

    case 'manual':
      return { triggerKind: 'manual', triggerConfig: { ...base } };

    case 'agent-signal':
      // CER-6 (W29): Use 'agent-signal' triggerKind and store signalName in config
      // so ceremony-signal-emitter.ts can query by signalName.
      return {
        triggerKind: 'agent-signal',
        triggerConfig: {
          ...base,
          ...(trigger.signalName ? { signalName: trigger.signalName } : {}),
        },
      };
    default:
      return { triggerKind: 'on_issue_entry', triggerConfig: { ...base } };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse and validate `yamlText`, then upsert a ceremony row by
 * `metadata.name` (slug) + `projectId`.
 *
 * - If no matching row exists -> INSERT + workflowVersions row, created=true
 * - If a matching row exists   -> UPDATE + new version row, created=false
 *
 * Throws on invalid YAML (parse or Zod validation errors).
 */
export async function importCeremonyFromYaml(
  yamlText: string,
  projectId: string,
  options: ImportCeremonyOptions = {},
): Promise<ImportResult> {
  // 1. Parse + validate (throws on invalid)
  const workflow = parseWorkflowYaml(yamlText);

  const slug = workflow.metadata.name;
  const displayName = workflow.metadata.displayName ?? workflow.metadata.name;
  const description = workflow.metadata.description ?? null;
  const tags = normalizedTags(workflow.metadata.tags);
  const category = workflow.metadata.category?.trim();

  // Source marker stored in triggerConfig so origin derivation sees 'yaml-import'
  const sourceMarker = options.sourceMarker ?? `import:${slug}`;
  const { triggerKind, triggerConfig: triggerConfigBase } = mapYamlTriggerToDb(workflow.spec.trigger, sourceMarker);
  const triggerConfig = {
    ...triggerConfigBase,
    ...(category ? { category } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };

  // Canonical YAML string for storage (normalised round-trip)
  const canonicalYaml = stringifyWorkflowYaml(workflow);

  const db = getDb();

  // 2. Upsert — find existing row by slug + projectId
  const [existing] = await db
    .select()
    .from(schema.workflows)
    .where(and(eq(schema.workflows.slug, slug), eq(schema.workflows.projectId, projectId)))
    .limit(1);

  if (existing) {
    if (isProtectedBuiltInCeremony(existing) && sourceMarker !== builtInSourceMarker(slug)) {
      const err = new Error(`"${slug}" is a required built-in ceremony and cannot be replaced by an import`);
      (err as Error & { status?: number }).status = 409;
      throw err;
    }
    // UPDATE existing ceremony
    await db
      .update(schema.workflows)
      .set({
        name: displayName,
        description,
        triggerKind,
        triggerConfig,
        updatedAt: new Date(),
      })
      .where(eq(schema.workflows.id, existing.id));

    // Deactivate all prior versions, then add a new active one
    await db
      .update(schema.workflowVersions)
      .set({ isActive: false })
      .where(eq(schema.workflowVersions.workflowId, existing.id));

    const existingVersions = await db
      .select({ version: schema.workflowVersions.version })
      .from(schema.workflowVersions)
      .where(eq(schema.workflowVersions.workflowId, existing.id));

    const nextVersion = existingVersions.length + 1;

    await db.insert(schema.workflowVersions).values({
      workflowId: existing.id,
      version: nextVersion,
      yamlContent: canonicalYaml,
      isActive: true,
    });

    return { ceremonyId: existing.id, created: false };
  }

  // INSERT new ceremony
  const [inserted] = await db
    .insert(schema.workflows)
    .values({
      projectId,
      name: displayName,
      slug,
      description,
      triggerKind,
      triggerConfig,
      kind: 'ceremony',
      status: 'active',
    })
    .returning();

  await db.insert(schema.workflowVersions).values({
    workflowId: inserted.id,
    version: 1,
    yamlContent: canonicalYaml,
    isActive: true,
  });

  return { ceremonyId: inserted.id, created: true };
}

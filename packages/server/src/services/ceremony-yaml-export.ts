/**
 * ceremony-yaml-export.ts — CER-3: Export a ceremony DB row as canonical YAML.
 *
 * Maps the `workflows` table row -> WorkflowYaml shape.
 *
 * Field-name mappings (DB -> YAML):
 *   workflows.slug          -> metadata.name   (canonical kebab-case id)
 *   workflows.name          -> metadata.displayName
 *   workflows.description   -> metadata.description
 *   workflows.triggerKind   -> spec.trigger.type  (see mapTriggerKind)
 *   workflows.triggerConfig -> spec.trigger.{event,filters,schedule,...}
 *   workflowVersions.yamlContent parsed for steps array
 *
 * Derived/excluded fields: id, createdAt, updatedAt, origin, parentNarrativeId,
 * lastTranslationError, lastTranslationAttemptAt, projectId, status.
 */

import { eq, and } from 'drizzle-orm';
import { parseDocument } from 'yaml';
import { getDb, schema } from '../db/index.js';
import { stringifyWorkflowYaml } from '../ceremonies/yaml-canonicalize.js';
import type { WorkflowYaml, WorkflowTrigger } from '../ceremonies/types.js';

export type CeremonyRow = typeof schema.workflows.$inferSelect;

// ---------------------------------------------------------------------------
// triggerKind mapping: DB enum -> YAML trigger type
// ---------------------------------------------------------------------------

/**
 * Map from the DB triggerKind vocabulary to the YAML canonical trigger type.
 *
 *   DB triggerKind      -> YAML trigger.type
 *   'on_issue_entry'    -> 'agent-signal'
 *   'on_schedule'       -> 'cron'
 *   'on_event'          -> 'github-event'
 *   'manual'            -> 'manual'
 */
function mapTriggerKind(
  triggerKind: string,
  triggerConfig: Record<string, unknown>,
): WorkflowTrigger {
  switch (triggerKind) {
    case 'on_event':
    case 'github-event': {
      const event = (triggerConfig.event as string | undefined) ?? 'push';
      const filters = triggerConfig.filters as
        | { labels?: string[]; paths?: string[] }
        | undefined;
      return {
        type: 'github-event',
        event,
        ...(filters ? { filters } : {}),
      };
    }

    case 'on_schedule':
    case 'cron': {
      const schedule =
        (triggerConfig.schedule as string | undefined) ??
        (triggerConfig.cronExpr as string | undefined) ??
        '0 9 * * 1';
      return { type: 'cron', schedule };
    }

    case 'manual':
      return { type: 'manual' };

    case 'on_issue_entry':
    case 'agent-signal':
    default:
      return { type: 'agent-signal' };
  }
}

// ---------------------------------------------------------------------------
// Step extraction from existing yamlContent (best-effort)
// ---------------------------------------------------------------------------

function extractSteps(
  yamlContent: string | null | undefined,
): Array<{ id: string; kind: string; [key: string]: unknown }> {
  if (!yamlContent) return [];
  try {
    const parsed = parseDocument(yamlContent).toJSON() as Record<string, unknown>;
    const steps = parsed?.steps as unknown[] | undefined;
    if (Array.isArray(steps)) {
      return steps.filter(
        (s): s is { id: string; kind: string; [key: string]: unknown } =>
          typeof s === 'object' && s !== null && 'id' in s && 'kind' in s,
      );
    }
  } catch {
    // non-parseable yamlContent (e.g. markdown narratives) -> empty steps
  }
  return [];
}

// ---------------------------------------------------------------------------
// Core mapping function
// ---------------------------------------------------------------------------

/**
 * Map a DB ceremony row (+ optional active version yamlContent) to WorkflowYaml.
 *
 * `activeVersionYaml` is the text stored in workflowVersions.yamlContent for
 * the active version; it is used to extract the steps array if present.
 */
export function ceremonyRowToWorkflowYaml(
  row: CeremonyRow,
  activeVersionYaml?: string | null,
): WorkflowYaml {
  const triggerConfig = (row.triggerConfig ?? {}) as Record<string, unknown>;
  const trigger = mapTriggerKind(row.triggerKind, triggerConfig);
  const steps = extractSteps(activeVersionYaml);

  return {
    apiVersion: 'squad.io/v1',
    kind: 'Ceremony',
    metadata: {
      name: row.slug,
      displayName: row.name,
      ...(row.description ? { description: row.description } : {}),
    },
    spec: {
      trigger,
      steps,
    },
  };
}

// ---------------------------------------------------------------------------
// Async export (DB-aware)
// ---------------------------------------------------------------------------

/**
 * Export a ceremony as a canonical YAML string.
 * Throws with a 404-style error if the ceremony is not found.
 */
export async function exportCeremonyAsYaml(ceremonyId: string): Promise<string> {
  const db = getDb();

  const [row] = await db
    .select()
    .from(schema.workflows)
    .where(eq(schema.workflows.id, ceremonyId))
    .limit(1);

  if (!row) {
    const err = new Error(`Ceremony not found: ${ceremonyId}`);
    (err as Error & { status?: number }).status = 404;
    throw err;
  }

  const versionRows = await db
    .select()
    .from(schema.workflowVersions)
    .where(
      and(
        eq(schema.workflowVersions.workflowId, ceremonyId),
        eq(schema.workflowVersions.isActive, true),
      ),
    )
    .limit(1);

  const activeVersionYaml = versionRows[0]?.yamlContent ?? null;
  const workflowYaml = ceremonyRowToWorkflowYaml(row, activeVersionYaml);
  return stringifyWorkflowYaml(workflowYaml);
}

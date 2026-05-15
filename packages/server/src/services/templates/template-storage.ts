/**
 * template-storage.ts — Stream D / D7
 *
 * Mirrors saved templates to the project's `.squad/squadboard/templates/{kind}/`
 * directory in addition to the `templates` table. The DB row is the source of
 * truth (it owns id, foreign keys, instantiation), but this on-disk mirror lets
 * users:
 *   - browse their template inventory in their own filesystem
 *   - share templates by copying a JSON file into another project's .squad/
 *   - back templates up via the same git/Time Machine workflow they already
 *     use for charters and agents
 *
 * The mirror is a best-effort write. Failure logs a warning but does NOT fail
 * the save — the DB row still exists and the template is still usable.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { getDb, schema } from '../../db/index.js';
import { eq } from 'drizzle-orm';
import { resolveSquadDir } from '../diagnostics.js';

export type TemplateKind = 'project' | 'team' | 'workflow';

export interface TemplateMirrorResult {
  /** Absolute path the JSON was written to, or null when the mirror failed. */
  storagePath: string | null;
  /** Reason the write was skipped or failed (null on success). */
  error: string | null;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'untitled';
}

/**
 * Write a template payload to `.squad/squadboard/templates/{kind}/{slug}.json`.
 *
 * @param projectId The project the template was saved against. The squad
 *                  directory of this project hosts the mirror.
 * @param kind      The template kind (controls the subdirectory).
 * @param payload   The full template payload to serialize.
 * @param meta      `{ id, name, description? }` — id appears in the JSON envelope,
 *                  name is slugified to derive the filename.
 */
export async function writeTemplateMirror(
  projectId: string,
  kind: TemplateKind,
  payload: unknown,
  meta: { id: string; name: string; description?: string | null },
): Promise<TemplateMirrorResult> {
  try {
    const db = getDb();
    const [project] = await db
      .select({ path: schema.projects.path })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .limit(1);

    if (!project?.path) {
      return { storagePath: null, error: `project ${projectId} has no path` };
    }

    const resolved = await resolveSquadDir(project.path);
    if (!resolved.ok) {
      return { storagePath: null, error: resolved.reason };
    }

    const targetDir = resolve(resolved.squadDir, 'squadboard', 'templates', kind);
    await mkdir(targetDir, { recursive: true });

    const filename = `${slugify(meta.name)}.json`;
    const target = resolve(targetDir, filename);

    const envelope = {
      kind,
      id: meta.id,
      name: meta.name,
      description: meta.description ?? null,
      projectId,
      savedAt: new Date().toISOString(),
      payload,
    };
    await writeFile(target, JSON.stringify(envelope, null, 2), 'utf8');

    return { storagePath: target, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[template-storage] mirror write failed for ${kind} template ${meta.id}: ${message}`,
    );
    return { storagePath: null, error: message };
  }
}

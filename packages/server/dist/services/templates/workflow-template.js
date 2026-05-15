/**
 * workflow-template.ts — Phase 19 workflow portability helpers
 *
 * exportWorkflow   : pull yamlContent from a ceremony row
 * importWorkflow   : create a new ceremony + active version from yamlContent
 * saveAsTemplate   : write a templates row (kind='workflow')
 * instantiateTemplate : fetch a template and delegate to importWorkflow
 *
 * All writes use pg transactions so they are all-or-nothing.
 */
import { eq, desc } from 'drizzle-orm';
import { getDb, getPool, schema } from '../../db/index.js';
import { writeTemplateMirror } from './template-storage.js';
// ---------------------------------------------------------------------------
// exportWorkflow
// ---------------------------------------------------------------------------
/**
 * Return the active YAML content for a ceremony (workflows table row).
 * Resolves the latest isActive version; falls back to latest by version number.
 */
export async function exportWorkflow(ceremonyId) {
    const db = getDb();
    const [ceremony] = await db
        .select()
        .from(schema.workflows)
        .where(eq(schema.workflows.id, ceremonyId))
        .limit(1);
    if (!ceremony)
        throw new Error(`Ceremony not found: ${ceremonyId}`);
    const versions = await db
        .select()
        .from(schema.workflowVersions)
        .where(eq(schema.workflowVersions.workflowId, ceremonyId))
        .orderBy(desc(schema.workflowVersions.version));
    const active = versions.find((v) => v.isActive) ?? versions[0];
    if (!active)
        throw new Error(`No versions found for ceremony: ${ceremonyId}`);
    return {
        name: ceremony.name,
        slug: ceremony.slug,
        description: ceremony.description ?? null,
        triggerKind: ceremony.triggerKind,
        triggerConfig: ceremony.triggerConfig,
        kind: ceremony.kind,
        yamlContent: active.yamlContent,
    };
}
// ---------------------------------------------------------------------------
// importWorkflow
// ---------------------------------------------------------------------------
/**
 * Create a new ceremony row and its first (active) version in the given project.
 * Uses a raw-SQL transaction for atomicity.
 */
export async function importWorkflow(projectId, yamlContent, opts = {}) {
    const pool = getPool();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const name = opts.name ?? 'Imported Ceremony';
        const kind = opts.kind ?? 'ceremony';
        const triggerKind = opts.triggerKind ?? 'manual';
        const triggerConfig = opts.triggerConfig ?? {};
        // Build a unique slug from name to avoid UNIQUE constraint violations.
        const baseSlug = (opts.slug ?? name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        const slug = `${baseSlug}-${Date.now()}`;
        const wRes = await client.query(`
      INSERT INTO workflows (project_id, name, slug, description, trigger_kind, trigger_config, kind)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `, [projectId, name, slug, opts.description ?? null, triggerKind, JSON.stringify(triggerConfig), kind]);
        const ceremonyId = wRes.rows[0].id;
        const vRes = await client.query(`
      INSERT INTO workflow_versions (workflow_id, version, yaml_content, is_active)
      VALUES ($1, 1, $2, TRUE)
      RETURNING id
    `, [ceremonyId, yamlContent]);
        const versionId = vRes.rows[0].id;
        await client.query('COMMIT');
        return { ceremonyId, versionId };
    }
    catch (err) {
        await client.query('ROLLBACK');
        throw err;
    }
    finally {
        client.release();
    }
}
export async function saveAsTemplate(ceremonyId, name, description) {
    const db = getDb();
    const pool = getPool();
    const payload = await exportWorkflow(ceremonyId);
    const [ceremony] = await db
        .select({ projectId: schema.workflows.projectId })
        .from(schema.workflows)
        .where(eq(schema.workflows.id, ceremonyId))
        .limit(1);
    const client = await pool.connect();
    let templateId;
    try {
        await client.query('BEGIN');
        const res = await client.query(`
      INSERT INTO templates (kind, name, description, payload, project_id)
      VALUES ('workflow', $1, $2, $3, $4)
      RETURNING id
    `, [name, description ?? null, JSON.stringify(payload), ceremony?.projectId ?? null]);
        await client.query('COMMIT');
        templateId = res.rows[0].id;
    }
    catch (err) {
        await client.query('ROLLBACK');
        throw err;
    }
    finally {
        client.release();
    }
    // Stream D — D7: project-local mirror (only when the ceremony is bound to
    // a project — global/system workflow templates have no .squad/ directory).
    let storagePath = null;
    let storageError = null;
    if (ceremony?.projectId) {
        const mirror = await writeTemplateMirror(ceremony.projectId, 'workflow', payload, {
            id: templateId,
            name,
            description,
        });
        storagePath = mirror.storagePath;
        storageError = mirror.error;
    }
    else {
        storageError = 'ceremony has no projectId — skipping disk mirror';
    }
    return { templateId, storagePath, storageError };
}
// ---------------------------------------------------------------------------
// instantiateTemplate
// ---------------------------------------------------------------------------
/**
 * Look up a workflow template by ID and import it into projectId.
 */
export async function instantiateTemplate(projectId, templateId) {
    const db = getDb();
    const [tmpl] = await db
        .select()
        .from(schema.templates)
        .where(eq(schema.templates.id, templateId))
        .limit(1);
    if (!tmpl)
        throw new Error(`Template not found: ${templateId}`);
    if (tmpl.kind !== 'workflow')
        throw new Error(`Template ${templateId} is not a workflow template`);
    const payload = tmpl.payload;
    return importWorkflow(projectId, payload.yamlContent, {
        name: payload.name,
        description: payload.description ?? undefined,
        triggerKind: payload.triggerKind,
        triggerConfig: payload.triggerConfig,
        kind: payload.kind,
    });
}
//# sourceMappingURL=workflow-template.js.map
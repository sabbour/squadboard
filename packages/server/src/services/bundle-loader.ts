/**
 * services/bundle-loader.ts
 *
 * Applies a SquadboardBundle to the running Squadboard instance idempotently.
 *
 * Entry point:
 *   applyBundle(bundle, opts) → Promise<ApplyResult>
 *
 * Idempotency contract:
 *   - Each section is applied in order: project, kanban, team, ceremonies,
 *     workflows, skills, tools, mcpServers, routing, agents.
 *   - ON CONFLICT: skip with a warning unless opts.overwriteExisting = true.
 *   - dryRun: validate and enumerate what would change, but write nothing.
 *
 * Hockney W16 note: applyBundle is designed as the implementation backing
 * "built-in project templates restore" — call it with the materialised
 * starter bundle to recreate a project configuration after wipe or restore.
 * The `projectId` returned in ApplyResult.meta allows callers to chain
 * further operations (e.g. re-casting agents via Init Mode).
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname, isAbsolute } from 'node:path';
import { eq, and } from 'drizzle-orm';
import { getDb, getPool, schema } from '../db/index.js';
import { createSkill, listSkills } from './skills.js';
import { createTool, listTools } from './tools.js';
import { createMcpServer, listMcpServers } from './mcp.js';
import type {
  SquadboardBundle,
  ApplyResult,
  BundleTeamMember,
  BundleSkill,
  BundleTool,
  BundleMcpServer,
  BundleRoutingRule,
  BundleKanbanColumn,
  BundleCeremony,
  BundleWorkflow,
} from '@sabbour/squadboard-sdk/bundle';

// ---------------------------------------------------------------------------
// Extended result type with meta (project id for downstream callers)
// ---------------------------------------------------------------------------

export interface ExtendedApplyResult extends ApplyResult {
  meta: {
    projectId?: string;
    bundleId: string;
    bundleName: string;
    dryRun: boolean;
  };
}

export interface ApplyBundleOpts {
  dryRun?: boolean;
  overwriteExisting?: boolean;
  /**
   * Target project id. When provided, bundle sections are applied into
   * this existing project (ignores bundle.project name for lookup).
   * When absent, the loader creates or looks up a project by
   * bundle.project.name (or bundle.manifest.name if project section absent).
   */
  projectId?: string;
  /**
   * Base directory for resolving relative `bodyPath` references.
   * Defaults to process.cwd().
   */
  bundleDir?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read an optional body path relative to bundleDir. */
async function readBodyPath(bodyPath: string, bundleDir: string): Promise<string> {
  const abs = isAbsolute(bodyPath) ? bodyPath : resolve(bundleDir, bodyPath);
  return readFile(abs, 'utf-8');
}

/** Coerce any value to a plain string for warning/log messages. */
function str(v: unknown): string {
  if (typeof v === 'string') return v;
  return String(v);
}

// ---------------------------------------------------------------------------
// Section: project
// ---------------------------------------------------------------------------

async function applyProject(
  bundle: SquadboardBundle,
  opts: Required<ApplyBundleOpts>,
  result: ExtendedApplyResult,
): Promise<string | undefined> {
  const db = getDb();

  if (opts.projectId) {
    const [existing] = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, opts.projectId));
    if (!existing) {
      result.errors.push(`projectId ${opts.projectId} not found — cannot apply bundle`);
      return undefined;
    }
    result.applied.push(`project:${existing.id} (pre-existing, used as target)`);
    return existing.id;
  }

  const projectName = bundle.project?.name ?? bundle.manifest.name;

  // Look up by name (best-effort — names are not unique in schema).
  const existing = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.name, projectName));

  if (existing.length > 0) {
    const proj = existing[0];
    if (opts.overwriteExisting && bundle.project) {
      if (!opts.dryRun) {
        await db
          .update(schema.projects)
          .set({
            name: bundle.project.name,
          })
          .where(eq(schema.projects.id, proj.id));
      }
      result.applied.push(`project:${proj.id} (updated)`);
    } else {
      result.skipped.push(`project:"${projectName}" already exists (id=${proj.id})`);
    }
    return proj.id;
  }

  if (opts.dryRun) {
    result.applied.push(`project:"${projectName}" (would create)`);
    return undefined;
  }

  const [created] = await db
    .insert(schema.projects)
    .values({ name: projectName, path: `.squad` })
    .returning();

  result.applied.push(`project:${created.id} ("${projectName}" created)`);
  return created.id;
}

// ---------------------------------------------------------------------------
// Section: kanban columns
// ---------------------------------------------------------------------------

async function applyKanban(
  bundle: SquadboardBundle,
  projectId: string,
  opts: Required<ApplyBundleOpts>,
  result: ExtendedApplyResult,
): Promise<void> {
  if (!bundle.kanban) return;
  const pool = getPool();

  // Check existing columns.
  const { rows: existing } = await pool.query<{ column_id: string }>(
    `SELECT column_id FROM column_meta WHERE project_id = $1`,
    [projectId],
  );
  const existingSlugs = new Set(existing.map((r) => r.column_id));

  if (existingSlugs.size > 0 && !opts.overwriteExisting) {
    result.skipped.push(
      `kanban: ${existingSlugs.size} column(s) already exist — skipped (use overwriteExisting to replace)`,
    );
    return;
  }

  if (opts.overwriteExisting && existingSlugs.size > 0 && !opts.dryRun) {
    await pool.query(`DELETE FROM column_meta WHERE project_id = $1`, [projectId]);
    result.applied.push(`kanban: cleared ${existingSlugs.size} existing column(s)`);
  }

  const sorted = [...bundle.kanban.columns].sort((a, b) => a.order - b.order);

  for (let i = 0; i < sorted.length; i++) {
    const col: BundleKanbanColumn = sorted[i];
    const isDefault = col.slug === bundle.kanban.defaultColumn;

    if (opts.dryRun) {
      result.applied.push(`kanban: would create column "${col.label}" (slug=${col.slug})`);
      continue;
    }

    await pool.query(
      `INSERT INTO column_meta
         (project_id, column_id, label, color, position, semantic, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (project_id, column_id) DO NOTHING`,
      [projectId, col.slug, col.label, '#6B6B6B', i, 'custom', isDefault],
    );
    result.applied.push(`kanban: column "${col.label}" (slug=${col.slug})`);
  }
}

// ---------------------------------------------------------------------------
// Section: team (agents + charters)
// ---------------------------------------------------------------------------

async function applyTeam(
  bundle: SquadboardBundle,
  projectId: string,
  opts: Required<ApplyBundleOpts>,
  result: ExtendedApplyResult,
): Promise<void> {
  if (!bundle.team || bundle.team.length === 0) return;
  const db = getDb();

  const existingAgents = await db
    .select({ name: schema.agents.name, id: schema.agents.id })
    .from(schema.agents)
    .where(eq(schema.agents.projectId, projectId));

  const existingByName = new Map(existingAgents.map((a) => [a.name.toLowerCase(), a.id]));

  for (const member of bundle.team) {
    const key = member.name.toLowerCase();
    if (existingByName.has(key) && !opts.overwriteExisting) {
      result.skipped.push(`team: agent "${member.name}" already exists`);
      continue;
    }

    let charterBody = member.charter;
    if (!charterBody && member.charterPath) {
      try {
        charterBody = await readBodyPath(member.charterPath, opts.bundleDir);
      } catch (e) {
        result.warnings.push(`team: could not read charterPath for "${member.name}": ${str(e)}`);
        charterBody = `# ${member.name}\n\n${member.role}`;
      }
    }
    if (!charterBody) {
      charterBody = `# ${member.name}\n\n## Role\n${member.role}\n`;
    }

    const charterPath = `.squad/agents/${member.name.toLowerCase()}/charter.md`;

    if (opts.dryRun) {
      result.applied.push(`team: would create agent "${member.name}" (role=${member.role})`);
      continue;
    }

    if (existingByName.has(key) && opts.overwriteExisting) {
      const agentId = existingByName.get(key)!;
      await db
        .update(schema.agents)
        .set({ role: member.role, charterPath, updatedAt: new Date() })
        .where(eq(schema.agents.id, agentId));
      result.applied.push(`team: agent "${member.name}" updated`);
    } else {
      await db.insert(schema.agents).values({
        projectId,
        name: member.name,
        role: member.role,
        charterPath,
        status: 'active',
      });
      result.applied.push(`team: agent "${member.name}" created (role=${member.role})`);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers for workflow/ceremony creation (two-table pattern)
// ---------------------------------------------------------------------------

/** Generate a URL-safe slug from a display name. */
function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function insertWorkflowWithVersion(
  db: ReturnType<typeof getDb>,
  params: {
    projectId: string;
    name: string;
    kind: string;
    triggerKind: string;
    triggerConfig: Record<string, unknown>;
    yamlContent: string;
    description?: string;
  },
): Promise<void> {
  const slug = toSlug(params.name);
  const [wf] = await db
    .insert(schema.workflows)
    .values({
      projectId: params.projectId,
      name: params.name,
      slug,
      description: params.description ?? null,
      triggerKind: params.triggerKind,
      triggerConfig: params.triggerConfig,
      kind: params.kind,
      status: 'active',
    })
    .returning();

  await db.insert(schema.workflowVersions).values({
    workflowId: wf.id,
    version: 1,
    yamlContent: params.yamlContent,
    isActive: true,
  });
}

// ---------------------------------------------------------------------------
// Section: ceremonies
// ---------------------------------------------------------------------------

async function applyCeremonies(
  bundle: SquadboardBundle,
  projectId: string,
  opts: Required<ApplyBundleOpts>,
  result: ExtendedApplyResult,
): Promise<void> {
  if (!bundle.ceremonies || bundle.ceremonies.length === 0) return;
  const db = getDb();

  const existing = await db
    .select({ name: schema.workflows.name, id: schema.workflows.id })
    .from(schema.workflows)
    .where(and(eq(schema.workflows.projectId, projectId), eq(schema.workflows.kind, 'ceremony')));

  const existingByName = new Map(existing.map((w) => [w.name.toLowerCase(), w.id]));

  for (const ceremony of bundle.ceremonies) {
    const key = ceremony.name.toLowerCase();
    if (existingByName.has(key) && !opts.overwriteExisting) {
      result.skipped.push(`ceremony: "${ceremony.name}" already exists`);
      continue;
    }

    let yamlContent = ceremony.workflowYaml;
    if (!yamlContent && ceremony.bodyPath) {
      try {
        yamlContent = await readBodyPath(ceremony.bodyPath, opts.bundleDir);
      } catch (e) {
        result.warnings.push(`ceremony: could not read bodyPath for "${ceremony.name}": ${str(e)}`);
        yamlContent = '';
      }
    }
    if (!yamlContent) {
      result.warnings.push(`ceremony: "${ceremony.name}" has no workflowYaml or bodyPath — skipped`);
      result.skipped.push(`ceremony: "${ceremony.name}" (no YAML body)`);
      continue;
    }

    if (opts.dryRun) {
      result.applied.push(`ceremony: would create "${ceremony.name}"`);
      continue;
    }

    if (existingByName.has(key) && opts.overwriteExisting) {
      // Update trigger on the parent row; insert a new version with updated YAML.
      const id = existingByName.get(key)!;
      await db
        .update(schema.workflows)
        .set({
          triggerKind: ceremony.trigger.kind,
          triggerConfig: ceremony.trigger.config ?? {},
          updatedAt: new Date(),
        })
        .where(eq(schema.workflows.id, id));

      // Deactivate existing versions and insert a new active one.
      await db
        .update(schema.workflowVersions)
        .set({ isActive: false })
        .where(eq(schema.workflowVersions.workflowId, id));

      const versions = await db
        .select({ version: schema.workflowVersions.version })
        .from(schema.workflowVersions)
        .where(eq(schema.workflowVersions.workflowId, id));

      const nextVersion = versions.length + 1;
      await db.insert(schema.workflowVersions).values({
        workflowId: id,
        version: nextVersion,
        yamlContent,
        isActive: true,
      });
      result.applied.push(`ceremony: "${ceremony.name}" updated`);
    } else {
      await insertWorkflowWithVersion(db, {
        projectId,
        name: ceremony.name,
        kind: 'ceremony',
        triggerKind: ceremony.trigger.kind,
        triggerConfig: ceremony.trigger.config ?? {},
        yamlContent,
      });
      result.applied.push(`ceremony: "${ceremony.name}" created`);
    }
  }
}

// ---------------------------------------------------------------------------
// Section: workflows (standalone, kind='workflow')
// ---------------------------------------------------------------------------

async function applyWorkflows(
  bundle: SquadboardBundle,
  projectId: string,
  opts: Required<ApplyBundleOpts>,
  result: ExtendedApplyResult,
): Promise<void> {
  if (!bundle.workflows || bundle.workflows.length === 0) return;
  const db = getDb();

  const existing = await db
    .select({ name: schema.workflows.name, id: schema.workflows.id })
    .from(schema.workflows)
    .where(and(eq(schema.workflows.projectId, projectId), eq(schema.workflows.kind, 'workflow')));

  const existingByName = new Map(existing.map((w) => [w.name.toLowerCase(), w.id]));

  for (const wf of bundle.workflows) {
    const key = wf.name.toLowerCase();
    if (existingByName.has(key) && !opts.overwriteExisting) {
      result.skipped.push(`workflow: "${wf.name}" already exists`);
      continue;
    }

    let yamlContent = wf.workflowYaml;
    if (!yamlContent && wf.bodyPath) {
      try {
        yamlContent = await readBodyPath(wf.bodyPath, opts.bundleDir);
      } catch (e) {
        result.warnings.push(`workflow: could not read bodyPath for "${wf.name}": ${str(e)}`);
        yamlContent = '';
      }
    }

    if (!yamlContent) {
      result.skipped.push(`workflow: "${wf.name}" (no YAML body)`);
      continue;
    }

    if (opts.dryRun) {
      result.applied.push(`workflow: would create "${wf.name}"`);
      continue;
    }

    if (existingByName.has(key) && opts.overwriteExisting) {
      const id = existingByName.get(key)!;
      await db
        .update(schema.workflows)
        .set({ updatedAt: new Date() })
        .where(eq(schema.workflows.id, id));

      await db
        .update(schema.workflowVersions)
        .set({ isActive: false })
        .where(eq(schema.workflowVersions.workflowId, id));

      const versions = await db
        .select({ version: schema.workflowVersions.version })
        .from(schema.workflowVersions)
        .where(eq(schema.workflowVersions.workflowId, id));

      const nextVersion = versions.length + 1;
      await db.insert(schema.workflowVersions).values({
        workflowId: id,
        version: nextVersion,
        yamlContent,
        isActive: true,
      });
      result.applied.push(`workflow: "${wf.name}" updated`);
    } else {
      await insertWorkflowWithVersion(db, {
        projectId,
        name: wf.name,
        kind: 'workflow',
        triggerKind: wf.triggerKind,
        triggerConfig: wf.triggerConfig ?? {},
        yamlContent,
        description: wf.description,
      });
      result.applied.push(`workflow: "${wf.name}" created`);
    }
  }
}

// ---------------------------------------------------------------------------
// Section: skills
// ---------------------------------------------------------------------------

async function applySkills(
  bundle: SquadboardBundle,
  projectId: string,
  opts: Required<ApplyBundleOpts>,
  result: ExtendedApplyResult,
): Promise<void> {
  if (!bundle.skills || bundle.skills.length === 0) return;

  const existingSkills = await listSkills(projectId);
  const existingByKey = new Map(existingSkills.map((s) => [s.key, s.id]));

  for (const skill of bundle.skills) {
    if (existingByKey.has(skill.key) && !opts.overwriteExisting) {
      result.skipped.push(`skill: "${skill.key}" already exists`);
      continue;
    }

    let promptAddendum = skill.promptAddendum;
    if (!promptAddendum && skill.bodyPath) {
      try {
        promptAddendum = await readBodyPath(skill.bodyPath, opts.bundleDir);
      } catch (e) {
        result.warnings.push(`skill: could not read bodyPath for "${skill.key}": ${str(e)}`);
        promptAddendum = `# ${skill.name}`;
      }
    }
    if (!promptAddendum) {
      result.skipped.push(`skill: "${skill.key}" (no promptAddendum)`);
      continue;
    }

    if (opts.dryRun) {
      result.applied.push(`skill: would create "${skill.key}"`);
      continue;
    }

    await createSkill(projectId, {
      key: skill.key,
      name: skill.name,
      description: skill.description,
      category: skill.category,
      promptAddendum,
      source: 'imported',
      sourceUri: `bundle:${bundle.manifest.bundleId}`,
    });
    result.applied.push(`skill: "${skill.key}" created`);
  }
}

// ---------------------------------------------------------------------------
// Section: tools
// ---------------------------------------------------------------------------

async function applyTools(
  bundle: SquadboardBundle,
  projectId: string,
  opts: Required<ApplyBundleOpts>,
  result: ExtendedApplyResult,
): Promise<void> {
  if (!bundle.tools || bundle.tools.length === 0) return;

  const existingTools = await listTools(projectId);
  const existingByKey = new Map(existingTools.map((t) => [t.key, t.id]));

  for (const tool of bundle.tools) {
    if (existingByKey.has(tool.key) && !opts.overwriteExisting) {
      result.skipped.push(`tool: "${tool.key}" already exists`);
      continue;
    }

    if (opts.dryRun) {
      result.applied.push(`tool: would create "${tool.key}"`);
      continue;
    }

    await createTool(projectId, {
      key: tool.key,
      name: tool.name,
      description: tool.description,
      category: tool.category ?? null,
      inputSchema: tool.inputSchema ?? null,
      outputSchema: tool.outputSchema ?? null,
      source: 'imported',
      sourceUri: `bundle:${bundle.manifest.bundleId}`,
    });
    result.applied.push(`tool: "${tool.key}" created`);
  }
}

// ---------------------------------------------------------------------------
// Section: MCP servers
// ---------------------------------------------------------------------------

async function applyMcpServers(
  bundle: SquadboardBundle,
  projectId: string,
  opts: Required<ApplyBundleOpts>,
  result: ExtendedApplyResult,
): Promise<void> {
  if (!bundle.mcpServers || bundle.mcpServers.length === 0) return;

  const existingServers = await listMcpServers(projectId);
  const existingByName = new Map(existingServers.map((s) => [s.name.toLowerCase(), s.id]));

  for (const server of bundle.mcpServers) {
    const key = server.name.toLowerCase();
    if (existingByName.has(key) && !opts.overwriteExisting) {
      result.skipped.push(`mcpServer: "${server.name}" already exists`);
      continue;
    }

    if (opts.dryRun) {
      result.applied.push(`mcpServer: would create "${server.name}"`);
      continue;
    }

    await createMcpServer(projectId, {
      name: server.name,
      description: server.description ?? null,
      transport: server.transport ?? 'stdio',
      command: server.command,
      args: server.args ?? [],
      url: server.url ?? null,
      headers: [],
      enabled: true,
    });
    result.applied.push(`mcpServer: "${server.name}" created`);
  }
}

// ---------------------------------------------------------------------------
// Section: routing rules
// ---------------------------------------------------------------------------

async function applyRouting(
  bundle: SquadboardBundle,
  projectId: string,
  opts: Required<ApplyBundleOpts>,
  result: ExtendedApplyResult,
): Promise<void> {
  if (!bundle.routing || bundle.routing.length === 0) return;
  const db = getDb();

  const existing = await db
    .select({ pattern: schema.routingRules.pattern, id: schema.routingRules.id })
    .from(schema.routingRules)
    .where(eq(schema.routingRules.projectId, projectId));

  const existingByPattern = new Map(existing.map((r) => [r.pattern, r.id]));

  let priority = 0;
  for (const rule of bundle.routing) {
    if (existingByPattern.has(rule.pattern) && !opts.overwriteExisting) {
      result.skipped.push(`routing: pattern "${rule.pattern}" already exists`);
      continue;
    }

    if (opts.dryRun) {
      result.applied.push(`routing: would create rule pattern="${rule.pattern}" → ${rule.agentName}`);
      continue;
    }

    const rawRule = rule.rawRule ?? `| ${rule.pattern} | ${rule.agentName} |`;
    await db.insert(schema.routingRules).values({
      projectId,
      pattern: rule.pattern,
      matchType: rule.matchType,
      agentName: rule.agentName,
      priority: rule.priority ?? priority,
      rawRule,
    });
    result.applied.push(`routing: rule "${rule.pattern}" → ${rule.agentName}`);
    priority++;
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Apply a SquadboardBundle to a Squadboard instance.
 *
 * Sections are applied in dependency order:
 *   project → kanban → team → ceremonies → workflows → skills → tools → mcpServers → routing
 *
 * @param bundle   Parsed and validated SquadboardBundle
 * @param opts     Apply options (dryRun, overwriteExisting, projectId, bundleDir)
 * @returns        ExtendedApplyResult with per-item applied/skipped/warnings/errors lists
 */
export async function applyBundle(
  bundle: SquadboardBundle,
  opts: ApplyBundleOpts = {},
): Promise<ExtendedApplyResult> {
  const resolvedOpts: Required<ApplyBundleOpts> = {
    dryRun: opts.dryRun ?? false,
    overwriteExisting: opts.overwriteExisting ?? false,
    projectId: opts.projectId ?? '',
    bundleDir: opts.bundleDir ?? process.cwd(),
  };

  const result: ExtendedApplyResult = {
    applied: [],
    skipped: [],
    warnings: [],
    errors: [],
    meta: {
      bundleId: bundle.manifest.bundleId,
      bundleName: bundle.manifest.name,
      dryRun: resolvedOpts.dryRun,
    },
  };

  // Warn on future schema versions.
  if (bundle.manifest.schemaVersion > 1) {
    result.warnings.push(
      `Bundle schemaVersion=${bundle.manifest.schemaVersion} is newer than supported (1). Unknown sections will be ignored.`,
    );
  }

  // Apply project (must come first — all other sections need projectId).
  const projectId = await applyProject(bundle, resolvedOpts, result);
  if (!projectId && !resolvedOpts.dryRun) {
    result.errors.push('Could not resolve projectId — aborting remaining sections');
    return result;
  }
  result.meta.projectId = projectId;

  const pid = projectId ?? 'dry-run-placeholder';

  await applyKanban(bundle, pid, resolvedOpts, result);
  await applyTeam(bundle, pid, resolvedOpts, result);
  await applyCeremonies(bundle, pid, resolvedOpts, result);
  await applyWorkflows(bundle, pid, resolvedOpts, result);
  await applySkills(bundle, pid, resolvedOpts, result);
  await applyTools(bundle, pid, resolvedOpts, result);
  await applyMcpServers(bundle, pid, resolvedOpts, result);
  await applyRouting(bundle, pid, resolvedOpts, result);

  return result;
}

// ---------------------------------------------------------------------------
// Bundle loading utilities (filesystem + URL)
// ---------------------------------------------------------------------------

/**
 * Load a SquadboardBundle from a local file path or HTTP(S) URL.
 * Supports:
 *   - Absolute or relative filesystem paths to `squad-bundle.json`
 *   - https:// URLs (fetched via native fetch, cached in-process for the session)
 */
export async function loadBundle(pathOrUrl: string): Promise<{ bundle: SquadboardBundle; bundleDir: string }> {
  if (pathOrUrl.startsWith('https://') || pathOrUrl.startsWith('http://')) {
    const res = await fetch(pathOrUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch bundle from ${pathOrUrl}: HTTP ${res.status}`);
    }
    const bundle = (await res.json()) as SquadboardBundle;
    validateBundleManifest(bundle);
    return { bundle, bundleDir: process.cwd() };
  }

  const abs = isAbsolute(pathOrUrl) ? pathOrUrl : resolve(process.cwd(), pathOrUrl);
  const raw = await readFile(abs, 'utf-8');
  const bundle = JSON.parse(raw) as SquadboardBundle;
  validateBundleManifest(bundle);
  return { bundle, bundleDir: dirname(abs) };
}

/** Minimal structural validation — throws on malformed manifests. */
function validateBundleManifest(bundle: SquadboardBundle): void {
  if (!bundle || typeof bundle !== 'object') {
    throw new Error('Bundle is not a valid JSON object');
  }
  if (!bundle.manifest) {
    throw new Error('Bundle is missing required `manifest` section');
  }
  const m = bundle.manifest;
  if (!m.bundleId || !m.name || !m.version) {
    throw new Error('Bundle manifest is missing required fields: bundleId, name, version');
  }
  if (typeof m.schemaVersion !== 'number') {
    throw new Error('Bundle manifest.schemaVersion must be a number');
  }
}

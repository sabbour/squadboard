/**
 * project-template.ts — Phase 19 project portability helpers
 *
 * exportProject       : bundle project meta + agents + ceremonies + boards
 *                       (column meta) + labels + skills + tools + mcp + routing rules.
 *                       EXCLUDES: issues, runs, comments, inbox, costs.
 * importProject       : create a new project row + bundle's contents (all-or-nothing).
 * saveAsTemplate      : write a templates row (kind='project').
 * instantiateTemplate : fetch a template and delegate to importProject.
 *
 * All writes use pg transactions.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { eq, desc } from 'drizzle-orm';
import { getDb, getPool, schema } from '../../db/index.js';
import { computeCharterHash } from '../charter-compiler.js';
import { assertSafeSquadScaffoldTarget } from '../setup-lifecycle.js';
import { writeTemplateMirror } from './template-storage.js';
import { exportCeremonyAsYaml } from '../ceremony-yaml-export.js';
import { importCeremonyFromYaml } from '../ceremony-yaml-import.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentBundle {
  name:           string;
  role:           string;
  model:          string | null;
  status:         string;
  charterContent: string | null;
  skillKeys:      string[];
  toolKeys:       string[];
  mcpNames:       string[];
}

export interface CeremonyBundle {
  name:         string;
  slug:         string;
  description:  string | null;
  triggerKind:  string;
  triggerConfig: unknown;
  kind:         string;
  yamlContent:  string | null;
}

export interface SkillBundle {
  key:            string;
  name:           string;
  description:    string | null;
  category:       string | null;
  promptAddendum: string;
  curatedKey:     string | null;
}

export interface ToolBundle {
  key:          string;
  name:         string;
  description:  string;
  category:     string | null;
  inputSchema:  unknown;
  outputSchema: unknown;
}

export interface McpServerBundle {
  name:        string;
  description: string | null;
  transport:   string;
  url:         string | null;
  command:     string | null;
  args:        unknown;
  enabled:     boolean;
  // NOTE: encrypted headers are excluded (security — ciphertext is useless across instances).
}

export interface LabelBundle {
  name:  string;
  color: string;
}

export interface ColumnMetaBundle {
  columnId:    string;
  label:       string;
  description: string | null;
  color:       string;
  position:    number;
  semantic:    string;   // 'backlog'|'ready'|'in_progress'|'review'|'done'|'custom'
  isDefault:   boolean;
}

export interface RoutingRuleBundle {
  priority:  number;
  pattern:   string;
  matchType: string;
  agentName: string;
  rawRule:   string;
}

export interface ProjectPayload {
  meta: {
    name:        string;
    defaultModel: string | null;
  };
  agents:       AgentBundle[];
  ceremonies:   CeremonyBundle[];
  labels:       LabelBundle[];
  columnMeta:   ColumnMetaBundle[];
  skills:       SkillBundle[];
  tools:        ToolBundle[];
  mcpServers:   McpServerBundle[];
  routingRules: RoutingRuleBundle[];
}

// ---------------------------------------------------------------------------
// exportProject
// ---------------------------------------------------------------------------

export async function exportProject(projectId: string): Promise<ProjectPayload> {
  const db = getDb();

  // Project meta.
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  // Agents.
  const agentRows = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.projectId, projectId));

  const agents: AgentBundle[] = await Promise.all(agentRows.map(async (agent) => {
    let charterContent: string | null = null;
    try { charterContent = await fs.readFile(agent.charterPath, 'utf-8'); } catch { /* ok */ }

    const skillKeys = (await db
      .select({ key: schema.skills.key })
      .from(schema.agentSkills)
      .innerJoin(schema.skills, eq(schema.skills.id, schema.agentSkills.skillId))
      .where(eq(schema.agentSkills.agentId, agent.id))).map((r) => r.key);

    const toolKeys = (await db
      .select({ key: schema.tools.key })
      .from(schema.agentTools)
      .innerJoin(schema.tools, eq(schema.tools.id, schema.agentTools.toolId))
      .where(eq(schema.agentTools.agentId, agent.id))).map((r) => r.key);

    const mcpNames = (await db
      .select({ name: schema.mcpServers.name })
      .from(schema.agentMcpServers)
      .innerJoin(schema.mcpServers, eq(schema.mcpServers.id, schema.agentMcpServers.mcpServerId))
      .where(eq(schema.agentMcpServers.agentId, agent.id))).map((r) => r.name);

    return { name: agent.name, role: agent.role, model: agent.model ?? null,
      status: agent.status, charterContent, skillKeys, toolKeys, mcpNames };
  }));

  // Ceremonies (workflows table, active version's YAML).
  const ceremonyRows = await db
    .select()
    .from(schema.workflows)
    .where(eq(schema.workflows.projectId, projectId));

  const ceremonies: CeremonyBundle[] = await Promise.all(ceremonyRows.map(async (c) => {
    const versions = await db
      .select()
      .from(schema.workflowVersions)
      .where(eq(schema.workflowVersions.workflowId, c.id))
      .orderBy(desc(schema.workflowVersions.version));
    const active = versions.find((v) => v.isActive) ?? versions[0];

    // CER-9: emit canonical CER-3 YAML; fall back to stored yamlContent on error
    let yamlContent: string | null = null;
    try {
      yamlContent = await exportCeremonyAsYaml(c.id);
    } catch {
      yamlContent = active?.yamlContent ?? null;
    }

    return {
      name: c.name, slug: c.slug, description: c.description ?? null,
      triggerKind: c.triggerKind, triggerConfig: c.triggerConfig, kind: c.kind,
      yamlContent,
    };
  }));

  // Labels.
  const labelRows = await db
    .select()
    .from(schema.labels)
    .where(eq(schema.labels.projectId, projectId));
  const labels: LabelBundle[] = labelRows.map((l) => ({ name: l.name, color: l.color }));

  // Column meta.
  const colRows = await db
    .select()
    .from(schema.columnMeta)
    .where(eq(schema.columnMeta.projectId, projectId));
  const columnMeta: ColumnMetaBundle[] = colRows.map((c) => ({
    columnId: c.columnId, label: c.label, description: c.description ?? null,
    color: c.color, position: c.position,
    semantic: c.semantic ?? 'custom',
    isDefault: c.isDefault ?? false,
  }));

  // Skills.
  const skillRows = await db
    .select()
    .from(schema.skills)
    .where(eq(schema.skills.projectId, projectId));
  const skills: SkillBundle[] = skillRows.map((s) => ({
    key: s.key, name: s.name, description: s.description ?? null,
    category: s.category ?? null, promptAddendum: s.promptAddendum,
    curatedKey: s.curatedKey ?? null,
  }));

  // Tools.
  const toolRows = await db
    .select()
    .from(schema.tools)
    .where(eq(schema.tools.projectId, projectId));
  const tools: ToolBundle[] = toolRows.map((t) => ({
    key: t.key, name: t.name, description: t.description,
    category: t.category ?? null, inputSchema: t.inputSchema, outputSchema: t.outputSchema,
  }));

  // MCP servers (headers excluded — ciphertext is useless across instances).
  const mcpRows = await db
    .select()
    .from(schema.mcpServers)
    .where(eq(schema.mcpServers.projectId, projectId));
  const mcpServers: McpServerBundle[] = mcpRows.map((m) => ({
    name: m.name, description: m.description ?? null, transport: m.transport,
    url: m.url ?? null, command: m.command ?? null, args: m.args, enabled: m.enabled,
  }));

  // Routing rules.
  const routingRows = await db
    .select()
    .from(schema.routingRules)
    .where(eq(schema.routingRules.projectId, projectId));
  const routingRules: RoutingRuleBundle[] = routingRows.map((r) => ({
    priority: r.priority, pattern: r.pattern, matchType: r.matchType,
    agentName: r.agentName, rawRule: r.rawRule,
  }));

  return {
    meta: { name: project.name, defaultModel: project.defaultModel ?? null },
    agents, ceremonies, labels, columnMeta, skills, tools, mcpServers, routingRules,
  };
}

// ---------------------------------------------------------------------------
// importProject
// ---------------------------------------------------------------------------

/**
 * Create a brand-new project from a ProjectPayload bundle.
 * The new project row gets a fresh UUID and its squad path is auto-derived
 * from a temp directory under the caller-supplied newSquadPath param.
 * All inserts run in a single transaction.
 */
export async function importProject(
  payload: ProjectPayload,
  newProjectName: string,
  newSquadPath: string,
): Promise<string> {
  const pool = getPool();
  const client = await pool.connect();
  const squadPath = assertSafeSquadScaffoldTarget(newSquadPath);

  const agentsDir = path.join(squadPath, 'agents');
  await fs.mkdir(agentsDir, { recursive: true });

  // Hoisted so they're accessible after the transaction block
  let projectId!: string;
  const canonicalCeremonies: CeremonyBundle[] = [];

  try {
    await client.query('BEGIN');

    // Create project row.
    const pRes = await client.query<{ id: string }>(`
      INSERT INTO projects (name, path, default_model)
      VALUES ($1, $2, $3)
      RETURNING id
    `, [newProjectName, squadPath, payload.meta.defaultModel ?? null]);
    projectId = pRes.rows[0].id;

    // Skills.
    const skillIdByKey: Record<string, string> = {};
    for (const s of payload.skills) {
      const sRes = await client.query<{ id: string }>(`
        INSERT INTO skills (project_id, key, name, description, category, prompt_addendum, curated_key)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (project_id, key) DO UPDATE SET name=EXCLUDED.name
        RETURNING id
      `, [projectId, s.key, s.name, s.description, s.category, s.promptAddendum, s.curatedKey]);
      skillIdByKey[s.key] = sRes.rows[0].id;
    }

    // Tools.
    const toolIdByKey: Record<string, string> = {};
    for (const t of payload.tools) {
      const tRes = await client.query<{ id: string }>(`
        INSERT INTO tools (project_id, key, name, description, category, input_schema, output_schema)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (project_id, key) DO UPDATE SET name=EXCLUDED.name
        RETURNING id
      `, [projectId, t.key, t.name, t.description, t.category,
          t.inputSchema ? JSON.stringify(t.inputSchema) : null,
          t.outputSchema ? JSON.stringify(t.outputSchema) : null]);
      toolIdByKey[t.key] = tRes.rows[0].id;
    }

    // MCP servers.
    const mcpIdByName: Record<string, string> = {};
    for (const m of payload.mcpServers) {
      const mRes = await client.query<{ id: string }>(`
        INSERT INTO mcp_servers (project_id, name, description, transport, url, command, args, enabled)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `, [projectId, m.name, m.description, m.transport, m.url, m.command,
          JSON.stringify(m.args ?? []), m.enabled]);
      mcpIdByName[m.name] = mRes.rows[0].id;
    }

    // Labels.
    for (const l of payload.labels) {
      await client.query(`
        INSERT INTO labels (project_id, name, color) VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
      `, [projectId, l.name, l.color]);
    }

    // Column meta.
    for (const c of payload.columnMeta) {
      await client.query(`
        INSERT INTO column_meta (project_id, column_id, label, description, color, position, semantic, is_default)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (project_id, column_id) DO UPDATE
          SET label=EXCLUDED.label, description=EXCLUDED.description,
              color=EXCLUDED.color, position=EXCLUDED.position,
              semantic=EXCLUDED.semantic, is_default=EXCLUDED.is_default
      `, [projectId, c.columnId, c.label, c.description, c.color, c.position,
          c.semantic ?? 'custom', c.isDefault ?? false]);
    }

    // Routing rules.
    for (const r of payload.routingRules) {
      await client.query(`
        INSERT INTO routing_rules (project_id, priority, pattern, match_type, agent_name, raw_rule)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [projectId, r.priority, r.pattern, r.matchType, r.agentName, r.rawRule]);
    }

    // Agents.
    for (const a of payload.agents) {
      const charterContent = a.charterContent ?? `# ${a.name}\n\n## Role\n${a.role}\n`;
      const charterFileName = `${a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.charter.md`;
      const charterPath = path.join(agentsDir, charterFileName);
      await fs.writeFile(charterPath, charterContent, 'utf-8');
      const charterHash = await computeCharterHash(charterPath);

      const aRes = await client.query<{ id: string }>(`
        INSERT INTO agents (project_id, name, role, model, status, charter_path, charter_hash)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (project_id, name) DO UPDATE SET role=EXCLUDED.role
        RETURNING id
      `, [projectId, a.name, a.role, a.model, a.status ?? 'active', charterPath, charterHash]);
      const agentId = aRes.rows[0].id;

      for (const key of a.skillKeys) {
        const sid = skillIdByKey[key];
        if (sid) await client.query(`INSERT INTO agent_skills (agent_id, skill_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [agentId, sid]);
      }
      for (const key of a.toolKeys) {
        const tid = toolIdByKey[key];
        if (tid) await client.query(`INSERT INTO agent_tools (agent_id, tool_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [agentId, tid]);
      }
      for (const name of a.mcpNames) {
        const mid = mcpIdByName[name];
        if (mid) await client.query(`INSERT INTO agent_mcp_servers (agent_id, mcp_server_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [agentId, mid]);
      }
    }

    // Ceremonies — split canonical (CER-3) from legacy.
    // Canonical YAML bundles (apiVersion: squad.io/v1) are imported via
    // importCeremonyFromYaml AFTER the transaction so they run with a
    // clean ORM connection against the already-committed project row.
    // Legacy bundles (raw yamlContent without the apiVersion header) are
    // inserted inline within the transaction for atomicity.
    for (const c of payload.ceremonies) {
      if (!c.yamlContent) continue;
      if (c.yamlContent.includes('apiVersion: squad.io/v1')) {
        canonicalCeremonies.push(c);
      } else {
        // Legacy path — insert within transaction
        const baseSlug = c.slug ?? c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const slug = `${baseSlug}-${Date.now()}`;

        const wRes = await client.query<{ id: string }>(`
          INSERT INTO workflows (project_id, name, slug, description, trigger_kind, trigger_config, kind)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id
        `, [projectId, c.name, slug, c.description, c.triggerKind, JSON.stringify(c.triggerConfig ?? {}), c.kind]);
        const ceremonyId = wRes.rows[0].id;

        await client.query(`
          INSERT INTO workflow_versions (workflow_id, version, yaml_content, is_active)
          VALUES ($1, 1, $2, TRUE)
        `, [ceremonyId, c.yamlContent]);
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Import canonical CER-3 ceremonies after commit (ORM-based, needs project to exist).
  // These run outside the transaction — a failure here doesn't roll back the project.
  for (const c of canonicalCeremonies) {
    await importCeremonyFromYaml(c.yamlContent!, projectId);
  }

  return projectId;
}

// ---------------------------------------------------------------------------
// saveAsTemplate
// ---------------------------------------------------------------------------

export interface SaveAsTemplateResult {
  templateId: string;
  storagePath: string | null;
  storageError: string | null;
}

export async function saveAsTemplate(
  projectId: string,
  name: string,
  description?: string,
): Promise<SaveAsTemplateResult> {
  const pool = getPool();
  const payload = await exportProject(projectId);

  const client = await pool.connect();
  let templateId: string;
  try {
    await client.query('BEGIN');
    const res = await client.query<{ id: string }>(`
      INSERT INTO templates (kind, name, description, payload, project_id)
      VALUES ('project', $1, $2, $3, $4)
      RETURNING id
    `, [name, description ?? null, JSON.stringify(payload), projectId]);
    await client.query('COMMIT');
    templateId = res.rows[0].id;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Stream D — D7: project-local mirror under .squad/squadboard/templates/.
  const mirror = await writeTemplateMirror(projectId, 'project', payload, {
    id: templateId,
    name,
    description,
  });

  return {
    templateId,
    storagePath: mirror.storagePath,
    storageError: mirror.error,
  };
}

// ---------------------------------------------------------------------------
// instantiateTemplate
// ---------------------------------------------------------------------------

export async function instantiateTemplate(
  templateId: string,
  newProjectName: string,
  newSquadPath: string,
): Promise<string> {
  const db = getDb();

  const [tmpl] = await db
    .select()
    .from(schema.templates)
    .where(eq(schema.templates.id, templateId))
    .limit(1);

  if (!tmpl) throw new Error(`Template not found: ${templateId}`);
  if (tmpl.kind !== 'project') throw new Error(`Template ${templateId} is not a project template`);

  return importProject(tmpl.payload as ProjectPayload, newProjectName, newSquadPath);
}

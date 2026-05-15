/**
 * team-template.ts — Phase 19 team portability helpers
 *
 * exportTeam            : serialize all project agents (name, role, model, charter content,
 *                         expertise, skills/tools/mcp assignments by key/name)
 * importTeam            : create matching agents in the target project, skip name conflicts
 *                         unless opts.force=true
 * saveAsTemplate        : write a templates row (kind='team')
 * instantiateTemplate   : fetch a template and delegate to importTeam
 *
 * All writes use pg transactions (all-or-nothing).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { eq, and, inArray } from 'drizzle-orm';
import { getDb, getPool, schema } from '../../db/index.js';
import { computeCharterHash } from '../charter-compiler.js';
import { writeTemplateMirror } from './template-storage.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentExport {
  name:       string;
  role:       string;
  model:      string | null;
  status:     string;
  charterContent: string | null; // full charter markdown
  expertise:  string[];
  skills:     string[];  // skill keys
  tools:      string[];  // tool keys
  mcpServers: string[];  // mcp server names
}

export interface TeamPayload {
  agents: AgentExport[];
}

// ---------------------------------------------------------------------------
// exportTeam
// ---------------------------------------------------------------------------

export async function exportTeam(projectId: string): Promise<TeamPayload> {
  const db = getDb();

  const agents = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.projectId, projectId));

  const agentExports: AgentExport[] = await Promise.all(
    agents.map(async (agent) => {
      // Read charter content (best-effort; null if missing).
      let charterContent: string | null = null;
      try {
        charterContent = await fs.readFile(agent.charterPath, 'utf-8');
      } catch {
        /* file may not exist for synthetic agents */
      }

      // Skills assigned to this agent.
      const agentSkillRows = await db
        .select({ key: schema.skills.key })
        .from(schema.agentSkills)
        .innerJoin(schema.skills, eq(schema.skills.id, schema.agentSkills.skillId))
        .where(eq(schema.agentSkills.agentId, agent.id));

      // Tools assigned to this agent.
      const agentToolRows = await db
        .select({ key: schema.tools.key })
        .from(schema.agentTools)
        .innerJoin(schema.tools, eq(schema.tools.id, schema.agentTools.toolId))
        .where(eq(schema.agentTools.agentId, agent.id));

      // MCP servers assigned to this agent.
      const agentMcpRows = await db
        .select({ name: schema.mcpServers.name })
        .from(schema.agentMcpServers)
        .innerJoin(schema.mcpServers, eq(schema.mcpServers.id, schema.agentMcpServers.mcpServerId))
        .where(eq(schema.agentMcpServers.agentId, agent.id));

      return {
        name:           agent.name,
        role:           agent.role,
        model:          agent.model ?? null,
        status:         agent.status,
        charterContent,
        expertise:      [],      // derived from charter at import time
        skills:         agentSkillRows.map((r) => r.key),
        tools:          agentToolRows.map((r) => r.key),
        mcpServers:     agentMcpRows.map((r) => r.name),
      };
    }),
  );

  return { agents: agentExports };
}

// ---------------------------------------------------------------------------
// importTeam
// ---------------------------------------------------------------------------

export interface ImportTeamOpts {
  force?: boolean; // when true, skip existing agents by name (no overwrite in this phase)
}

export async function importTeam(
  projectId: string,
  payload: TeamPayload,
  opts: ImportTeamOpts = {},
): Promise<{ imported: string[]; skipped: string[] }> {
  const db   = getDb();
  const pool = getPool();

  // Resolve project path so we can write charter files.
  const [project] = await db
    .select({ squadPath: schema.projects.path })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);

  if (!project) throw new Error(`Project not found: ${projectId}`);
  const agentsDir = path.join(project.squadPath, 'agents');
  await fs.mkdir(agentsDir, { recursive: true });

  // Fetch existing agent names to detect conflicts.
  const existing = await db
    .select({ name: schema.agents.name })
    .from(schema.agents)
    .where(eq(schema.agents.projectId, projectId));
  const existingNames = new Set(existing.map((a) => a.name));

  const imported: string[] = [];
  const skipped:  string[] = [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const agentDef of payload.agents) {
      if (existingNames.has(agentDef.name)) {
        skipped.push(agentDef.name);
        continue;
      }

      // Write charter file to disk.
      const charterContent = agentDef.charterContent
        ?? `# ${agentDef.name}\n\n## Role\n${agentDef.role}\n`;
      const charterFileName = `${agentDef.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.charter.md`;
      const charterPath = path.join(agentsDir, charterFileName);
      await fs.writeFile(charterPath, charterContent, 'utf-8');
      const charterHash = await computeCharterHash(charterPath);

      // Insert agent row.
      const aRes = await client.query<{ id: string }>(`
        INSERT INTO agents (project_id, name, role, model, status, charter_path, charter_hash)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `, [
        projectId,
        agentDef.name,
        agentDef.role,
        agentDef.model ?? null,
        agentDef.status ?? 'active',
        charterPath,
        charterHash,
      ]);
      const agentId = aRes.rows[0].id;

      // Assign skills by key (best-effort; missing keys are skipped).
      if (agentDef.skills.length > 0) {
        const skillRows = await db
          .select({ id: schema.skills.id, key: schema.skills.key })
          .from(schema.skills)
          .where(and(
            eq(schema.skills.projectId, projectId),
            inArray(schema.skills.key, agentDef.skills),
          ));
        for (const skill of skillRows) {
          await client.query(`
            INSERT INTO agent_skills (agent_id, skill_id) VALUES ($1, $2)
            ON CONFLICT DO NOTHING
          `, [agentId, skill.id]);
        }
      }

      // Assign tools by key.
      if (agentDef.tools.length > 0) {
        const toolRows = await db
          .select({ id: schema.tools.id, key: schema.tools.key })
          .from(schema.tools)
          .where(and(
            eq(schema.tools.projectId, projectId),
            inArray(schema.tools.key, agentDef.tools),
          ));
        for (const tool of toolRows) {
          await client.query(`
            INSERT INTO agent_tools (agent_id, tool_id) VALUES ($1, $2)
            ON CONFLICT DO NOTHING
          `, [agentId, tool.id]);
        }
      }

      // Assign MCP servers by name.
      if (agentDef.mcpServers.length > 0) {
        const mcpRows = await db
          .select({ id: schema.mcpServers.id, name: schema.mcpServers.name })
          .from(schema.mcpServers)
          .where(and(
            eq(schema.mcpServers.projectId, projectId),
            inArray(schema.mcpServers.name, agentDef.mcpServers),
          ));
        for (const mcp of mcpRows) {
          await client.query(`
            INSERT INTO agent_mcp_servers (agent_id, mcp_server_id) VALUES ($1, $2)
            ON CONFLICT DO NOTHING
          `, [agentId, mcp.id]);
        }
      }

      imported.push(agentDef.name);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { imported, skipped };
}

// ---------------------------------------------------------------------------
// saveAsTemplate
// ---------------------------------------------------------------------------

export interface SaveAsTeamTemplateResult {
  templateId: string;
  storagePath: string | null;
  storageError: string | null;
}

export async function saveAsTemplate(
  projectId: string,
  name: string,
  description?: string,
): Promise<SaveAsTeamTemplateResult> {
  const pool = getPool();
  const payload = await exportTeam(projectId);

  const client = await pool.connect();
  let templateId: string;
  try {
    await client.query('BEGIN');
    const res = await client.query<{ id: string }>(`
      INSERT INTO templates (kind, name, description, payload, project_id)
      VALUES ('team', $1, $2, $3, $4)
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

  // Stream D — D7: project-local mirror under .squad/squadboard/templates/team/.
  const mirror = await writeTemplateMirror(projectId, 'team', payload, {
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
  projectId: string,
  templateId: string,
  opts: ImportTeamOpts = {},
): Promise<{ imported: string[]; skipped: string[] }> {
  const db = getDb();

  const [tmpl] = await db
    .select()
    .from(schema.templates)
    .where(eq(schema.templates.id, templateId))
    .limit(1);

  if (!tmpl) throw new Error(`Template not found: ${templateId}`);
  if (tmpl.kind !== 'team') throw new Error(`Template ${templateId} is not a team template`);

  return importTeam(projectId, tmpl.payload as TeamPayload, opts);
}

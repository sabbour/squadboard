/**
 * services/irl-mapper.ts
 *
 * Translates a `SquadSDKConfig`-shaped object (produced by squad-config-loader)
 * into a structured Squadboard provisioning plan, then materialises it on
 * disk + in Postgres for a target project.
 *
 * The mapper is split in two so the route can preview the plan before
 * committing:
 *
 *   mapIrlConfigToPlan(loaded)        → pure, no I/O
 *   materialiseIrlPlan(projectId, …)  → writes .squad files + DB rows
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { getDb, schema } from '../db/index.js';
import { computeCharterHash } from './charter-compiler.js';
import { runTranslateForNarrative } from '../routes/ceremonies.js';
// ---------------------------------------------------------------------------
// Pure mapping
// ---------------------------------------------------------------------------
export function mapIrlConfigToPlan(loaded) {
    const warnings = [...loaded.warnings];
    const cfg = (loaded.config ?? {});
    const team = (cfg.team ?? null);
    const defaults = (cfg.defaults ?? null);
    const routing = (cfg.routing ?? null);
    const agentsArr = Array.isArray(cfg.agents) ? cfg.agents : [];
    const ceremoniesArr = Array.isArray(cfg.ceremonies)
        ? cfg.ceremonies
        : [];
    const defaultModel = pickModelString(defaults?.model);
    // ---- Agents ----
    const agents = [];
    for (const a of agentsArr) {
        const rawName = stringOr(a?.name, '').trim();
        if (!rawName) {
            warnings.push('Skipped agent with missing name');
            continue;
        }
        const name = slugifyAgentName(rawName);
        const role = stringOr(a?.role, 'Specialist').trim();
        const charter = renderCharter(a, role);
        const model = pickModelString(a?.model) ?? defaultModel;
        agents.push({
            name,
            role,
            model,
            charterPath: path.posix.join('agents', name, 'charter.md'),
            charterContents: charter,
        });
    }
    // ---- Routing rules ----
    const routingRules = [];
    const routingRulesIn = Array.isArray(routing?.rules)
        ? routing.rules
        : [];
    for (let i = 0; i < routingRulesIn.length; i++) {
        const r = routingRulesIn[i];
        // Target agent — IRL uses `agents: ['@name']` (array); also support
        // older `assign`/`agent`/`to` scalar fields for forward compat.
        const agentsArrRule = toStringArray(r?.agents).map(stripAt);
        const targetAgent = agentsArrRule[0] ?? stripAt(stringOr(r?.assign ?? r?.agent ?? r?.to ?? '', ''));
        if (!targetAgent) {
            warnings.push(`Skipped routing rule #${i + 1}: no target agent`);
            continue;
        }
        // Pattern + match type. IRL puts a single `pattern` string at the top
        // level (often pipe-separated keywords). Prefer that; fall back to
        // explicit labels/keywords arrays for forward compat.
        const labels = toStringArray(r?.labels ?? r?.label);
        const keywords = toStringArray(r?.keywords ?? r?.keyword);
        const patternStr = stringOr(r?.pattern, '').trim();
        let matchType;
        let pattern;
        if (labels.length) {
            matchType = 'label';
            pattern = labels.join(',');
        }
        else if (keywords.length) {
            matchType = 'keyword';
            pattern = keywords.join(',');
        }
        else if (patternStr) {
            matchType = 'keyword';
            pattern = patternStr;
        }
        else {
            matchType = 'catchall';
            pattern = '*';
        }
        const priority = typeof r?.priority === 'number'
            ? Math.max(0, Math.floor(r.priority))
            : routingRulesIn.length - i;
        routingRules.push({
            priority,
            pattern,
            matchType,
            agentName: targetAgent,
            rawRule: JSON.stringify(r),
        });
    }
    // ---- Ceremonies ----
    const ceremonies = ceremoniesArr.map((c, i) => {
        const name = slugifyAgentName(stringOr(c?.name, `ceremony-${i + 1}`));
        return {
            name,
            filePath: path.posix.join('ceremonies', `${name}.md`),
            contents: renderCeremony(c, name),
        };
    });
    // ---- Top-level files ----
    const files = [];
    if (team) {
        files.push({ filePath: 'team.md', contents: renderTeam(team, agents) });
    }
    if (routingRules.length) {
        files.push({ filePath: 'routing.md', contents: renderRoutingMd(routingRules) });
    }
    if (defaults) {
        files.push({ filePath: 'defaults.md', contents: renderDefaults(defaults) });
    }
    return {
        defaultModel,
        teamName: stringOr(team?.name, null) || null,
        teamMembers: toStringArray(team?.members).map(stripAt),
        agents,
        routingRules,
        ceremonies,
        files,
        warnings,
    };
}
export async function materialiseIrlPlan(projectId, projectPath, plan) {
    await fs.mkdir(projectPath, { recursive: true });
    // Write top-level files first.
    let filesWritten = 0;
    for (const f of plan.files) {
        const abs = path.join(projectPath, f.filePath);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, f.contents, 'utf-8');
        filesWritten++;
    }
    // Write ceremony files.
    for (const c of plan.ceremonies) {
        const abs = path.join(projectPath, c.filePath);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, c.contents, 'utf-8');
        filesWritten++;
    }
    // Write agent charters + insert DB rows.
    const db = getDb();
    let agentsInserted = 0;
    for (const a of plan.agents) {
        const charterAbs = path.join(projectPath, a.charterPath);
        const historyAbs = path.join(path.dirname(charterAbs), 'history.md');
        await fs.mkdir(path.dirname(charterAbs), { recursive: true });
        await fs.writeFile(charterAbs, a.charterContents, 'utf-8');
        await fs.writeFile(historyAbs, `# ${a.name} history\n\n_(empty)_\n`, 'utf-8');
        filesWritten += 2;
        const charterHash = await computeCharterHash(charterAbs).catch(() => undefined);
        await db
            .insert(schema.agents)
            .values({
            projectId,
            name: a.name,
            role: a.role,
            model: a.model,
            charterPath: charterAbs,
            historyPath: historyAbs,
            charterHash,
        })
            .returning();
        agentsInserted++;
    }
    // Insert routing rules.
    let routingRulesInserted = 0;
    if (plan.routingRules.length) {
        await db
            .insert(schema.routingRules)
            .values(plan.routingRules.map((r) => ({
            projectId,
            priority: r.priority,
            pattern: r.pattern,
            matchType: r.matchType,
            agentName: r.agentName,
            rawRule: r.rawRule,
        })));
        routingRulesInserted = plan.routingRules.length;
    }
    // Phase 11: For each markdown ceremony, insert a kind='narrative' workflow
    // row plus its initial version (markdown stored verbatim in yamlContent),
    // then synchronously call the translator to produce a draft executable
    // ceremony. Failures are captured per-ceremony so they don't abort the
    // wider provisioning step.
    let narrativesInserted = 0;
    let draftCeremoniesInserted = 0;
    const translationFailures = [];
    for (const c of plan.ceremonies) {
        let narrativeId;
        try {
            const [narrativeRow] = await db
                .insert(schema.workflows)
                .values({
                projectId,
                name: c.name,
                slug: slugifyAgentName(c.name),
                description: null,
                triggerKind: 'manual',
                triggerConfig: {},
                kind: 'narrative',
                status: 'draft',
            })
                .returning();
            narrativeId = narrativeRow.id;
            narrativesInserted++;
            await db.insert(schema.workflowVersions).values({
                workflowId: narrativeRow.id,
                version: 1,
                yamlContent: c.contents,
                isActive: true,
            });
            const result = await runTranslateForNarrative({ projectId, narrativeId: narrativeRow.id });
            if (result.kind === 'ok') {
                draftCeremoniesInserted++;
            }
            else {
                translationFailures.push({
                    narrativeId: narrativeRow.id,
                    ceremonyName: c.name,
                    error: result.body.error,
                });
            }
        }
        catch (err) {
            // Persistence (or translator wrapper) blew up — capture and continue.
            translationFailures.push({
                narrativeId: narrativeId ?? '<not-created>',
                ceremonyName: c.name,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    return {
        agentsInserted,
        routingRulesInserted,
        filesWritten,
        narrativesInserted,
        draftCeremoniesInserted,
        translationFailures,
    };
}
// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------
function renderCharter(a, role) {
    const name = stringOr(a?.name, 'agent');
    const description = stringOr(a?.description, '').trim();
    const charterBody = stringOr(a?.charter, '').trim();
    const model = pickModelString(a?.model);
    const tools = toStringArray(a?.tools);
    const capabilities = toStringArray(a?.capabilities);
    // Use Squadboard's canonical charter shape so syncAgentsFromDisk can
    // re-parse fields like role/model after we materialise.
    const expertiseItems = capabilities.length
        ? capabilities
        : tools.length
            ? tools
            : description
                ? [description]
                : [`Specialist in ${role}`];
    const lines = [];
    lines.push(`# ${name}`);
    lines.push('');
    lines.push('## Role');
    lines.push('');
    lines.push(role);
    lines.push('');
    if (model) {
        lines.push('## Model');
        lines.push('');
        lines.push(model);
        lines.push('');
    }
    lines.push('## Expertise');
    lines.push('');
    for (const item of expertiseItems)
        lines.push(`- ${item}`);
    lines.push('');
    if (charterBody) {
        lines.push('## Style');
        lines.push('');
        lines.push(charterBody);
        lines.push('');
    }
    return lines.join('\n');
}
function renderTeam(team, agents) {
    const name = stringOr(team?.name, 'Team');
    const description = stringOr(team?.description, '').trim();
    const members = toStringArray(team?.members).map(stripAt);
    const lines = [];
    lines.push(`# ${name}`);
    lines.push('');
    if (description) {
        lines.push(description);
        lines.push('');
    }
    lines.push('## Members');
    lines.push('');
    if (members.length) {
        for (const m of members) {
            const a = agents.find((x) => x.name === m);
            lines.push(`- @${m}${a ? ` — ${a.role}` : ''}`);
        }
    }
    else {
        for (const a of agents) {
            lines.push(`- @${a.name} — ${a.role}`);
        }
    }
    lines.push('');
    return lines.join('\n');
}
function renderRoutingMd(rules) {
    const lines = [];
    lines.push('# Routing');
    lines.push('');
    lines.push('| Priority | Match | Pattern | Assignee |');
    lines.push('| --- | --- | --- | --- |');
    for (const r of rules) {
        lines.push(`| ${r.priority} | ${r.matchType} | \`${r.pattern}\` | @${r.agentName} |`);
    }
    lines.push('');
    return lines.join('\n');
}
function renderDefaults(defaults) {
    const lines = [];
    lines.push('# Defaults');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(defaults, null, 2));
    lines.push('```');
    lines.push('');
    return lines.join('\n');
}
function renderCeremony(c, name) {
    const lines = [];
    lines.push(`# ${name}`);
    lines.push('');
    if (c?.description)
        lines.push(stringOr(c.description, ''));
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(c, null, 2));
    lines.push('```');
    lines.push('');
    return lines.join('\n');
}
// ---------------------------------------------------------------------------
// Coercion helpers
// ---------------------------------------------------------------------------
function stringOr(v, fallback) {
    if (typeof v === 'string')
        return v;
    if (typeof v === 'number' || typeof v === 'boolean')
        return String(v);
    return fallback;
}
function toStringArray(v) {
    if (typeof v === 'string')
        return [v];
    if (Array.isArray(v))
        return v.filter((x) => typeof x === 'string');
    return [];
}
function stripAt(s) {
    return s.startsWith('@') ? s.slice(1) : s;
}
function pickModelString(v) {
    if (typeof v === 'string')
        return v;
    if (v && typeof v === 'object') {
        const obj = v;
        if (typeof obj.id === 'string')
            return obj.id;
        if (typeof obj.name === 'string')
            return obj.name;
        if (typeof obj.model === 'string')
            return obj.model;
    }
    return null;
}
function slugifyAgentName(s) {
    return (s
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64) || 'agent');
}
//# sourceMappingURL=irl-mapper.js.map
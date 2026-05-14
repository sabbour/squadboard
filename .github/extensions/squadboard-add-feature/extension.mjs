/**
 * squadboard-add-feature
 *
 * Productizes the Squadboard feature-creation workflow:
 *   1. Creates a structured feature spec in docs/features/
 *   2. Logs the addition to .squad/decisions/inbox/
 *   3. Returns a Ralph-addressed orchestration prompt that fans out
 *      to the right specialists, tracks in SQL todos, and follows
 *      the hacking-phase git workflow.
 */

import { joinSession } from "@github/copilot-sdk/extension";
import { writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

// Resolve repo root — extensions are spawned from git root
const ROOT = process.cwd();

// ── Specialist routing ──────────────────────────────────────────────────────

const COMPONENT_OWNERS = {
  backend:     "Hockney",
  engine:      "Hockney",
  database:    "Hockney",
  api:         "Hockney",
  sdk:         "Kobayashi",
  agent:       "Kobayashi",
  mcp:         "Kobayashi",
  workflow:    "Kobayashi",
  frontend:    "Keyser",
  ui:          "Keyser",
  client:      "Keyser",
  realtime:    "Verbal",
  websocket:   "Verbal",
  design:      "Fenster",
  ux:          "Fenster",
};

function resolveSpecialists(args) {
  const text = [
    args.title,
    args.description,
    args.implementation_notes ?? "",
    args.schema_changes ?? "",
    args.api_changes ?? "",
    args.ui_changes ?? "",
    args.component ?? "",
  ].join(" ").toLowerCase();

  const picked = new Set();

  // Primary owner always in
  if (args.primary_owner) picked.add(args.primary_owner);

  // Keyword routing
  for (const [keyword, specialist] of Object.entries(COMPONENT_OWNERS)) {
    if (text.includes(keyword)) picked.add(specialist);
  }

  // Fallback: at least Hockney for any backend-adjacent work
  if (picked.size === 0 || (picked.size === 1 && [...picked][0] === "Kujan")) {
    picked.add("Hockney");
  }

  // Always append QA + docs last
  picked.add("Kujan");
  picked.add("Redfoot");

  return [...picked];
}

// ── Feature spec document ───────────────────────────────────────────────────

function buildFeatureSpec(opts) {
  const {
    featureId, title, description, layer, owner, specialists,
    implementation_notes, schema_changes, api_changes, ui_changes, date,
  } = opts;

  const table = [
    ["Feature ID", `\`${featureId}\``],
    ["Created",    date],
    ["Layer",      layer],
    ["Status",     "Backlog"],
    ["Primary owner", owner],
    ["Team",       specialists.join(", ")],
  ].map(([k, v]) => `| **${k}** | ${v} |`).join("\n");

  const sections = [
    `# Feature: ${title}\n`,
    `| Field | Value |\n|-------|-------|\n${table}\n`,
    `## Goal\n\n${description}\n`,
  ];

  if (schema_changes)       sections.push(`## Schema Changes\n\n${schema_changes}\n`);
  if (api_changes)          sections.push(`## API Changes\n\n${api_changes}\n`);
  if (ui_changes)           sections.push(`## UI Changes\n\n${ui_changes}\n`);
  if (implementation_notes) sections.push(`## Implementation Notes\n\n${implementation_notes}\n`);

  sections.push(`## Specialist Assignments

| Specialist | Responsibility |
|------------|---------------|
| **Hockney** (Backend) | Schema migration, API endpoints, business logic |
| **Kobayashi** (SDK/Services) | Agent SDK integration, service layer, compiler |
| **Keyser** (Frontend) | React components, TanStack Query hooks, routing |
| **Verbal** (Real-time) | WebSocket events, live-feed updates |
| **Fenster** (UX) | Component design, dark-mode, empty states |
| **Kujan** (QA) | Integration tests, engine-invariant checks |
| **Redfoot** (Docs) | README sections, demo scripts, user-facing copy |
| **Scribe** (Commits) | Commit with message \`feat: ${title.toLowerCase()}\` |
`);

  sections.push(`## Exit Criteria

- [ ] All work items implemented and committed to \`main\`
- [ ] Integration tests pass — Kujan sign-off
- [ ] README / docs updated — Redfoot sign-off
- [ ] Hacking-phase workflow followed (local git, worktrees, no PRs)
`);

  sections.push(`## Open Questions\n\n_None yet — add as implementation proceeds._\n`);

  return sections.join("\n");
}

// ── Orchestration prompt returned to the main agent ─────────────────────────

function buildOrchestrationPrompt(featureId, title, specialists) {
  const implementors = specialists.filter(s => s !== "Kujan" && s !== "Redfoot" && s !== "Scribe");

  return `\
Feature spec written → \`docs/features/${featureId}.md\`

**Ralph — please orchestrate:**

1. **SQL backlog** — insert todo:
   \`id="${featureId}", title="feat: ${title}", status="pending"\`

2. **Worktree** — \`git worktree add squad/${featureId} -b squad/${featureId}\`

3. **Fan out in parallel** (read the spec for each agent's exact work items):
${implementors.map(s => `   - **${s}**`).join("\n")}

4. After implementation → **Kujan**: integration tests + engine-invariant checks

5. After tests pass → **Redfoot**: README + demo-script updates

6. **Scribe**: commit everything with \`"feat: ${title.toLowerCase()}"\`, merge worktree to \`main\`, remove worktree

Hacking-phase rules apply: local git only, no PRs, merge early and often.`;
}

// ── Extension entry point ────────────────────────────────────────────────────

const session = await joinSession({
  tools: [
    {
      name: "squadboard_add_feature",
      description:
        "Add a new feature to the Squadboard backlog. " +
        "Creates a structured feature spec (docs/features/) and returns an orchestration " +
        "prompt for Ralph to fan out to the right specialists using the hacking-phase workflow.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Feature name — concise, describes the capability (e.g. 'GitHub App Auth')",
          },
          description: {
            type: "string",
            description: "What the feature does, why it matters, and what problem it solves for users.",
          },
          layer: {
            type: "string",
            enum: ["Foundation", "Engine Core", "Board UI", "Workflow", "Advanced", "Post-MVP"],
            description: "Architectural layer this feature belongs to.",
          },
          primary_owner: {
            type: "string",
            enum: ["McManus", "Hockney", "Kobayashi", "Keyser", "Verbal", "Fenster", "Kujan", "Redfoot"],
            description: "Primary specialist who owns delivery of this feature.",
          },
          schema_changes: {
            type: "string",
            description: "Drizzle ORM tables / columns that need to be added or modified.",
          },
          api_changes: {
            type: "string",
            description: "Express API endpoints to add or change (method + path + description).",
          },
          ui_changes: {
            type: "string",
            description: "React components, pages, or client-side flows to build or update.",
          },
          implementation_notes: {
            type: "string",
            description: "Constraints, open questions, architectural decisions, or dependencies.",
          },
        },
        required: ["title", "description"],
      },

      handler: async (args) => {
        const slug = args.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");
        const date      = new Date().toISOString().slice(0, 10);
        const featureId = `feat-${date}-${slug}`;
        const layer     = args.layer ?? "Post-MVP";
        const specialists = resolveSpecialists(args);
        const owner     = args.primary_owner ?? specialists[0] ?? "Hockney";

        // Create docs/features/ if needed
        const docsDir = join(ROOT, "docs", "features");
        if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true });

        const specPath = join(docsDir, `${featureId}.md`);
        writeFileSync(
          specPath,
          buildFeatureSpec({ featureId, title: args.title, description: args.description,
            layer, owner, specialists, date,
            implementation_notes: args.implementation_notes,
            schema_changes: args.schema_changes,
            api_changes: args.api_changes,
            ui_changes: args.ui_changes }),
          "utf8"
        );

        // Drop a decision-inbox note so the team sees it
        const inboxDir = join(ROOT, ".squad", "decisions", "inbox");
        if (!existsSync(inboxDir)) mkdirSync(inboxDir, { recursive: true });
        writeFileSync(
          join(inboxDir, `${featureId}.md`),
          `# New Feature Added: ${args.title}\n\n**Feature ID:** ${featureId}\n**Date:** ${date}\n**Spec:** docs/features/${featureId}.md\n`,
          "utf8"
        );

        await session.log(`📋 Feature spec created: docs/features/${featureId}.md`);

        return buildOrchestrationPrompt(featureId, args.title, specialists);
      },
    },
  ],
});

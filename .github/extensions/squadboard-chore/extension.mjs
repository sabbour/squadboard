/**
 * squadboard-chore
 *
 * Productizes the Squadboard chore workflow for internal housekeeping tasks
 * that are NOT bugs, NOT features, and require NO documentation updates:
 *   1. Creates a structured chore spec in docs/chores/
 *   2. Logs the chore to .squad/decisions/inbox/
 *   3. Returns a single-specialist orchestration prompt following the
 *      hacking-phase git workflow (no Ralph fan-out, no Redfoot, no Kujan).
 *
 * Examples: dependency updates, refactors, config changes, tooling tweaks,
 * cleanup, code health improvements, CI/CD changes, performance optimizations,
 * type fixes.
 */

import { joinSession } from "@github/copilot-sdk/extension";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

// ── Component → primary owner mapping ──────────────────────────────────────

const COMPONENT_OWNER = {
  backend:   "Hockney",
  engine:    "Hockney",
  database:  "Hockney",
  api:       "Hockney",
  schema:    "Hockney",
  migration: "Hockney",
  deps:      "Hockney",   // dependency updates default to backend
  config:    "Hockney",   // config/tooling default to backend
  tooling:   "Hockney",
  ci:        "Hockney",
  sdk:       "Kobayashi",
  agent:     "Kobayashi",
  mcp:       "Kobayashi",
  workflow:  "Kobayashi",
  extension: "Kobayashi",
  frontend:  "Keyser",
  ui:        "Keyser",
  client:    "Keyser",
  websocket: "Verbal",
  realtime:  "Verbal",
  unknown:   "Hockney",   // default
};

// ── Chore spec document ─────────────────────────────────────────────────────

function buildChoreSpec(opts) {
  const { choreId, title, description, effort, component, owner, date, implementation_notes } = opts;

  const table = [
    ["Chore ID",    `\`${choreId}\``],
    ["Created",     date],
    ["Effort",      effort],
    ["Component",   component],
    ["Assigned to", owner],
    ["Status",      "Backlog"],
  ].map(([k, v]) => `| **${k}** | ${v} |`).join("\n");

  const sections = [
    `# Chore: ${title}\n`,
    `| Field | Value |\n|-------|-------|\n${table}\n`,
    `## Goal\n\n${description}\n`,
    `## Implementation Notes\n\n${implementation_notes ?? "_None yet._"}\n`,
    `## Checklist

- [ ] Work done in worktree branch \`squad/${choreId}\`
- [ ] No new user-facing docs required
- [ ] Merged to \`main\` — worktree removed
`,
  ];

  return sections.join("\n");
}

// ── Orchestration prompt returned to the main agent ─────────────────────────

function buildChorePrompt(choreId, title, owner, description) {
  const descPreview = description.length > 300
    ? description.slice(0, 300) + "…"
    : description;

  return `\
Chore logged → \`docs/chores/${choreId}.md\`

**${owner} — you are assigned this chore:**

1. **SQL backlog** — insert todo:
   \`id="${choreId}", title="chore: ${title}", status="pending"\`

2. **Worktree** — \`git worktree add squad/${choreId} -b squad/${choreId}\`

3. **Do the work** (read the chore spec for details):
   ${descPreview.replace(/\n/g, "\n   ")}

4. **Scribe** — commit with \`"chore: ${title.toLowerCase()}"\`, merge worktree to \`main\`, remove worktree

Hacking-phase rules: local git only, no PRs, merge when done.
No docs update needed. No regression test required unless the chore touches test infrastructure.`;
}

// ── Extension entry point ────────────────────────────────────────────────────

const session = await joinSession({
  tools: [
    {
      name: "squadboard_chore",
      description:
        "Log a housekeeping chore in Squadboard. " +
        "Use for internal tasks that are NOT bugs and NOT features: dependency updates, " +
        "refactors, config changes, tooling tweaks, cleanup, CI/CD changes, performance " +
        "optimizations, type fixes. Creates a chore spec (docs/chores/) and returns a " +
        "single-specialist orchestration prompt — no docs update, no regression test required.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Chore name — concise description of the housekeeping task (e.g. 'Upgrade drizzle-orm to v0.31')",
          },
          description: {
            type: "string",
            description: "What needs to be done, why it matters for code health, and what problem it addresses.",
          },
          component: {
            type: "string",
            enum: [
              "backend", "engine", "database", "api", "schema", "migration", "deps",
              "sdk", "agent", "mcp", "workflow", "extension",
              "frontend", "ui", "client",
              "websocket", "realtime",
              "config", "tooling", "ci",
              "unknown",
            ],
            description: "Which component or subsystem this chore belongs to.",
          },
          effort: {
            type: "string",
            enum: ["trivial", "small", "medium", "large"],
            description:
              "trivial = < 30 min; small = half day; medium = 1-2 days; large = 3+ days.",
          },
          implementation_notes: {
            type: "string",
            description: "Constraints, approach hints, known gotchas, or relevant links.",
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
        const choreId   = `chore-${date}-${slug}`;
        const effort    = args.effort    ?? "small";
        const component = args.component ?? "unknown";
        const owner     = COMPONENT_OWNER[component] ?? "Hockney";

        // Create docs/chores/ if needed
        const docsDir = join(ROOT, "docs", "chores");
        if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true });

        const specPath = join(docsDir, `${choreId}.md`);
        writeFileSync(
          specPath,
          buildChoreSpec({
            choreId, title: args.title, description: args.description,
            effort, component, owner, date,
            implementation_notes: args.implementation_notes,
          }),
          "utf8"
        );

        // Drop a decision-inbox note
        const inboxDir = join(ROOT, ".squad", "decisions", "inbox");
        if (!existsSync(inboxDir)) mkdirSync(inboxDir, { recursive: true });
        writeFileSync(
          join(inboxDir, `${choreId}.md`),
          `# Chore Logged: ${args.title}\n\n**Chore ID:** ${choreId}\n**Date:** ${date}\n**Effort:** ${effort}\n**Component:** ${component}\n**Assigned to:** ${owner}\n**Spec:** docs/chores/${choreId}.md\n`,
          "utf8"
        );

        await session.log(
          `🧹 Chore spec created: docs/chores/${choreId}.md  (${effort} → ${owner})`
        );

        return buildChorePrompt(choreId, args.title, owner, args.description);
      },
    },
  ],
});

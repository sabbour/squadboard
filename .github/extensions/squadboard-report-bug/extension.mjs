/**
 * squadboard-report-bug
 *
 * Productizes the Squadboard bug-reporting and fix workflow:
 *   1. Creates a structured bug report in docs/bugs/
 *   2. Logs the bug to .squad/decisions/inbox/
 *   3. Returns a fix-orchestration prompt that assigns the right
 *      specialist, mandates a regression test, and follows the
 *      hacking-phase git workflow.
 */

import { joinSession } from "@github/copilot-sdk/extension";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

// ── Component → primary fixer mapping ──────────────────────────────────────

const COMPONENT_OWNER = {
  backend:      "Hockney",
  engine:       "Hockney",
  database:     "Hockney",
  "github-sync": "Hockney",
  api:          "Hockney",
  sdk:          "Kobayashi",
  agent:        "Kobayashi",
  mcp:          "Kobayashi",
  workflow:     "Kobayashi",
  frontend:     "Keyser",
  ui:           "Keyser",
  client:       "Keyser",
  websocket:    "Verbal",
  realtime:     "Verbal",
  docs:         "Redfoot",
  unknown:      "Hockney", // default
};

const SEVERITY_EMOJI = {
  critical: "🔴",
  high:     "🟠",
  medium:   "🟡",
  low:      "🟢",
};

// ── Bug report document ─────────────────────────────────────────────────────

function buildBugReport(opts) {
  const {
    bugId, title, reproduction_steps, expected, actual,
    severity, component, owner, date, additional_context,
  } = opts;

  const emoji = SEVERITY_EMOJI[severity] ?? "🟡";

  const table = [
    ["Bug ID",      `\`${bugId}\``],
    ["Reported",    date],
    ["Severity",    `${emoji} ${severity}`],
    ["Component",   component],
    ["Assigned to", owner],
    ["Status",      "Open"],
  ].map(([k, v]) => `| **${k}** | ${v} |`).join("\n");

  const sections = [
    `# Bug: ${title}\n`,
    `| Field | Value |\n|-------|-------|\n${table}\n`,
    `## Reproduction Steps\n\n${reproduction_steps}\n`,
    `## Expected Behavior\n\n${expected}\n`,
    `## Actual Behavior\n\n${actual}\n`,
  ];

  if (additional_context) {
    sections.push(`## Additional Context\n\n${additional_context}\n`);
  }

  sections.push(`## Fix Checklist

- [ ] Root cause identified and documented here
- [ ] Fix implemented on worktree branch \`squad/${bugId}\`
- [ ] Regression test added (Kujan sign-off required)
- [ ] Fix merged to \`main\` — worktree removed
- [ ] This doc updated with resolution notes
`);

  sections.push(`## Resolution\n\n_To be filled in when fixed. Include: root cause, files changed, test added._\n`);

  return sections.join("\n");
}

// ── Orchestration prompt returned to the main agent ─────────────────────────

function buildFixPrompt(bugId, title, owner, severity, component, reproduction_steps) {
  const urgencyMap = {
    critical: "**IMMEDIATELY — drop all other work**",
    high:     "as soon as possible",
    medium:   "in the next available slot",
    low:      "when bandwidth allows",
  };
  const urgency = urgencyMap[severity] ?? urgencyMap.medium;

  // Truncate repro steps for the prompt
  const reproPreview = reproduction_steps.length > 300
    ? reproduction_steps.slice(0, 300) + "…"
    : reproduction_steps;

  return `\
Bug report written → \`docs/bugs/${bugId}.md\`

**${SEVERITY_EMOJI[severity] ?? "🟡"} ${severity.toUpperCase()} — fix ${urgency}.**

**${owner} — you are assigned to this bug:**

1. **SQL backlog** — insert todo:
   \`id="${bugId}", title="bug: ${title}", status="pending"\`

2. **Worktree** — \`git worktree add squad/${bugId} -b squad/${bugId}\`

3. **Reproduce** using steps in \`docs/bugs/${bugId}.md\`:
   > ${reproPreview.replace(/\n/g, "\n   > ")}

4. **Root-cause analysis** — identify the defect in the \`${component}\` component

5. **Fix** — surgical, minimal change; don't refactor unrelated code

6. **Kujan** — write a regression test that would have caught this bug *(required)*

7. **Update** \`docs/bugs/${bugId}.md\` — fill in the Resolution section

8. **Scribe** — commit with \`"fix: ${title.toLowerCase()}"\`, merge worktree to \`main\`, remove worktree

Hacking-phase rules: local git only, no PRs, merge immediately after Kujan sign-off.`;
}

// ── Extension entry point ────────────────────────────────────────────────────

const session = await joinSession({
  tools: [
    {
      name: "squadboard_report_bug",
      description:
        "Report a bug in Squadboard. " +
        "Creates a structured bug report (docs/bugs/) with reproduction steps, " +
        "assigns to the right specialist, and returns a fix-orchestration prompt " +
        "that mandates a regression test before merge.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Bug title — concise description of what is broken (e.g. 'pnpm run dev does not serve frontend')",
          },
          reproduction_steps: {
            type: "string",
            description: "Numbered step-by-step instructions to reproduce the bug from a clean state.",
          },
          expected: {
            type: "string",
            description: "What should happen when following the reproduction steps.",
          },
          actual: {
            type: "string",
            description: "What actually happens. Include error messages, wrong output, or visual evidence.",
          },
          severity: {
            type: "string",
            enum: ["critical", "high", "medium", "low"],
            description:
              "critical = blocks core workflow or data loss; " +
              "high = significant UX breakage; " +
              "medium = notable issue with workaround; " +
              "low = minor nuisance.",
          },
          component: {
            type: "string",
            enum: [
              "backend", "engine", "database", "api",
              "frontend", "ui", "client",
              "sdk", "agent", "mcp", "workflow",
              "websocket", "realtime",
              "github-sync", "docs", "unknown",
            ],
            description: "Which component or subsystem contains the defect.",
          },
          additional_context: {
            type: "string",
            description: "Stack traces, log output, error codes, environment details, or anything else relevant.",
          },
        },
        required: ["title", "reproduction_steps", "expected", "actual"],
      },

      handler: async (args) => {
        const slug = args.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");
        const date      = new Date().toISOString().slice(0, 10);
        const bugId     = `bug-${date}-${slug}`;
        const severity  = args.severity  ?? "medium";
        const component = args.component ?? "unknown";
        const owner     = COMPONENT_OWNER[component] ?? "Hockney";

        // Create docs/bugs/ if needed
        const docsDir = join(ROOT, "docs", "bugs");
        if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true });

        const reportPath = join(docsDir, `${bugId}.md`);
        writeFileSync(
          reportPath,
          buildBugReport({
            bugId, title: args.title, date, severity, component, owner,
            reproduction_steps: args.reproduction_steps,
            expected: args.expected,
            actual: args.actual,
            additional_context: args.additional_context,
          }),
          "utf8"
        );

        // Drop a decision-inbox note
        const inboxDir = join(ROOT, ".squad", "decisions", "inbox");
        if (!existsSync(inboxDir)) mkdirSync(inboxDir, { recursive: true });
        writeFileSync(
          join(inboxDir, `${bugId}.md`),
          `# Bug Reported: ${args.title}\n\n**Bug ID:** ${bugId}\n**Severity:** ${SEVERITY_EMOJI[severity]} ${severity}\n**Component:** ${component}\n**Assigned to:** ${owner}\n**Report:** docs/bugs/${bugId}.md\n`,
          "utf8"
        );

        await session.log(
          `🐛 Bug report created: docs/bugs/${bugId}.md  (${SEVERITY_EMOJI[severity]} ${severity} → ${owner})`
        );

        return buildFixPrompt(
          bugId, args.title, owner, severity, component, args.reproduction_steps
        );
      },
    },
  ],
});

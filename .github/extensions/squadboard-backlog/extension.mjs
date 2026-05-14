/**
 * squadboard-backlog
 *
 * Surfaces the current state of the Squadboard work queue in one call:
 *   - Features in docs/features/ (parsed status, owner, layer)
 *   - Bugs in docs/bugs/ (parsed severity, component, open/resolved)
 *   - Recent git commits (last 10)
 *   - Pending .squad/decisions/inbox/ entries
 *
 * Returns a formatted status board PLUS a prompt for the main agent
 * to layer in SQL todo state and present a unified picture.
 */

import { joinSession } from "@github/copilot-sdk/extension";
import {
  existsSync, readdirSync, readFileSync, statSync,
} from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();

// ── Markdown metadata parser ─────────────────────────────────────────────────
// Reads the first table in a markdown file and returns a key→value map.

function parseFirstTable(content) {
  const map = {};
  const lines = content.split("\n");
  let inTable = false;
  for (const line of lines) {
    if (!inTable && line.startsWith("| **")) { inTable = true; }
    if (!inTable) continue;
    if (line.startsWith("|---") || line.startsWith("| Field")) continue;
    if (!line.startsWith("|")) break;
    const cols = line.split("|").map(s => s.trim()).filter(Boolean);
    if (cols.length >= 2) {
      const key = cols[0].replace(/\*\*/g, "").trim();
      const val = cols[1].replace(/`/g, "").trim();
      map[key] = val;
    }
  }
  return map;
}

function readMdFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith(".md"))
    .map(f => {
      const content = readFileSync(join(dir, f), "utf8");
      const meta = parseFirstTable(content);
      const title = (content.match(/^#\s+(.+)$/m) ?? [])[1] ?? f;
      return { file: f, title, meta, content };
    });
}

// ── Git helpers ───────────────────────────────────────────────────────────────

function git(...args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "(unavailable)";
  }
}

// ── Board renderer ────────────────────────────────────────────────────────────

const SEVERITY_EMOJI = { critical: "🔴", high: "🟠", medium: "🟡", low: "🟢" };
const STATUS_EMOJI   = { Backlog: "📋", "In Progress": "🚧", Done: "✅", Blocked: "🔒" };

function renderFeatures(items) {
  if (items.length === 0) return "_No features tracked yet._";
  return items.map(({ title, meta }) => {
    const status  = meta["Status"]       ?? "Backlog";
    const owner   = meta["Primary owner"] ?? "?";
    const layer   = meta["Layer"]         ?? "?";
    const emoji   = STATUS_EMOJI[status]  ?? "📋";
    const cleanTitle = title.replace(/^Feature:\s*/i, "");
    return `${emoji} **${cleanTitle}** — ${owner} · ${layer} · _${status}_`;
  }).join("\n");
}

function renderBugs(items) {
  if (items.length === 0) return "_No bugs tracked yet._";
  return items.map(({ title, meta }) => {
    const severity  = meta["Severity"]     ?? "medium";
    const component = meta["Component"]    ?? "?";
    const owner     = meta["Assigned to"]  ?? "?";
    const status    = meta["Status"]       ?? "Open";
    // Severity cell may include emoji already — strip it
    const sevClean  = severity.replace(/^[🔴🟠🟡🟢]\s*/, "").trim();
    const emoji     = SEVERITY_EMOJI[sevClean] ?? "🟡";
    const doneEmoji = status === "Open" ? "🐛" : "✅";
    const cleanTitle = title.replace(/^Bug:\s*/i, "");
    return `${doneEmoji} ${emoji} **${cleanTitle}** — ${owner} · ${component} · _${status}_`;
  }).join("\n");
}

function renderInbox(dir) {
  if (!existsSync(dir)) return "_Empty_";
  const files = readdirSync(dir).filter(f => f.endsWith(".md"));
  if (files.length === 0) return "_Empty_";
  return files.map(f => `  • ${f.replace(".md", "")}`).join("\n");
}

function renderGitLog() {
  const log = git(
    "log", "--oneline", "--no-decorate", "-10",
    "--format=%h %s"
  );
  if (!log || log === "(unavailable)") return "_Git log unavailable_";
  return log.split("\n").map(l => `  \`${l}\``).join("\n");
}

// ── Extension ─────────────────────────────────────────────────────────────────

const session = await joinSession({
  tools: [
    {
      name: "squadboard_backlog_status",
      description:
        "Show a unified Squadboard backlog status board: features in docs/features/, " +
        "bugs in docs/bugs/, pending inbox decisions, and recent git commits. " +
        "Also returns a prompt for the agent to merge in SQL todo state.",
      parameters: {
        type: "object",
        properties: {
          filter: {
            type: "string",
            enum: ["all", "features", "bugs", "open", "done"],
            description: "What to show: all (default), features only, bugs only, open items only, or completed items only.",
          },
        },
      },

      handler: async (args) => {
        const filter = args.filter ?? "all";

        const features = readMdFiles(join(ROOT, "docs", "features"));
        const bugs     = readMdFiles(join(ROOT, "docs", "bugs"));
        const inboxDir = join(ROOT, ".squad", "decisions", "inbox");
        const branch   = git("branch", "--show-current");
        const inboxCount = existsSync(inboxDir)
          ? readdirSync(inboxDir).filter(f => f.endsWith(".md")).length
          : 0;

        // Apply filter
        const filteredFeatures = filter === "bugs" ? [] :
          filter === "done"    ? features.filter(f => (f.meta["Status"] ?? "") === "Done") :
          filter === "open"    ? features.filter(f => (f.meta["Status"] ?? "Backlog") !== "Done") :
          features;

        const filteredBugs = filter === "features" ? [] :
          filter === "done"  ? bugs.filter(b => (b.meta["Status"] ?? "Open") !== "Open") :
          filter === "open"  ? bugs.filter(b => (b.meta["Status"] ?? "Open") === "Open") :
          bugs;

        const lines = [
          `## 📋 Squadboard Backlog — \`${branch}\``,
          ``,
          `### 🧩 Features (${filteredFeatures.length})`,
          renderFeatures(filteredFeatures),
          ``,
          `### 🐛 Bugs (${filteredBugs.length})`,
          renderBugs(filteredBugs),
          ``,
          `### 📬 Pending Decisions Inbox (${inboxCount} file${inboxCount !== 1 ? "s" : ""})`,
          renderInbox(inboxDir),
          ``,
          `### 🕐 Recent Commits`,
          renderGitLog(),
        ];

        const board = lines.join("\n");

        await session.log(`📋 Backlog loaded — ${filteredFeatures.length} feature(s), ${filteredBugs.length} bug(s)`);

        // Instruct the agent to layer in SQL todo state
        const sqlPrompt = `
---
**Agent: please add SQL todo state to the above board.**

Run this query and append the results under a "## 🗂️ SQL Todos" section:
\`\`\`sql
SELECT id, title, status, updated_at
FROM todos
ORDER BY
  CASE status
    WHEN 'in_progress' THEN 0
    WHEN 'pending'     THEN 1
    WHEN 'blocked'     THEN 2
    WHEN 'done'        THEN 3
    ELSE 4
  END,
  updated_at DESC;
\`\`\`

Format as a table: Status emoji | ID | Title | Updated. 
Status emoji: 🚧 in_progress, 📋 pending, 🔒 blocked, ✅ done.

Then present the combined board to the user.`;

        return board + sqlPrompt;
      },
    },
  ],
});

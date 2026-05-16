#!/usr/bin/env node
/**
 * packages/server/scripts/install-squad-extension.js
 *
 * Fallback patcher for repos that don't yet have the upstream Squad
 * extension-fragments mechanism (bradygaster/squad PR #1124).
 *
 * Once that PR lands, users get extension-fragments auto-loading from
 * ~/.squad/extensions/coordinator/. Until then, this script patches
 * .github/agents/squad.agent.md directly with a sentinel block.
 *
 * Usage:
 *   node scripts/install-squad-extension.js          # install
 *   node scripts/install-squad-extension.js remove   # uninstall
 *   squadboard squad-extension install               # via CLI (future)
 *   squadboard squad-extension remove                # via CLI (future)
 *
 * The sentinel block is idempotent: re-running install is a no-op if
 * the fragment is already present and unchanged.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const START_SENTINEL = '<!-- SQUADBOARD_EXTENSION_START -->';
const END_SENTINEL   = '<!-- SQUADBOARD_EXTENSION_END -->';

/** Resolve .github/agents/squad.agent.md from cwd upward */
function findSquadAgentMd() {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, '.github', 'agents', 'squad.agent.md');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Read package version from this package's package.json */
function packageVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Build the fragment block to inject */
function buildFragment(version) {
  return `${START_SENTINEL}
## Squadboard Integration (auto-injected by @sabbour/squadboard@${version})

If a \`~/.squadboard/config.json\` exists OR a \`.squadboard/project.json\` exists in the cwd,
you have Squadboard running alongside you. You can:

- Capture issues / chores / features via MCP tools (\`squadboard_capture\`,
  \`squadboard_report_bug\`, \`squadboard_add_feature\`, \`squadboard_add_chore\`,
  \`squadboard_backlog_status\`).
- Drive GitHub workflows via MCP tools (\`github_push_branch\`, \`github_open_pr\`,
  \`github_comment_issue\`, \`github_trigger_workflow\`, \`github_merge_pr\`) —
  see W18 Hockney work for the full github_* surface.
- Invoke ceremonies on issues via the SDK or HTTP API.

When the user asks to triage / log / track work, prefer Squadboard tools over
manual SQL or local files.

> ⚠️ This block is managed by @sabbour/squadboard. Run \`squadboard squad-extension remove\`
> to uninstall, or delete the START/END sentinels manually.
${END_SENTINEL}`;
}

function install() {
  const agentPath = findSquadAgentMd();
  if (!agentPath) {
    console.log('ℹ️  No .github/agents/squad.agent.md found in this directory tree.');
    console.log('   Squadboard extension not installed (no Squad coordinator present).');
    process.exit(0);
  }

  const version  = packageVersion();
  const content  = fs.readFileSync(agentPath, 'utf-8');
  const fragment = buildFragment(version);

  // Already installed?
  if (content.includes(START_SENTINEL)) {
    // Check if content matches current fragment
    const startIdx = content.indexOf(START_SENTINEL);
    const endIdx   = content.indexOf(END_SENTINEL) + END_SENTINEL.length;
    const existing = content.slice(startIdx, endIdx);
    if (existing === fragment) {
      console.log('✅ Squadboard extension already installed and up to date in squad.agent.md');
      process.exit(0);
    }
    // Upgrade: replace existing block
    const updated = content.slice(0, startIdx) + fragment + content.slice(endIdx);
    fs.writeFileSync(agentPath, updated, 'utf-8');
    console.log(`🔄 Squadboard extension upgraded in ${agentPath}`);
    process.exit(0);
  }

  // Append before the last line or at end
  const updated = content.trimEnd() + '\n\n' + fragment + '\n';
  fs.writeFileSync(agentPath, updated, 'utf-8');
  console.log(`✅ Squadboard extension installed in ${agentPath}`);
  console.log(`   (This is a fallback patcher. For the permanent solution, see bradygaster/squad PR #1124.)`);
}

function remove() {
  const agentPath = findSquadAgentMd();
  if (!agentPath) {
    console.log('ℹ️  No squad.agent.md found — nothing to remove.');
    process.exit(0);
  }

  const content = fs.readFileSync(agentPath, 'utf-8');
  if (!content.includes(START_SENTINEL)) {
    console.log('ℹ️  No Squadboard extension block found in squad.agent.md — nothing to remove.');
    process.exit(0);
  }

  const startIdx = content.indexOf(START_SENTINEL);
  const endIdx   = content.indexOf(END_SENTINEL) + END_SENTINEL.length;
  const updated  = (content.slice(0, startIdx) + content.slice(endIdx)).replace(/\n{3,}/g, '\n\n');
  fs.writeFileSync(agentPath, updated, 'utf-8');
  console.log(`✅ Squadboard extension removed from ${agentPath}`);
}

const cmd = process.argv[2];
if (cmd === 'remove') {
  remove();
} else {
  install();
}

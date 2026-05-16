# Kobayashi W18 — npm publish + Squad coordinator awareness
**Date:** 2026-05-15T22:42:29.855-07:00  
**Author:** Kobayashi (SDK Integrator)  
**Wave:** 18  
**Status:** Partial ship — packages ready, publish blocked on npm token; upstream PR filed

---

## P1 — npm publish audit + status

### packages/server → `@sabbour/squadboard@0.1.0`

**Audit findings + changes made:**

| Field | Before | After |
|-------|--------|-------|
| `name` | `@sabbour/squadboard-server` | `@sabbour/squadboard` |
| `private` | `true` | removed |
| `bin` | missing | `{ "squadboard": "./dist/cli/index.js" }` |
| `files` | missing | `["dist", "coordinator-fragment.md", "scripts/postinstall-coordinator-fragment.mjs", "README.md"]` |
| `publishConfig` | missing | `{ "access": "public" }` |
| `repository` | missing | `{ "type": "git", "url": "https://github.com/asabbour/squadboard.git" }` |
| `homepage` | missing | `https://github.com/asabbour/squadboard#readme` |
| `license` | missing | `"MIT"` |
| `prepublishOnly` | missing | `pnpm run build` |
| `postinstall` | missing | `node scripts/postinstall-coordinator-fragment.mjs` |
| duplicate `@electric-sql/pglite` | two entries | deduplicated to one |

**New artifacts created:**
- `packages/server/src/cli/index.ts` — main CLI dispatcher (mcp, start, --help, --version)
- `packages/server/coordinator-fragment.md` — copied from packages/squadboard (absorbed)
- `packages/server/scripts/postinstall-coordinator-fragment.mjs` — copied from packages/squadboard

**Related:** `packages/squadboard/package.json` renamed to `@sabbour/squadboard-coordinator-fragment` and marked private (role absorbed into packages/server). Root `package.json` renamed to `@sabbour/squadboard-monorepo` and marked private to avoid pnpm workspace name conflict.

### packages/squadboard-sdk → `@sabbour/squadboard-sdk@0.1.0`

**Audit findings + changes made:**

| Field | Before | After |
|-------|--------|-------|
| `private` | absent (publishable) | already correct |
| `license` | missing | `"MIT"` |
| `files` | missing | `["dist", "README.md"]` |
| `publishConfig` | missing | `{ "access": "public" }` |
| `repository` | missing | added |
| `prepublishOnly` | missing | `pnpm run build` |

### Build status

Both packages built clean:
- `packages/squadboard-sdk`: `tsc` → exit 0
- `packages/server`: `tsc` → exit 0 (CLI index compiled to `dist/cli/index.js` ✅)

### Pack dry-run outputs

**@sabbour/squadboard-sdk@0.1.0**
- 21 files · 19.4 kB packed · 70.9 kB unpacked
- Contains: `dist/{bundle,scribe,index}` — clean, no .ts source, no node_modules

**@sabbour/squadboard@0.1.0**
- 422 files · 645.1 kB packed · 3.2 MB unpacked
- Contains: `dist/`, `coordinator-fragment.md`, `scripts/postinstall-coordinator-fragment.mjs`
- Confirmed: `dist/cli/index.js` ✅, `dist/mcp/index.js` ✅, no .squad/, no node_modules/

### Publish status — BLOCKED

**Blocker:** npm auth token present in `~/.npmrc` returns HTTP 401 on `npm whoami`.

**To publish (human action required):**
```bash
npm login --registry https://registry.npmjs.org
# then:
cd packages/squadboard-sdk && pnpm publish --access public --no-git-checks
cd packages/server        && pnpm publish --access public --no-git-checks
```

**Todos filed:** `p1-publish-mcp-auth-needed`, `p1-publish-needs-human-trigger`

---

## P2 — Squad coordinator awareness

### Path taken: **Path A (upstream PR)** — FILED

Repo: `bradygaster/squad` (not `squad-duck` — the correct repo name confirmed via `gh repo view`)

**PR:** https://github.com/bradygaster/squad/pull/1124  
**Branch:** `sabbour:feat/extension-fragments → bradygaster:dev`

**What the PR adds:**

1. `squad.agent.md` — new `### Extension Fragments` section after MCP Integration:
   - Scan dirs: `~/.squad/extensions/coordinator/*.md` (user-global) and `<repo>/.squad/extensions/coordinator/*.md` (project-local)
   - Fragment YAML front matter: `name`, `version`, `extends: squad`, `inject_into`
   - Loading rules (silent skip, append-only, detection-guarded)
   - Anti-patterns documented
   - Source of Truth table updated with extension-fragments row

2. `docs/plugins/squad-coordinator-extensions.md` — full plugin-author guide:
   - Fragment format + style rules (coordinator voice, ≤200 lines, additive only)
   - Postinstall script pattern (idempotent, SHA-aware, always exits 0)
   - User override contract + upgrade story
   - @sabbour/squadboard as reference implementation

### Path B (fallback patcher) — ALSO SHIPPED

`packages/server/scripts/install-squad-extension.js` created:
- Patches `.github/agents/squad.agent.md` with sentinel block (`<!-- SQUADBOARD_EXTENSION_START -->` … `<!-- SQUADBOARD_EXTENSION_END -->`)
- Idempotent: upgrade-aware, sentinel-based
- `remove` command strips sentinel block
- Works independently of the upstream PR landing

---

## Extension fragment content (canonical)

Fragment injected by the squadboard postinstall or fallback patcher:

```
## Squadboard Integration (auto-injected by @sabbour/squadboard@X.Y.Z)

If a ~/.squadboard/config.json exists OR a .squadboard/project.json exists in the cwd,
you have Squadboard running alongside you. You can:

- Capture issues / chores / features via MCP tools (squadboard_capture, squadboard_report_bug,
  squadboard_add_feature, squadboard_add_chore, squadboard_backlog_status).
- Drive GitHub workflows via MCP tools (github_push_branch, github_open_pr,
  github_comment_issue, github_trigger_workflow, github_merge_pr) — see W18 Hockney work.
- Invoke ceremonies on issues via the SDK or HTTP API.

When the user asks to triage / log / track work, prefer Squadboard tools over manual SQL
or local files.
```

Note: `github_*` tools documented here are arriving same wave (W18) from Hockney. Fragment
references the expected final surface; if Hockney's work lands after this publish, update to
`@sabbour/squadboard@0.1.1` with the corrected tool list.

---

## Versioning strategy

- **@sabbour/squadboard-sdk**: `0.1.0` — library-first, SemVer. Breaking changes to `scribe.*` or `bundle.*` exports → minor bump until stable API declared.
- **@sabbour/squadboard**: `0.1.0` — distribution umbrella. Coordinator-fragment updates → patch bump. New MCP tools → minor bump.
- **Coordinator fragment version** in front matter tracks distribution package version. Postinstall script compares SHAs; no manual version check needed.
- Both packages published independently; `@sabbour/squadboard` declares `@sabbour/squadboard-sdk: "^0.1.0"` in prod dependencies (resolved from `workspace:*` by pnpm at publish time).

---

## q-item status

| Item | Status |
|------|--------|
| q3-squad-extension-pr | **IN FLIGHT** — PR #1124 filed at bradygaster/squad |
| q5-extension-fallback-patcher | **DONE** — `install-squad-extension.js` shipped |
| p1-publish-mcp-auth-needed | **PENDING** — human must re-auth npm then trigger |

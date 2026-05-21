# Hockney Agent History

**Last summarized:** 2026-05-20T13:26:25Z
**Archive:** See `history-archive.md` for full history

## Quick Summary

**Total waves:** 6

## Latest Activity

## 2026-05-20: MCP Electron IPC Exposure (L3/L5 pull-forward) — commit 6bbeafc61

Implemented MCP endpoint exposure in the Electron app layer:

- **ipc-channels.ts**: Added `mcp.getConnectionInfo`, `mcp.setDefaultProject`, `mcp.getDefaultProject` to allowlist.
- **ipc.ts**: Handlers that return `{ url, transport, port }` + live `/mcp/health` probe; persist default project ID to `{userData}/squadboard-mcp-config.json`; read it back.
- **preload/index.ts**: Added three MCP channels to `ALLOWED_CHANNELS`; removed stale L5 comment.
- **server-launcher.ts**: Reads `squadboard-mcp-config.json` from Electron userData on startup; injects `SQUADBOARD_DEFAULT_PROJECT_ID` into child process env if set.
- **menu.ts**: Added "Copy MCP URL" item under Help → copies `http://localhost:3000/mcp` to clipboard and shows confirmation dialog.

**Learnings:**
- `fetch()` is available natively in Node 18+ / Electron 28+; no need to import `node-fetch`.
- `app.getPath('userData')` is the right store for per-installation config that survives app updates.
- The vite config tsc errors (`@vitejs/plugin-react`, `@tailwindcss/vite`) are pre-existing and unrelated — filter when checking MY changes. Use `tsconfig.renderer.json` for renderer-only typecheck.
- `dialog` must be imported from `'electron'` even though it's unused in menu.ts for non-dialog calls; using `dialog.showMessageBox` is the correct approach for Electron notifications (vs `Notification` API which requires a different setup).

## 2026-05-20: P0 Fix Wave Deployment

Landed 3 critical backend fixes:

1. **SQL injection hardening** (commit 9fb89bcce): Replaced `sql.raw()` UUID array splice in `sweepExpiredStepLeases()` with Drizzle `inArray()` for parameterized queries.
2. **Workflow advancement atomicity** (commit 8813a41f7): Wrapped step completion, review-run creation, fan-out state changes, handoffs, and cursor advancement in a single Drizzle transaction.
3. **Worker hard timeout** (commit 16c1715fc): Added wall-clock timeout path for `runWorker` SDK runs, propagated timeout control into the Squad SDK bridge, introduced terminal `timed_out` state.

**Result:** Build ✅ All P0 fixes passing.

**Follow-up:** Pre-existing red suites are now CI blockers thanks to Kujan's vitest/typecheck gates. Hockney has no red signals from these fixes.

## 2026-05-20: Full Release Infrastructure — changesets + GitHub workflows — commit f0d228450

Implemented end-to-end release infrastructure for `sabbour/squadboard`:

- **Changesets installed**: `@changesets/cli` + `@changesets/changelog-github` added to devDependencies.
- **`.changeset/config.json`**: `linked` array ties all 4 public packages to same version; `baseBranch: dev`; `access: public`; private packages in `ignore` list.
- **Version bump**: All 4 public packages bumped `0.0.0 → 0.0.1` via `pnpm changeset version`; CHANGELOGs generated per package.
- **Root package.json**: Bumped to `0.0.1`; `npm:publish` scripts updated (removed `--tag prealpha`).
- **`release.yml`**: Replaces old `npm-publish.yml` — changesets action on push-to-main, OIDC provenance, opens Version Packages PR automatically.
- **`npm-publish-manual.yml`**: Old manual workflow preserved as emergency fallback.
- **`electron-release.yml`**: Builds DMG/NSIS/AppImage on tag push (matrix: macOS/Windows/Linux), uploads to GitHub Releases via `softprops/action-gh-release`.
- **`publishConfig`**: `prealpha` tag removed from all 4 public packages.
- **Git remote**: `origin` added → `https://github.com/sabbour/squadboard.git`.
- **Tag `v0.0.1`**: Created locally (push pending repo creation).

**Learnings:**
- `pnpm changeset init` validation rejects `ignore` entries that don't match any workspace package — root `package.json` with `private: true` is NOT a workspace package and should NOT be in the ignore list.
- EMU (Enterprise Managed User) accounts cannot create public GitHub repos or delete repos via `gh` CLI/API. Repo creation must happen via the `sabbour` personal account on github.com.
- The pnpm `virtualStoreDir` in `node_modules/.modules.yaml` is resolved relative to the `node_modules/` directory, not the project root. Value `.pnpm` (not `node_modules/.pnpm`) is correct.
- `pnpm changeset version` consumes the `.changeset/*.md` files and updates package versions + CHANGELOGs in one shot — no manual version edits needed after changeset is written.

## 2026-05-20: squad-sync write-mcp-config repair action

Added a new manual squad-sync repair action that writes `{projectRoot}/.copilot/mcp-config.json` for PostgreSQL-backed projects.

**Learnings:**
- To resolve `packages/server/dist/mcp/index.js` from a route module in both source and built layouts, anchor from the route directory and re-enter `dist/` explicitly (`path.resolve(__dirname, '..', '..', 'dist', 'mcp', 'index.js')`).
- The repair endpoint can safely merge `.copilot/mcp-config.json` by updating only `mcpServers.squadboard`, preserving sibling MCP servers and unrelated top-level keys.
- The requested `vitest --testPathPattern` invocation is stale on Vitest 4; use `vitest run <file...>` as the working equivalent for targeted squad-sync tests.

## 2026-05-21: squad-sync onboard-to-squadboard composite repair action

Added a single onboarding repair action that runs MCP config write, built-in ceremony seeding, markdown ceremony import, and one final `.squad/ceremonies.md` rebuild in sequence.

**Learnings:**
- The composite repair must reuse the existing named repair functions so the individual actions stay independently callable and behavior stays aligned.
- `rebuildCeremoniesMd(projectId, squadPath)` already emits delegation hints, so the composite path should call it once at the end instead of rebuilding after each sub-step.
- Keeping the composite action first in the status payload gives Settings a stable primary onboarding button without removing the lower-level repair actions.
- The onboarding drift check belongs on the existing sync status envelope so the UI can poll one read-only endpoint for both repair availability and reconciliation state.
- Filesystem-authoritative projects must skip the built-in ceremony DB query; their onboarding drift should report `ceremoniesSeeded: false` without implying `squad_storage` usage.
- A `.squadboard/.connected` marker cleanly separates "connected" lifecycle state from drift state; the status route can gate reconciliation on the marker while still preserving ceremonies as durable data.
- Disconnect must remove config only: strip the `squadboard` MCP entry and delete the connection marker, but leave ceremonies and regenerated `.squad/ceremonies.md` untouched.
- `checkedFiles` should describe the exact filesystem probes the UI cares about; pairing it with `lastCheckedAt` makes the status envelope self-describing without inventing client-side timers or path knowledge.


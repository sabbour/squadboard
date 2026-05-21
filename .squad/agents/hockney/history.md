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


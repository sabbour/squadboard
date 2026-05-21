# Keyser Agent History

**Last summarized:** 2026-05-20T13:26:25Z
**Archive:** See `history-archive.md` for full history

## Quick Summary

**Total waves:** 8

## Latest Activity


## W31 Wave 3 — npm Trusted Publisher Script

**Date:** 2026-05-20T16:53:45.998-07:00  
**Status:** Completed ✅

### Deliverables

- `scripts/configure-npm-trusted-publisher.ts` — Playwright automation to configure GitHub Actions OIDC trusted publisher on npmjs.com for all 4 public packages
- `scripts/README.md` — Release scripts documentation with first-time release checklist
- Root `package.json` — added `npm:configure-trusted-publisher` script

### Notes

- Used `@playwright/test` already present in `packages/e2e` (v1.49.0)
- Script uses text/role/label selectors (not brittle CSS), screenshots at each step, defensive fallbacks if npmjs UI changes
- Requires `NPM_USER`, `NPM_PASS`, optionally `NPM_OTP` env vars at runtime

## Learnings

- npmjs.com trusted publisher UI can be reached at `/package/{pkg}/access` — use text-based selectors as their markup changes frequently
- Always use `waitFor: networkidle` when navigating npmjs pages; they are SPA-heavy
- `ts-node` scripts in a pnpm monorepo need `import.meta.url`-based `__dirname` since `"type": "module"` is set in root package.json
- Squad Sync manual-bridge UX should keep the primary message low-jargon and put MCP/env details behind a collapsible manual-config section, with copyable init/manual snippets for fast setup
- When broker setup can be automated, reuse the existing squad-sync repair mutation from the panel and keep manual CLI/JSON steps collapsed as a fallback instead of the primary path
- First-run settings UX should elevate the composite happy path as a single primary CTA, while leaving granular repair/export controls below for advanced recovery and partial reruns


## W31 Wave 2 — Client Dead Code Cleanup

**Date:** 2026-05-20T13:26:25.229-07:00  
**Status:** Completed ✅

### Deliverables

Client-side dead code cleanup: 4 UI components removed

- `packages/client/src/api/ralph-monitor.ts`
- `packages/client/src/realtime/useOptimisticIssue.ts`
- `packages/client/src/pages/LiveSession.tsx`
- `packages/client/src/pages/StarterDetail.tsx`

**Skipped (still live):**
- `packages/client/src/api/workflows.ts` — imported by CardDetail.tsx

### Verification

- ✅ 245 client tests pass
- ✅ `pnpm --filter @sabbour/squadboard-client build` — clean
- ✅ Commit: a95151cf8

### Notes

All deletions verified by comprehensive codebase search. Workflows.ts retained despite deprecation marker. Work coordinated with parallel McManus/Kujan/Redfoot cleanup waves.

---

## W31 Wave 2 — Client Dead Code Cleanup

**Date:** 2026-05-20T13:26:25.229-07:00  
**Status:** Completed ✅

### Deliverables

Client-side dead code cleanup: 4 UI components removed

- `packages/client/src/api/ralph-monitor.ts`
- `packages/client/src/realtime/useOptimisticIssue.ts`
- `packages/client/src/pages/LiveSession.tsx`
- `packages/client/src/pages/StarterDetail.tsx`

### Verification

- ✅ 245 client tests pass
- ✅ `pnpm --filter @sabbour/squadboard-client build` — clean
- ✅ Commit: a95151cf8

## Learnings

### 2026-05-20 — Route-level code splitting
- Converted all 26 route-mounted screens in `packages/client/src/App.tsx` to `lazy()` imports.
- Put the `Suspense` boundary in `Layout.tsx` around `<Outlet />` so sidebar/topbar stay eager while page content loads behind `PageLoading`.
- Included route-only components outside `src/pages` (`LiveRunViewer`, dev-only `LoadingGallery`) in the lazy set because they are mounted exclusively by routes.

## Wave 3 — React.lazy() Code Splitting (2026-05-20T20:52:37Z)

### Delivery
- Wrapped all 26 route-mounted screens with lazy() in packages/client/src/App.tsx
- Added Suspense boundary around Layout's <Outlet />
- Reused PageLoading component for loading UI
- Shell components remain eager for first paint

### Commit
28e67f493 — Added React.lazy() code splitting to all 26 routed pages

### Status
✓ Complete — build verified, per-page chunks emitted, tests pass

---

## 2026-05-20 — Electron HashRouter + Window Icon

### Router Fix
- Electron loads the app via `file://` in production; the History API (`pushState`) doesn't work with `file://` URLs, causing `<Outlet>` to render nothing.
- Fix: detect Electron via `window.navigator.userAgent.toLowerCase().includes('electron')` and use `HashRouter` instead of `BrowserRouter`. `BrowserRouter` is kept for web.
- `HashRouter` uses `#/` prefix (e.g. `file:///app/index.html#/projects/123/board`) — transparent in Electron since there's no address bar.

### Icon Path Resolution
- Icon file created at `packages/electron/resources/icon.png` (copied from `packages/client/src/assets/squadboard-horizontal.png`).
- In dev (`isDev = true`): `__dirname` = `dist/main/`, so icon resolves via `resolve(__dirname, '../../resources/icon.png')` → `packages/electron/resources/icon.png`.
- In packaged builds: `process.resourcesPath` points to the `resources/` dir in the asar; icon loaded via `join(process.resourcesPath, 'icon.png')`.
- `electron-builder.yml` updated: `icon: resources/icon.png` and `resources/**/*` added to `files` array.

### Commit
fix: electron blank content (HashRouter) + window icon from logo

## 2026-05-21 — PGlite MCP Broker Setup Card

### Delivery
- Extended `SquadSyncStatusPanel.tsx` so broker setup surfaces in non-PostgreSQL mode with a lighter Copilot CLI connection card.
- Kept PostgreSQL manual-bridge UX intact, including the richer manual JSON fallback.
- Added frontend tests for the new PGlite render path and PostgreSQL/PGlite mutual exclusivity.

### Verification
- ✅ `pnpm --filter @sabbour/squadboard-client exec vitest run src/components/settings/__tests__/SquadSyncStatusPanel.test.tsx`
- ✅ `pnpm --filter @sabbour/squadboard-client build`

# Fry — Frontend Dev History

## Learnings

### 2026-05-14 — 4-issue UI fix batch

- **RoutingTierBadge**: The component's `tier` prop was typed as `RoutingTier` but callers can pass any `string` from API responses. Changed prop type to `string` and added `if (!cfg) return null` guard to prevent blank-page crashes on unknown tier values.
- **RouteTestResult / TestRoutingResult**: Field name mismatch between client (`ruleSummary`) and server (`matchedRule`). Always verify field names against actual server response shapes, not assumed ones. Fixed in both `Agents.tsx` interface and `api/routing.ts`.
- **useTestRouting GET → POST**: The hook was using GET with query-string params but the server endpoint expects POST with a JSON body. The `TestRoutingPanel` component in Agents.tsx already used `apiFetch` directly with POST (correct), but the shared hook was wrong.
- **Layout overflow hidden clips content**: `overflow: 'hidden'` on the `<main>` flex child clips scrollable page content. The correct pattern for a full-height scrollable flex child is `flex: 1; height: 0; overflow: auto`. Pages that manage their own internal scroll (like Agents) work correctly inside this.
- **globals.css was in `src/styles/`, not `src/`**: The CSS entrypoint is `packages/client/src/styles/globals.css`, not `src/index.css`. It already had `html, body, #root { height: 100%; }` correctly set.
- **Unused import = TS error**: Removing a type from an import when it's no longer used is required — `tsc -b` treats `TS6133` as a hard error in this project.

# Keyser — route-level code splitting

- **Date:** 2026-05-20T13:50:14-07:00
- **Scope:** `packages/client/src/App.tsx`, `packages/client/src/components/Layout.tsx`

## Approach

1. Replaced all static route-component imports in `App.tsx` with `lazy(() => import(...))`.
2. Covered all 26 route-mounted screens, including route-only components outside `src/pages`:
   - `components/runs/LiveRunViewer.tsx`
   - `components/loading/LoadingGallery.tsx` (dev-only route)
3. Added a single `Suspense` boundary around `Layout`'s `<Outlet />`.
4. Reused the existing `PageLoading` component for fallback UI so the shell stays visible while route chunks load.

## Exclusions

- **No routed pages excluded.**
- `Layout`, `RouteProgressBar`, and other shared shell/navigation components remain eager by design because they are needed on first paint.

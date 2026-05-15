# Keyser — Diagnostics & Heartbeat Routing Decision

**Date:** 2026-05-15  
**Author:** Keyser (Frontend Dev)  
**Phase:** 3

## Decision: Top-level routes for Diagnostics and Heartbeat

### Routes chosen

| Page        | Route                             | Rationale |
|-------------|-----------------------------------|-----------|
| Diagnostics | `/diagnostics`                    | Global view across all projects. Also available at `/projects/:id/diagnostics` to mirror the server endpoint (`GET /api/projects/:id/diagnostics`). |
| Heartbeat   | `/heartbeat`                      | System-level service; not project-scoped. Top-level matches service scope. |

### Alternatives considered

- **Nested under Settings tab** (`/projects/:id/settings/diagnostics`): Rejected. Diagnostics is operational, not configurational. A top-level route lets ops staff reach it directly without selecting a project.
- **Dashboard panel slot**: Rejected. Heartbeat and Diagnostics are verbose enough to warrant their own full pages, and the Dashboard is already dense.

### Nav placement

Added under a new **SYSTEM** section header in the sidebar, rendered above project-scoped groups. This matches the existing `OPERATIONS` / `WORK` / `SQUAD` grouping convention already in `Layout.tsx`.

### Project-scoped diagnostics

`/projects/:id/diagnostics` is added as a top-level route (not nested under Settings). The `useDiagnostics` hook reads `projectId` from `useParams` and switches between `/api/diagnostics` and `/api/projects/:id/diagnostics` automatically.

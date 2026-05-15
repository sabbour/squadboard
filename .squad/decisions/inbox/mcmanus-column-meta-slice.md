# Decision: Column Metadata Overlay (Phase 8 Vertical Slice)

**Date:** 2026-05-15  
**Author:** McManus (Lead Architect)  
**Status:** Shipped

---

## Decision

Ship column rename / describe / recolor via a new **overlay table** (`column_meta`), NOT by replacing the existing `column_status` enum yet.

---

## Why

- **Speed:** Touches one new table + one new drawer component. Ships in hours. Users get immediate value.
- **Safety:** Zero risk to the enum, zero migration of existing issue rows. Purely additive.
- **Forward-compatibility:** When Phase 8 proper lands, `column_meta` rows migrate into `board_columns` 1:1 — label, description, color all carry over directly. No data loss.
- **Separation of concerns:** The overlay decouples "what this column means to the team" from "what the workflow engine calls it internally."

---

## What Was Shipped

| Layer | File | What |
|-------|------|------|
| Schema | `packages/server/src/db/schema.ts` | `columnMeta` Drizzle table with `withTimezone: true` timestamps |
| Bootstrap | `packages/server/src/db/index.ts` | Idempotent `CREATE TABLE IF NOT EXISTS column_meta` DDL + unique index |
| API | `packages/server/src/routes/column-meta.ts` | GET / PATCH /:columnId / POST /reset — auto-seeds defaults on first access |
| Mount | `packages/server/src/index.ts` | Mounted at `/api/projects/:projectId/columns` |
| Client hook | `packages/client/src/api/columns.ts` | `useColumnMeta`, `useUpdateColumn`, `useResetColumns` |
| Board render | `KanbanBoard.tsx` | Uses metadata for label + color; falls back to hardcoded defaults |
| Column render | `KanbanColumn.tsx` | 4px colored left border; Fluent2 `<Tooltip>` on description hover |
| Settings UI | `ColumnSettingsPanel.tsx` | Drawer with Input + Textarea + 8-swatch color picker per column |
| Board page | `Board.tsx` | Gear button (`<Settings24Regular>`) opens the drawer |

---

## Default Seeds

| columnId | label | color |
|----------|-------|-------|
| backlog | Backlog | #6e7681 |
| todo | To Do | #1f6feb |
| in_progress | In Progress | #fb950b |
| in_review | In Review | #8957e5 |
| done | Done | #238636 |

Color convention: strict `#[0-9a-fA-F]{6}` enforced server-side.

---

## Out of Scope (This Slice)

- Column reorder (position stored but not exposed)
- Add / remove columns (enum still rules)
- Multi-board per project
- `board_columns` table replacing the enum
- Board presets
- `pickup_behaviour` per column
- Default workflow per column / scope
- Label-to-workflow-column defaults

All of the above are Phase 8 proper — a separate, larger workstream.

---

## Forward-Compatibility Note

When Phase 8 lands and the `board_columns` table replaces the enum:

```sql
INSERT INTO board_columns (project_id, column_id, label, description, color, position, ...)
SELECT project_id, column_id, label, description, color, position
FROM column_meta;
```

The `column_meta` table can then be dropped. User data (labels, descriptions, colors) survives.

# Decision: Per-Project Kanban Column Add/Remove

**Author:** Kobayashi (Squad SDK Integrator)  
**Date:** 2026-05-15T09:48:00.000-07:00  
**Requested by:** Ahmed Sabbour  
**Status:** Shipped — commits `1a4c5d46` (Batch A) · `d87c8f45` (Batch B)

---

## What changed

`column_meta` is now the single source of truth for what columns a project has.
The hard-coded `column_status` Postgres enum is gone; `issues.status` is plain `TEXT`.
Users can add and remove columns per project. The five defaults are still seeded on
first access, but are no longer the only legal set.

---

## New endpoint signatures (for Keyser to build against)

### 1. `POST /api/projects/:projectId/columns`
Create a new column.

**Request body:**
```json
{
  "columnId": "triage",          // required — ^[a-z0-9_-]{1,40}$
  "label": "Triage",             // required — 1–80 chars
  "color": "#d29922",            // required — #rrggbb
  "description": "...",          // optional string|null
  "position": 2,                 // optional integer — inserts here, shifts others
  "semantic": "backlog"          // optional — see enum below; default "custom"
}
```

**Response 201:**
```json
{ "ok": true, "data": { <ColumnMeta> } }
```

**Errors:** 400 (invalid field), 409 (columnId already exists for project).

---

### 2. `DELETE /api/projects/:projectId/columns/:columnId?reassignTo=<columnId>`
Delete a column.

- If the column has **zero issues**, deletes immediately.
- If the column has **N issues** and `reassignTo` is absent → **409**:
  ```json
  { "ok": false, "error": "Column has N issues; pass reassignTo=<columnId>", "count": N }
  ```
- If `reassignTo` is present, atomically moves all issues to that column then deletes.
- Cannot delete the last column in a project → **409**.
- If the deleted column was `is_default=true`, auto-promotes the lowest-position
  remaining column to `is_default=true`.

---

### 3. `PATCH /api/projects/:projectId/columns/reorder`
Atomically rewrite all column positions.

**Request body:**
```json
{ "order": ["backlog", "triage", "todo", "in_progress", "in_review", "done"] }
```

**Response 200:**
```json
{ "ok": true, "data": [ <ColumnMeta>[] ordered by new position ] }
```

**Error:** 400 if `order` is missing, empty, or contains non-strings.

---

### 4. Extended: `PATCH /api/projects/:projectId/columns/:columnId`
Now also accepts `semantic` and `isDefault`.

```json
{
  "label": "...",
  "description": "...",
  "color": "#rrggbb",
  "semantic": "done",
  "isDefault": true    // atomically clears is_default on all other columns first
}
```

---

### 5. `GET /api/projects/:projectId/columns` (unchanged path, extended response)
Now returns `semantic` and `isDefault` on every item:

```json
{
  "ok": true,
  "data": [
    {
      "id": "...", "columnId": "backlog", "label": "Backlog",
      "description": "...", "color": "#6e7681", "position": 0,
      "semantic": "backlog", "isDefault": true
    }
  ]
}
```

---

## Semantic enum — original 5 mapped

| original `column_id` | new `semantic` |
|----------------------|----------------|
| `backlog`            | `backlog`      |
| `todo`               | `ready`        |
| `in_progress`        | `in_progress`  |
| `in_review`          | `review`       |
| `done`               | `done`         |
| any custom column    | `custom`       |

`semantic` is used for analytics roll-ups, GitHub sync label mapping, and dashboard
"what does done mean" semantics. Multiple columns can share the same semantic.

---

## Migration safety (enum → text on a live DB)

The bootstrap DDL (`db/index.ts → bootstrapSchema`) runs on every server start.
The migration block is:

```sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'column_status') THEN
    ALTER TABLE issues ALTER COLUMN status TYPE TEXT USING status::TEXT;
    ALTER TABLE issues ALTER COLUMN status SET DEFAULT 'backlog';
    DROP TYPE column_status;
  END IF;
END $$;
```

- **Idempotent:** the `IF EXISTS` guard means it's a no-op once applied.
- **In-place:** Postgres casts enum values to their text equivalents automatically.
  No row updates needed — `'backlog'::column_status` becomes `'backlog'::text`.
- **Zero downtime risk on embedded Postgres:** the server owns the embedded PG
  instance; migration runs before any route handler accepts traffic.
- **`ADD COLUMN IF NOT EXISTS`** guards on `semantic` and `is_default` are
  equally idempotent.

---

## `reassignTo` contract for DELETE

- `reassignTo` is a **query parameter**, not a body field.
  `DELETE /api/projects/:projectId/columns/:columnId?reassignTo=todo`
- The target column must exist in the same project; 400 if not.
- All affected issues are moved atomically inside a transaction before the column row
  is deleted — no orphan issues possible.

---

## Open question for Keyser: reorder UX

**Recommendation:** drag-and-drop handles (grip icon on each column chip in the
settings panel). This is the most natural affordance — users expect to drag columns
on a Kanban board. A number input works for accessibility fallback but should not be
the primary interface.

The `PATCH /reorder` endpoint takes a full `order` array, so either drag-and-drop
(build the new order client-side then send one request) or a number input (send
on blur) both integrate cleanly. **Final call is Keyser's.**

---

## Client hooks shipped (packages/client/src/api/columns.ts)

| hook | description |
|------|-------------|
| `useCreateColumn(projectId)` | POST /columns |
| `useDeleteColumn(projectId)` | DELETE /:columnId?reassignTo= |
| `useReorderColumns(projectId)` | PATCH /reorder |
| `useUpdateColumn(projectId)` | PATCH /:columnId (extended) |
| `useColumnMeta(projectId)` | GET / (extended) |
| `useResetColumns(projectId)` | POST /reset (unchanged) |

All mutations invalidate `['column-meta', projectId]` on success.

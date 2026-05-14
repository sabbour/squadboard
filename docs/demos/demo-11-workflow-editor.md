# Demo 11 — Workflow Editor

> **Status:** 🔴 Not started  
> **Layer:** Board UI  
> **Estimated session:** ~10 minutes to run through

## What this demo shows

A Monaco YAML editor + React Flow graph visualization lets you compose workflows without touching `.md` files. Drag steps, tweak parameters, see a live preview of the DAG, and save versioned snapshots.

## Prerequisites

- Demo 6 complete (workflows working)
- `npx @sabbour/squadboard up` running
- At least one workflow (`.squad/workflows/simple.yaml`)

## Run it

```bash
# Step 1: Open a workflow in the editor
# Click Settings → Workflows → "Edit" next to a workflow name

# Step 2: See the Monaco YAML editor on the left
# The workflow YAML is editable; autocomplete hints appear

# Step 3: On the right, see the React Flow DAG
# Nodes represent steps; edges show progression

# Step 4: Drag a node in the DAG
# The YAML updates to reflect the new order (if reordering is allowed)

# Step 5: Click "Save as Version"
# Create a timestamped snapshot (e.g., "simple@2026-05-14T10:00Z")

# Step 6: Switch to a different version
# Dropdown at the top: "simple@latest" → select an older snapshot
```

## What to observe

- YAML is syntax-highlighted and validated in real-time
- Invalid YAML is flagged immediately (red underline)
- The DAG refreshes when you change YAML
- Versioning is automatic; old versions are never deleted
- The template gallery shows built-in examples (route → run → approve)

## Known gaps (hacking phase)

> React Flow DAG editing (drag-to-reorder) is TBD. Template gallery is stubbed (no auto-generate yet). Syntax hints are basic.

---
*Auto-generated stub. Last updated: 2026-05-14. Update when demo ships.*

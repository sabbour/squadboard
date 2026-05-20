---
title: Ceremonies
description: Automation workflows, execution history, and audit trails
---

# Ceremonies

**Route:** `/projects/:id/ceremonies` (and related sub-routes)

Automation workflows for your project. Create, run, review, and audit ceremonies (workflow definitions and executions).

## Overview

Ceremonies are how you automate multi-agent work. A ceremony is a sequence of steps (agent runs, tool invocations, reviews) triggered by events or schedules.

Ceremonies include:
- **Workflow definitions** — The steps and routing (create/edit)
- **Executions/runs** — History of workflow runs with logs
- **Reviews** — Approve draft ceremonies before publishing
- **Audit** — Diagnostics and orphan detection

Related note: The `/projects/:id/workflows` route is deprecated; use ceremonies instead.

## Ceremony List

**Route:** `/projects/:id/ceremonies`

Central list of all ceremonies in the project.

### List View

DataGrid showing all ceremonies:
- Ceremony name
- Trigger type (manual, schedule, GitHub webhook, etc.)
- Kind (automation, review, etc.)
- Origin (built-in, YAML, Conjure, user-created)
- Status (active, draft, archived)
- Last modified date
- Run count

### Badges
Each ceremony shows:
- **Trigger badge** — What triggers it (Manual, Cron, Webhook, etc.)
- **Kind badge** — Type of ceremony
- **Scope badge** — System or project scope
- **Origin badge** — Where it came from

### Actions

**Create ceremony**
- Click "New ceremony" button
- Opens [CeremonyEditor](#ceremony-editor) for creating from scratch

**Review drafts**
- Click "Review drafts" CTA at top (if drafts pending)
- Opens [CeremoniesReview](#ceremonies-review)

**View audit trail**
- Click "Audit" link to open [CeremonyAudit](#ceremony-audit)

**Open ceremony**
- Click ceremony row to open editor
- Edit ceremony definition and save changes

**View runs**
- Click "Runs" link on ceremony row to open [CeremonyRuns](#ceremony-runs)

## Ceremony Editor

**Route:** `/projects/:id/ceremonies/new` or `/projects/:id/ceremonies/:id`

Create or edit ceremony workflow definitions.

### Create Mode Hero

When creating new:
- Prominent "Describe your ceremony" input
- Paste a narrative workflow description (plain English)
- AI formulates the ceremony definition (optional)
- Or switch to manual form to build step-by-step

### Ceremony Configuration

**Basic details:**
- **Name** — Ceremony title
- **Description** — What it does
- **Ceremony type** — Automation, review, etc.

**Trigger configuration:**
- **Trigger kind** — When it runs (manual, schedule, webhook, event-based)
- **Trigger config** — Specific trigger details (cron expression, webhook path, etc.)

Cron preview shows human-readable schedule (e.g., "Every Monday at 9 AM").

### Ceremony Steps

Visual or code editor for defining workflow steps:

**Step types:**
- **Agent run** — Invoke an agent with a prompt
- **Tool run** — Call a specific tool
- **Approval** — Require human review
- **Conditional** — Branch based on output

**Per step:**
- Order/sequence
- Input (prompt, params)
- Output variable name (for use in later steps)
- Error handling (retry, skip, fail)

### Editor Tabs

**Code tab** — YAML representation of the ceremony definition. Edit directly if you prefer.

**Visual tab** — Drag-and-drop builder for ceremony steps. Easier for complex workflows.

Both tabs sync; edit in either one.

### Save & Template

**Save ceremony**
- Click "Save" to commit ceremony definition
- Drafts are saved but not yet active

**Save as template**
- Click "Save as template" to make this ceremony reusable
- Appears in [Templates](./templates.md) for applying to other projects

**Validate ceremony**
- Click "Validate" to check syntax and logic
- Shows errors/warnings before running

**Export YAML**
- Click "Export YAML" to download ceremony definition as `.yaml` file
- Portable; can commit to version control or share

**Run now**
- Click "Run now" button to execute ceremony immediately
- Useful for testing before scheduling

## Ceremony Runs

**Route:** `/projects/:id/ceremonies/:id/runs`

Execution history and logs for a specific ceremony.

### Run List

Table showing all executions of this ceremony:
- Run ID
- Start time and duration
- Trigger source (who/what triggered it)
- Status (running, completed, failed)
- Output summary (if available)

### Run Detail

Click any run row to expand and see:
- Full run timeline
- Step-by-step execution logs
- Errors or warnings
- Output artifacts

**Actions per run:**
- **Back to ceremony** — Return to ceremony editor
- **Refresh** — Reload run status (useful while running)
- **Open live log** — If run is currently executing, watch live in [Live Run Viewer](./live-run-viewer.md)
- **View ceremony** — Return to [CeremonyList](#ceremony-list)

### Step Logs

Each step in the ceremony run has a log entry showing:
- Step name
- Duration
- Status (ok, warning, error)
- Input (what was passed in)
- Output (what it produced)
- Linked agent event logs (if applicable)

## Ceremonies Review

**Route:** `/projects/:id/ceremonies/review`

Review queue for translated ceremony drafts before publishing.

### Draft List (Left Sidebar)

Ceremonies pending review, sorted by newest first:
- Ceremony name
- Translation status (translated, pending, error)
- Creator name
- Created timestamp

Click any draft to review it.

### Review Pane (Right)

Side-by-side comparison of:
- **Left:** Original narrative (English description) or prose input
- **Right:** Generated YAML ceremony definition

### Actions

**Activate draft**
- Click "Activate" to publish the ceremony
- Ceremony becomes active and can be triggered

**Edit ceremony**
- Click "Edit" to open ceremony in [CeremonyEditor](#ceremony-editor)
- Make adjustments, then save

**Discard draft**
- Click "Discard" to reject this draft
- Draft is archived; you can create a new translation

**Retry translate**
- If translation error occurred, click "Retry" to re-generate YAML from narrative
- Useful if AI translation was incomplete

## Ceremony Audit

**Route:** `/projects/:id/ceremonies/audit`

Diagnostics and observability for ceremonies. See orphaned workflow runs, dead ceremony references, and origin analysis.

### Summary Stats

Overview cards showing:
- Total ceremonies
- Total runs
- Success rate
- Average duration

### Breakdown Tables

**By origin:**
- Built-in ceremonies
- YAML-defined ceremonies
- Conjure-generated ceremonies
- User-created ceremonies
- Count and success rate per origin

**By trigger:**
- Manual triggers
- Scheduled (cron) triggers
- Webhook triggers
- Event-based triggers
- Count per trigger type

**By status:**
- Active ceremonies
- Draft ceremonies
- Archived ceremonies

### Orphan Detection

**Orphaned runs** — Runs from ceremonies that no longer exist. Listed with:
- Run ID
- Original ceremony name
- Run time and result
- Option to archive

**Dead references** — Ceremonies referencing agents/tools that no longer exist. Listed with:
- Ceremony name
- Missing resource
- Impact (runs will fail if triggered)

### Filters

Optional UI filters:
- **Origin filter** — Show all, built-in only, YAML, Conjure, user
- **Status filter** — Active, draft, archived
- **Date range** — Narrow to recent ceremonies

### Actions

**Back to ceremonies**
- Return to [CeremonyList](#ceremony-list)

**Retry load**
- Reload diagnostics (if data seems stale)

**Fix orphan**
- Click an orphaned run to archive it
- Helps clean up stale run records

## Templates (Ceremonies Tab)

**Route:** `/projects/:id/ceremonies/templates`

Also see [Templates](./templates.md) page for full documentation.

Under Ceremonies tab, you can:
- Browse pre-built ceremony templates
- Apply a template to create a ceremony in this project
- Save current ceremonies as templates for reuse

## Related

- [Board](./board.md) — See issues that ceremonies route/process
- [Agents](./agents.md) — Configure agents that ceremonies invoke
- [Tools](./tools.md) — Tools that ceremonies can call
- [Templates](./templates.md) — Save and reuse ceremony definitions
- [Flow](./flow.md) — Visualize ceremony execution (swimlane view)

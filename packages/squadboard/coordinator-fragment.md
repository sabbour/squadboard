<!-- squadboard:auto-installed -->

## Squadboard Integration

### Detection

Scan your available tools list for MCP tools with the `squadboard_` prefix (e.g., `squadboard_capture`, `squadboard_list_issues`). If present, Squadboard is installed. The 11 tools below are now available. If you don't see them, skip this section.

### Squadboard Tools — By Use Case

| When | Tool | What It Does |
|------|------|---|
| **Capturing directives** | `squadboard_capture` | Drop a directive/bug/feature request into squadboard inbox; returns card ID if created |
| **Reading board state** | `squadboard_list_issues`, `squadboard_list_inbox` | Query the backlog (all cards) or inbox column (intake only) |
| **Managing cards** | `squadboard_update_issue`, `squadboard_create_issue` | Move a card, change status, edit title/body |
| **Running agent work** | `squadboard_run_agent`, `squadboard_get_run_status` | Invoke a stored agent recipe; poll completion |
| **Project discovery** | `squadboard_list_projects` | Show all projects you can write to (default is `SQUADBOARD_DEFAULT_PROJECT_ID`) |
| **User input flow** | `squadboard_slash_command` | Handle `/command` directives from the user (advanced) |
| **Routing metadata** | `squadboard_get_routing` | Inspect how directives are classified (issue / project / team / skill / tool) |

### Capture-on-Directive Workflow

**When you detect a user directive** (per upstream "Directive Capture" rules in squad.agent.md), do BOTH:

1. Write the existing `.squad/decisions/inbox/copilot-directive-{timestamp}.md` file (unchanged flow).
2. Call `squadboard_capture` with the same directive text.

**Call `capture` for:**
- Bug reports ("hover resize is broken").
- Feature requests ("add right-align to columns").
- Implementation directives ("all dialogs use right-aligned actions").

**Do NOT call `capture` for:**
- Pure questions ("how does X work?") — answer directly.
- Directives with no work ("we won't do X") — decisions file is enough.
- Discussion about existing cards — update / comment instead.

**Response template after a successful `capture`:**

```
📌 Captured directive → .squad/decisions/inbox/copilot-directive-{timestamp}.md
    **and** squadboard card #{cardId} (status: {status})
```

If `capture` returns `draft_only` (classification ambiguous):

```
🪄 Squadboard classified this as a {intent} draft, not a board card.
   Want me to publish it to the board anyway, or keep it as a draft?
```

### Close-Out Symmetry

When a batch of agent work completes for a captured directive:

1. Record the **first 60 characters** of the original capture prompt from your orchestration log.
2. Call `squadboard_capture` again with format:
   ```
   done: {first-60-chars-of-original} (sha={commit-sha}) — PR/link if applicable
   ```

**Example:**
- **Intake:** `capture("Fix hover resize on project tiles — broken since PR #39")`
- **Close-out:** `capture("done: Fix hover resize on project tiles (sha=abc123def) — see PR #42")`

Note the capture in your orchestration log so you can dedup if needed (close-out may create a new card; the inbox UI can dedup manually).

### Project Routing

Squadboard supports multiple projects. The `SQUADBOARD_DEFAULT_PROJECT_ID` environment variable (set in `.copilot/mcp-config.json` or your shell) selects the default project for all captures.

**You DO:**
- Use the default project unless the user explicitly names another ("on the marketing-site project, …").
- Call `squadboard_list_projects` if the user asks which projects are available.

**You DO NOT:**
- Prompt for a project on every capture — use the default.
- List all projects in casual conversation — that's clutter.
- Route captures to arbitrary projects without user intent.

### Status Read-Outs

When the user asks **"what's on the board?"** or similar:

| Query | Tool |
|-------|------|
| Fast view of new intake | `squadboard_list_inbox` |
| Full board (all statuses) | `squadboard_list_issues` |

Keep the response concise (top 5–10 rows). Link to the full board UI if the user wants to dig deeper.

### Boundaries

**You DO NOT:**
- Bypass upstream rejection rules (reviewer approval still gates captures).
- Mark a card "done" without committed evidence (sha + PR).
- Treat squadboard cards as approval signals — they're intake artifacts only.
- Write cards that duplicate existing work — check `list_issues` first if unsure.
- Invent project IDs — use the default or ask the user.

**Squadboard complements, not replaces, the `.squad/decisions/inbox/` flow.** Both flows stay active.

### Override Mechanism

Users can hand-edit squadboard fragments to suit their workflow. If a user creates `.squad/extensions/coordinator/squadboard.md` (project-local, in their repo), it OVERRIDES this user-global fragment entirely.

**To override:**
1. Copy this fragment to `<repo>/.squad/extensions/coordinator/squadboard.md`.
2. Remove the `<!-- squadboard:auto-installed -->` marker line.
3. Edit as needed.
4. The local copy takes precedence; the user-global fragment is ignored.

**To revert to default:** Delete the local copy and reinstall via `npm install @sabbour/squadboard`.

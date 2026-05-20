---
title: Settings
description: Project configuration hub with 10 sections
---

# Settings

**Route:** `/projects/:id/settings?section=SECTION_NAME`

Comprehensive project configuration. 10 sections covering everything from display prefs to GitHub integration, team management, and destructive operations.

## Navigation

Left sidebar shows all 10 sections. Click any section to jump to it. Or use URL parameter `?section=GENERAL`, etc.

## 1. General

**Project identity and defaults:**
- **Project name** — Display name for the project
- **Description** — What this project is for (optional)
- **Default model** — LLM model all agents use by default (unless overridden per agent)
- **Created date** — Read-only timestamp
- **Project ID** — Unique identifier (read-only; used in URLs and API)

**Actions:**
- Update name, description, or default model
- Save changes
- Changes apply immediately

## 2. Display

**Browser-local UI preferences:**
- **Route progress bar** — Show/hide progress bar on page navigation
- **Dark mode** — Enable dark theme (if available)
- **Font size** — Adjust UI text size

Preferences are stored in your browser's local storage. Different users can have different preferences for the same project.

## 3. MCP Config

**MCP transport configuration for this project:**
- **SQUADBOARD_SQUAD_STORAGE_PROVIDER** — Where `.squad/` folder syncs (filesystem vs. PostgreSQL)
- **Environment variables** — Set project-specific env vars for MCP servers

Shows current values and allows editing.

**Impact:** Affects how agents route and how the board persists state.

## 4. Squad Sync

**Integration with Squad storage provider:**
- **Storage provider** — Current backend (PGlite, PostgreSQL, filesystem)
- **Sync status** — Ready, Manual bridge, or Needs repair
- **Last sync** — When state was last synchronized
- **Sync conflicts** — Any known conflicts shown here

**Actions:**
- **Manually sync** — Force a sync to the provider
- **Repair sync** — If status shows "Needs repair", click to attempt repair
- View sync logs (if available)

Shows status badge and hint about what to do next.

## 5. Budget

**Spending limits and cost controls:**
- **Monthly budget cap** — Max USD spend per month (e.g., $500)
- **Alerts** — Notify when spending reaches 50%, 80%, 100% of budget
- **Current MTD** — How much you've spent this month (read-only)
- **Forecast** — Projected end-of-month spend if current rate continues

**Actions:**
- Set or update budget cap
- Enable/disable budget alerts
- View spending trends

When budget is exceeded, agents can be configured to fail safely or ask for approval.

## 6. Review Policy

**Approval gates and review requirements:**
- **Require review for cards in "In Review"** — Cards must be approved before moving to Done
- **Review timeout** — How long reviewers have to approve (hours)
- **Reviewers** — Who can approve (team members dropdown)
- **Auto-approve after timeout** — Automatically move to Done if not reviewed (optional)

**Actions:**
- Add/remove reviewers
- Update timeout and auto-approve settings
- Save changes

Policies are enforced when cards reach the In Review column.

## 7. Portability

**Export and import project configurations:**

**Export project:**
- Click "Export project" to download project bundle
- Includes: team, ceremonies, tools, skills, settings
- Format: `.zip` file
- Use to backup or share with other projects

**Import project:**
- Click "Import project" to upload previously exported `.zip`
- Replaces current project config
- **Warning:** Backup before importing
- Shows preview of what will be imported

**Save project as template:**
- Click "Save as template" to make this project reusable
- Appears in [Templates](./templates.md) for other projects
- Useful for standardizing across teams

## 8. Backup & Restore

**Backup and restore mechanisms:**
- **Automatic backups** — Show backup history if enabled
- **Manual backup** — Click to trigger immediate backup
- **Restore from backup** — Select a previous backup to restore
- **Backup location** — Where backups are stored (read-only)

Shows:
- Backup frequency (if automatic)
- List of available backups with timestamps
- Size of each backup

**Actions:**
- Create backup now
- Restore to a previous backup (with confirmation)

## 9. GitHub

**GitHub integration configuration:**
- **GitHub repository** — Link to your Squad repo (if any)
- **Webhook URL** — Endpoint for GitHub events
- **Webhook events** — Which GitHub events trigger Squadboard actions (issues, PRs, etc.)
- **Token status** — Whether GitHub auth is active (if configured)

**Actions:**
- Configure GitHub webhook
- View recent webhook deliveries (if any)
- Test webhook
- Enable/disable GitHub integration
- Link/unlink GitHub account

Shows recent activity from GitHub: issues created, PRs opened, etc.

## 10. Danger Zone

**Destructive operations. Requires confirmation.**

### Delete Project
Permanently remove this project from Squadboard.

**What happens:**
- Project is deleted from this Squadboard instance
- `.squad/` folder remains intact on your filesystem
- Historical runs and logs are archived
- Cannot be undone; backup first

**Confirmation:**
- Checkbox: "I understand this cannot be undone"
- Type project name to confirm
- Click "Delete project"

**Optional:**
- **Delete project folder** — Also delete the local `.squad/` folder
- **Uncheck** if you want to keep the folder and re-connect later

### Reset Data
Clear all project data (cards, runs, ceremonies) while keeping team and config.

**What happens:**
- Board is cleared (cards archived)
- Run history deleted
- Ceremony records cleared
- Agent roster, skills, tools, settings preserved

**Confirmation:**
- Checkbox required
- Click "Reset data"

Useful if you want a fresh start within the same project.

## Related

- [Agents](./agents.md) — Manage team members
- [Skills](./skills.md) — Configure project skills
- [Tools](./tools.md) — Configure project tools
- [Costs](./costs.md) — View cost history against budget
- [Templates](./templates.md) — Save project as template

---
title: Templates
description: Reusable ceremony, team, and project templates
---

# Templates

**Route:** `/projects/:id/ceremonies/templates`

Template catalog for ceremonies, teams, and projects. Import pre-built templates or create your own from existing configurations.

## Overview

Templates let you package and reuse common configurations:
- **Ceremony templates** — Workflow definitions for automation
- **Team templates** — Agent rosters and skills
- **Project templates** — Entire project configurations (team + ceremonies + tools)

Browse, apply, and manage templates through a tabbed interface.

## Navigation

**Three tabs:**
1. **Ceremony Templates** — Pre-built workflow templates
2. **Teams** — Agent roster templates
3. **Projects** — Full project templates

Switch tabs to see different template types.

## Ceremony Templates Tab

### Browse Pre-Built Templates

Grid of ceremony templates, each showing:
- Template name
- Category (automation, review, triage, etc.)
- Description
- Preview of included steps
- Apply button

### Create from Existing

To save a ceremony as a template:
1. Create or edit ceremony in [Ceremony Editor](./ceremonies.md#ceremony-editor)
2. Click "Save as template" button
3. Template appears in this tab and is available for other projects

### Apply Template

Click "Apply" on any ceremony template:
- Creates a ceremony in your project based on the template
- Template is cloned (changes to template don't affect your ceremony)
- You can customize it before saving

### Delete Template

Click delete icon to remove a template from your catalog. Only deletes the template, not ceremonies created from it.

## Teams Tab

### Browse & Apply Team Templates

Grid of agent roster templates:
- Team name (e.g., "Triage Squad", "Full Stack Team")
- Member count
- Skills summary
- Apply button

### Apply Team Template

Click "Apply":
- Imports all agents from template into your project
- **Warning:** Replaces your current team if you confirm
- Review members before confirming

### Create Team Template

To save your current team as a template:
1. Go to [Agents](./agents.md) page
2. Click "Save team as template"
3. Template appears in Teams tab

### Import Team from JSON

Click "Import team" button:
- Upload `.json` file with team roster
- File format: exported team from [Agents](./agents.md)
- Imported team appears as a new template

## Projects Tab

### Browse Project Templates

Grid of full project templates:
- Project name
- Contents summary (team size, ceremony count, tools count)
- Region/scope badge (if applicable)
- Deploy/apply button

### Apply Project Template

Click "Apply":
- Creates a new project based on template
- Clones all team, ceremonies, tools, and settings
- Opens new project dashboard

### Create Project Template

To save current project as template:
1. Go to [Settings](./settings.md)
2. Under "Portability", click "Save project as template"
3. Name the template
4. Template appears in Projects tab

## Drag-Import Zone

At the bottom of the Templates page is a **drag-drop zone** for importing templates:

**Supported formats:**
- `.yaml` or `.yml` — Ceremony definition
- `.json` — Team roster or project bundle
- `.zip` — Packaged project (contains multiple files)

**Drag file(s) into the zone:**
- System validates file format
- Shows confirmation of what will be imported
- Confirms before importing

**After import:**
- Success banner shows
- Template appears in appropriate tab (Ceremonies/Teams/Projects)

## Scope Filter

Some template libraries allow filtering:
- **All templates** — Browse entire library (if shared across organization)
- **My templates** — Show only templates you created
- **Organization templates** — Show templates shared by your org

Default is "All templates".

## Template Preview

Click any template card to see more detail:
- Full description
- Detailed contents list
- Creator/source
- Version or last modified date
- Actions: Apply, Delete, Export

## Export Template

Click "Export" to download a template:
- Downloads as `.yaml` (ceremonies), `.json` (teams), or `.zip` (projects)
- Can commit to version control
- Share with other teams or projects

## Related

- [Ceremonies](./ceremonies.md) — Create ceremonies to save as templates
- [Agents](./agents.md) — Create teams to save as templates
- [Settings](./settings.md) — Portability section for project templates
- [Apps](./apps.md) — Install complete apps (similar to project templates)

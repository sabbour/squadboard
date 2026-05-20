---
title: Project Picker
description: Create or connect Squad projects to Squadboard
---

# Project Picker

**Route:** `/`

Your entry point to Squadboard. Create new projects, connect to existing `.squad/` folders, browse project templates, or delete projects you no longer need.

## Overview

The Project Picker lists all projects available to you in this Squadboard instance. Each project is shown as a card with its name, location, and key metadata. You can filter, sort, and search projects to find what you're looking for.

Storage model: Projects map to `.squad/` folders on your filesystem or in a Squad workspace. Squadboard doesn't create `.squad/` folders—it connects to existing ones or lets you create new projects from templates.

## Project List

**Card layout** shows for each project:
- Project name
- Filesystem path to `.squad/` folder
- Creation date
- Test project badge (if applicable)

**Search and filter** at the top:
- **Search box** — Find projects by name or path
- **Filter dropdown** — Show all projects, test projects only, or production projects only
- **Sort dropdown** — Sort by name, path, or creation date (newest first)

Click any project card to open its dashboard.

## Actions

**Create project from template**
- Click "Create from project template" button
- Select a built-in or user template
- Enter a project name
- Choose the parent folder
- Squadboard creates a new `.squad/` folder and initializes your project

**Connect new project**
- Click "Connect new project"
- Choose an existing `.squad/` folder on your filesystem
- Squadboard registers it and adds it to your project list

**Select multiple projects**
- Click checkboxes on project cards to select them
- Use "Select all on this page" to bulk-select visible projects

**Remove selected projects**
- Select one or more projects
- Click "Remove selected"
- **Important:** Removal only deletes Squadboard metadata (your project from this instance). Your `.squad/` folder and all files remain intact on your filesystem.

## Configuration

**User preferences** (stored in browser local storage):
- **Default sort** — Remember your sort preference across sessions
- **Default filter** — Remember test/production filter preference
- **Search query** — Not persisted

## Related

- [Apps](./apps.md) — Install pre-built Squadboard Apps
- [Templates](./templates.md) — Create and manage project templates
- [Settings](./settings.md) — Project configuration after you've opened a project

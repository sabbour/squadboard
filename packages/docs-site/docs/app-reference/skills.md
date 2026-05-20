---
title: Skills
description: Manage skills your agents can use
---

# Skills

**Route:** `/projects/:id/skills`

Project-scoped registry of skills. Skills are custom capabilities agents can leverage. Browse, create, edit, and import skills.

## Overview

Skills are how you extend agent capabilities. Each skill is a snippet of logic, context, or instructions injected into agent prompts. Skills are project-scoped; each project has its own skill registry.

Skills are grouped by category for easy browsing.

## Skill List

Grid or list view of all skills in your project:
- Skill name
- Category badge
- Brief description
- Creation date
- Usage count (how many agents use it)

Click any skill to view or edit.

## Categories

Skills are organized by category (e.g., "Analysis", "Integration", "Formatting"). Filter the list by category using the left sidebar.

You can create custom categories; category is a free-form field.

## Actions

### Create Skill

**New skill:**
- Click "Create skill" or "+" button
- Enter skill name (required)
- Choose category (optional; defaults to Uncategorized)
- Write skill content (markdown)
- Save

Skill content is injected into agent system prompts, so write it as instructions, examples, or context.

### Edit Skill

Click existing skill to open edit dialog:
- Modify name, category, or content
- Save changes
- Changes apply to all agents using this skill

**Delete skill:**
- Click delete icon to remove skill permanently
- **Warning:** Agents still referencing this skill will fail; ensure no agents use it first

### Import Skill

**From markdown file:**
- Click "Import skills" button
- Upload `.md` file containing skill definitions
- File should have `key: value` YAML header plus markdown content
- Multiple skills per file OK

**From curated library:**
- Click "Browse curated skills" button
- Browse pre-built skills from the Squadboard library
- Click a skill to preview
- Click "Add" to clone it into your project

### Formulate Skill

Use inline AI to create skills from prose:
- Click "Formulate" button
- Describe what you want the skill to do (plain English)
- AI generates a skill draft
- Review, edit, and save

## Skill Detail View

When viewing a skill:
- **Name** — Skill title
- **Category** — Grouping/classification
- **Content** — Markdown that gets injected into prompts
- **Used by agents** — List of agents leveraging this skill
- **Created/updated** — Timestamps

**Metadata:**
- Key name (for API reference; kebab-case or snake_case)
- Version (if tracked)

## Configuration

**Key validation:**
- Keys must be kebab-case or snake_case
- Spaces and special characters not allowed
- Length limit: 128 characters

**Content:**
- Markdown format supported
- Can include code blocks, lists, tables
- No HTML or unsafe markup allowed

## Import Status

After importing skills, a success/error banner shows:
- Count of skills imported
- Any skipped (duplicates, validation errors)
- Errors (if import failed)

## Related

- [Agents](./agents.md) — Assign skills to agents
- [Tools](./tools.md) — External tools (complementary to skills)
- [Ceremonies](./ceremonies.md) — Embed skills in workflow steps

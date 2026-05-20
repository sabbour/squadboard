---
title: Apps
description: Browse and install Squad Apps to Squadboard
---

# Apps

**Route:** `/apps`

Browse and install pre-built Squad Apps (complete project bundles) into your Squadboard instance. Apps are pre-configured projects you can fork and customize.

## Overview

Apps let you jump-start projects without starting from scratch. Each app is a template that includes:
- Pre-configured agents and team
- Pre-built ceremonies/workflows
- Starter tools and MCP integrations
- Optional sample data

Apps can be installed from GitHub repositories or from local app folders.

## GitHub Installer

**Install from GitHub repository:**
- Enter repository owner and name (e.g., `my-org/my-squad-app`)
- Choose git ref (branch, tag, or commit SHA)
- Specify the app folder path within the repo (if nested)
- Choose a local project name
- Choose where to clone it on your filesystem
- Click "Install"

Squadboard clones the repo, initializes the `.squad/` folder, and registers it as a project.

## Available Local Apps

Browse apps you've already cloned locally or are available as local directories. Each app card shows:
- App name
- Description
- Preview of included agents and ceremonies

**Actions:**
- Click an app card to open the Install Dialog
- Review what the app includes before confirming

## Install Dialog

**Configure before install:**
- **Project name** — What this project will be called in Squadboard
- **Absolute project folder path** — Where to store/clone the project files
- Confirmation of what will be installed

**Actions:**
- **Install** — Create the project and add it to your project list
- **Cancel** — Discard and return to app browser

## Warnings

**Trusted sources only** — Only install apps from sources you trust. Installed apps have full access to your Squadboard instance and can execute arbitrary code via agents and MCP integrations.

**Sync ownership note** — If installing into an existing `.squad/` folder that's already connected to Squadboard, the app overwrites existing metadata. Review before proceeding.

## Related

- [Project Picker](./project-picker.md) — Manage projects after installation
- [Templates](./templates.md) — Create and manage your own app templates
- [Agents](./agents.md) — View and customize agents in installed apps

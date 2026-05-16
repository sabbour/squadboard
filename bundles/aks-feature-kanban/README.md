# AKS Feature Kanban — Squad App

> **Version:** 0.1.0 · **Schema:** squadapp v1 · **Wave:** 23 (F4 first curated app)

A complete, installable Squadboard Squad App for AKS engineering teams. One install stands up a fully configured project: 6-column kanban, 4 specialised agents, 3 automated ceremonies, 2 skills, 1 cluster-info tool, the Azure MCP server, and a day-1 backlog of 5 seed issues.

---

## What's Included

### Board

| Column | Slug | Purpose |
|---|---|---|
| Backlog | `backlog` | All incoming work. Default for new issues. |
| Triage | `triage` | Issues under active triage. |
| In Progress | `in-progress` | Work in flight (WIP limit: 3). |
| In Review | `in-review` | Code review / design review (WIP limit: 5). |
| Validation | `validation` | QA sign-off before ship. |
| Done | `done` | Shipped. |

**Default labels:** `bug` · `feature` · `chore` · `azure-issue` · `aks-control-plane` · `aks-node-pool` · `aks-addon` · `aks-networking`

### Agents

| Agent | Role | Key skills |
|---|---|---|
| `aks-pm` | AKS Product Manager | Customer signal aggregation, triage, scope decisions, disclosures |
| `aks-platform-engineer` | AKS Platform Engineer | ARM, Kubernetes API, az CLI, Helm, control/data plane |
| `aks-quality-engineer` | AKS Quality Engineer | Playwright, Azure CLI tests, cluster bringup, bug repro |
| `aks-docs-engineer` | AKS Docs Engineer | learn.microsoft.com docs, What's New, disclosure review |

### Ceremonies

| Ceremony | Trigger | Owner | What it does |
|---|---|---|---|
| Weekly AKS Triage | Every Monday 09:00 | `aks-pm` + `aks-quality-engineer` | Routes new bugs, assigns labels, confirms repros |
| Feature Cut Review | Manual (pre-ship) | All 3 engineers | Scope review, test sign-off, ship/hold decision |
| Customer Signals Digest | Every Friday 08:00 | `aks-pm` | Aggregates signals from 6 sources into a ranked digest |

### Skills

- **`aks-customer-signal-collection`** — Where to look (GitHub, Q&A, SO, UserVoice), how to deduplicate, how to score signals.
- **`aks-disclosure-quality`** — Required disclosure structure, Microsoft voice rules, what to include/exclude.

### Tool

- **`aks-cluster-info`** — Wraps `az aks show` + `kubectl get nodes` to give agents structured cluster state JSON. Used before/after cluster mutations.

### MCP Server

- **Azure MCP** (`@azure/mcp@latest` via `npx`) — Gives agents access to Azure resource management APIs. Idempotent install via npx.

### Seed Issues (day-1 backlog)

| # | Title | Labels | Column |
|---|---|---|---|
| 1 | Node pool upgrade fails silently when PDB blocks eviction | `bug` `aks-node-pool` | Triage |
| 2 | Azure CNI Overlay: pod IP exhaustion not surfaced in diagnostics | `bug` `aks-networking` | Triage |
| 3 | Workload Identity federation for GitHub Actions OIDC | `feature` `aks-addon` | Backlog |
| 4 | Auto node image upgrades: pre/post-upgrade webhook support | `feature` `aks-node-pool` | Backlog |
| 5 | Refresh test matrix for Kubernetes 1.32 | `chore` | Backlog |

---

## Installation

### Via Squadboard UI

1. Open the **New Project** dialog or the **Install App** drop-zone.
2. Drag `aks-feature-kanban.squadapp.tar.gz` onto the drop-zone, or paste the git URL.
3. Review the preview card (agent count, ceremony count, seed issues).
4. Click **Install**.
5. Squadboard creates the project and redirects you to the board.

### Via CLI

```bash
# Local directory install
npx squadboard app install ./bundles/aks-feature-kanban --dry-run
npx squadboard app install ./bundles/aks-feature-kanban

# From git URL (when published)
npx squadboard app install https://github.com/sabbour/squadboard/bundles/aks-feature-kanban
```

### Via MCP (`install_app` tool)

```json
{
  "tool": "install_app",
  "arguments": {
    "source": "./bundles/aks-feature-kanban",
    "dryRun": false
  }
}
```

---

## Post-Install Setup

### 1. Configure Azure MCP credentials

The Azure MCP server uses `${AZURE_SUBSCRIPTION_ID}` and `${AZURE_TENANT_ID}`. Set them in your Squadboard environment:

```bash
az login
export AZURE_SUBSCRIPTION_ID=$(az account show --query id -o tsv)
export AZURE_TENANT_ID=$(az account show --query tenantId -o tsv)
```

### 2. Run Init Mode to cast agents

On first project use, Init Mode will prompt you to re-cast the generic agent names (`aks-pm`, `aks-platform-engineer`, etc.) with real team member names and project-specific charters. You can skip this and use the default charters.

### 3. Customise the board

- Add more labels: open **Project Settings → Labels** and add your feature-specific labels.
- Adjust WIP limits: edit column settings on the board.
- Change the triage schedule: edit `ceremonies/weekly-aks-triage.yaml` and update the `cron` expression.

---

## Customisation Guide

### Adding a new agent

1. Create `agents/<name>/charter.md` with Role, Expertise, Responsibilities, and Style sections.
2. Add a team entry to `squadapp.json` with `charterPath` pointing to your new charter file.
3. Add routing rules in the `routing` array.

### Changing ceremony schedules

The triage ceremony runs **Mondays at 09:00 UTC** (`0 9 * * 1`).  
The signals digest runs **Fridays at 08:00 UTC** (`0 8 * * 5`).

Edit the `cron` values in `squadapp.json` under the `ceremonies` section.

### Pinning the Azure MCP version

For production use, pin a specific version instead of `@latest`:

```json
"args": ["-y", "@azure/mcp@0.4.0"]
```

---

## File Layout

```
bundles/aks-feature-kanban/
├── squadapp.json                              # Manifest (required)
├── project.json                               # Project skeleton
├── README.md                                  # This file
├── agents/
│   ├── aks-pm/charter.md
│   ├── aks-platform-engineer/charter.md
│   ├── aks-quality-engineer/charter.md
│   └── aks-docs-engineer/charter.md
├── ceremonies/
│   ├── weekly-aks-triage.yaml
│   ├── feature-cut-review.yaml
│   └── customer-signals-digest.yaml
├── skills/
│   ├── aks-customer-signal-collection/SKILL.md
│   └── aks-disclosure-quality/SKILL.md
├── tools/
│   └── aks-cluster-info.json
├── mcp/
│   └── azure-mcp.json                        # Spec-canonical location
├── mcp-servers/
│   └── azure-mcp.json                        # Extended recipe (idempotent install notes)
├── issues/
│   └── seed.json                             # Spec-canonical location
└── seed-issues/
    └── issues.json                           # Task-specified alias
```

---

## Spec Conformance

This app conforms to [`docs/squadapp-spec.md`](../../docs/squadapp-spec.md) (McManus W22, Wave 22).

- `schemaVersion: 1` (draft-07 schema)
- `appId`: `"aks-feature-kanban"` (kebab-case, globally unique within instance)
- Collision behavior: skip-with-warning (spec §4.2 default)
- Seed issues: idempotent by `title + column` (spec §4.2)
- Rollback: all writes in a single DB transaction except seed issues (spec §5.3)

---

## Contributing

This is the **Wave 23 F4 reference implementation**. To propose changes:

1. File an issue with label `squad-app` + `aks-feature-kanban`.
2. McManus W24 will review spec follow-ups flagged during implementation.
3. Version bumps follow spec §10.3 SemVer rules.

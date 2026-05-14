# Demo 15 — GitHub Sync

> **Status:** 🔴 Not started  
> **Layer:** Advanced  
> **Estimated session:** ~10 minutes to run through

## What this demo shows

Push workflow runs as branches and PRs to GitHub. Ingest GitHub Issues as Squadboard cards. Post check-run results and commit statuses. All syncing is via GitHub API (webhooks for inbound).

## Prerequisites

- Demo 12 complete (multi-user + live ops working)
- `npx @sabbour/squadboard up` running
- A GitHub token configured (see SETUP guide TBD)
- A GitHub repository linked to your Squadboard project

## Run it

```bash
# Step 1: Link your Squadboard project to a GitHub repo
# Settings → GitHub → Connect → select repo

# Step 2: Execute a workflow that completes
# The engine pushes a branch to GitHub (e.g., `squad/workflow-run-123`)

# Step 3: Check GitHub
# The branch exists; a PR is opened with the run output as a summary

# Step 4: In Squadboard, ingest a GitHub Issue
# Go to Settings → Sync → "Import Issues"
# Select issues to add as cards

# Step 5: Create a card with the GitHub label
# The card syncs to GitHub as an Issue

# Step 6: Post check runs
# When a workflow completes, a check-run result appears on the PR
```

## What to observe

- Branches are pushed with a summary commit (run details in the body)
- PRs are opened automatically; check runs show pass/fail
- Inbound Issues from GitHub become cards on your board
- Labels and milestones sync bidirectionally
- Rate limiting is respected (exponential backoff)

## Known gaps (hacking phase)

> Webhook ingestion for GitHub Issues is TBD. Check-run posting is stubbed. Bidirectional sync is one-way (Squadboard → GitHub) in v1.

---
*Auto-generated stub. Last updated: 2026-05-14. Update when demo ships.*

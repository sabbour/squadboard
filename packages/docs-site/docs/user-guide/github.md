---
title: GitHub integration
description: Configure GitHub sync, PR workflows, activity feed, and Ralph monitor signals.
---

# GitHub integration

## Authentication

Squadboard supports personal access tokens and GitHub Apps.

Personal access token:

```bash
curl -X PUT http://localhost:3000/api/projects/{projectId}/github \
  -H "Content-Type: application/json" \
  -d '{"authType":"pat","token":"ghp_xxxxx","owner":"org","repo":"repo"}'
```

GitHub App:

```json
{
  "authType": "app",
  "appId": "123456",
  "installationId": "78901234",
  "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
  "owner": "org",
  "repo": "repo"
}
```

## Workflow actions

GitHub-aware workflow steps can:

- name and push branches
- open PRs
- comment on PRs
- wait for PR merge
- record PR state on cards

## Activity feed

GitHub events are persisted, emitted on the internal event bus, and can enrich future agent prompts with recent PR or issue context.

## Ralph monitor inputs

Ralph can prioritize:

- untriaged issues with squad labels
- `squad:{member}` labels
- assigned issues needing pickup
- CI failures on tracked PRs
- review feedback or requested changes
- approved PRs
- draft PRs needing attention

For GitHub work that did not start from Ready-column pickup, Ralph can recommend and log the next action. It does not automatically merge PRs or apply fixes yet; those actions still require explicit human approval.

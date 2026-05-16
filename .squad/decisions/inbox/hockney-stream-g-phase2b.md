# Stream G Phase 2B — GitHub Integration Layer (Wave 18)

**Author:** Hockney (Backend/Workflow Engine Dev)  
**Date:** 2025-07  
**Stream:** G — GitHub-Native Workflows

---

## Summary

Implemented the full GitHub integration layer for Squadboard:

1. **D1 — 5 MCP GitHub tools** (`github_push_branch`, `github_open_pr`, `github_comment_issue`, `github_trigger_workflow`, `github_merge_pr`)
2. **D2 — Expanded webhook handler** (8 event types, HMAC-SHA256 signature validation, event persistence, bus emission)
3. **D3 — GitHub ceremony triggers** (`triggerKind = 'github'` with `event`, `action?`, `filters?` config)
4. **D4 — pg stdio SIGPIPE fix** (clean pool teardown on MCP process exit)

---

## Decisions

### Service extraction (`github-git-ops.ts`)
Git/gh-CLI operations previously inlined in `routes/runs.ts` were extracted to a shared service `services/github-git-ops.ts`. Necessary because the MCP stdio transport runs without an HTTP server, so calling `localhost` endpoints would fail. Both HTTP routes and MCP handlers now call the same service functions.

### Typed `GitOpsError`
Service functions throw `GitOpsError(code, detail, httpStatus)`. Route handlers use `httpStatus` for the HTTP response; MCP handlers convert via `gitOpsErrorToResult()`.

### Webhook signature validation
Per-project `github_webhook_secret` column added to `projects`. If set, all inbound webhook requests must pass HMAC-SHA256 verification (`X-Hub-Signature-256`). Validation uses `crypto.timingSafeEqual` to avoid timing attacks. Unsigned projects (null secret) still receive events — enables easy local dev without a secret.

### Webhook idempotency
`github_events(delivery_id)` is used to deduplicate. `X-GitHub-Delivery` is GitHub's per-delivery UUID. Duplicate deliveries return `{ ok: true, dedup: true }` immediately.

### Ceremony GitHub trigger idempotency
`ceremony_github_fires(ceremony_slug, delivery_id)` unique index prevents double-firing a ceremony for the same GitHub delivery. DB constraint is the source of truth; the in-memory `dedupe` map is fallback when no `delivery_id` is present.

### `BundleCeremonyGithubTrigger` in SDK schema
New discriminated type added alongside `BundleCeremonyTrigger`. `BundleCeremony.trigger` is now a union. `normalizeCeremonyTrigger()` in `bundle-loader.ts` collapses the GitHub trigger into a `{ kind: 'github', config: { event, action?, filters? } }` shape for DB storage.

### `TriggerSource.kind = 'github'`
Added `'github'` to the `TriggerSource.kind` union in `workflow-runner.ts` so ceremony runs triggered by GitHub events carry accurate provenance metadata.

---

## Files Changed

| File | Change |
|------|--------|
| `packages/server/src/services/github-git-ops.ts` | NEW — 5 shared git/gh operations |
| `packages/server/src/mcp/server.ts` | 5 new GitHub tools + handlers |
| `packages/server/src/mcp/index.ts` | SIGPIPE/SIGTERM/SIGINT + closeDb() |
| `packages/server/src/routes/runs.ts` | Thin wrappers calling service functions |
| `packages/server/src/routes/github-sync.ts` | Expanded webhook: 8 events, sig validation, persistence, bus emission |
| `packages/server/src/realtime/event-bus.ts` | `GitHubWebhookEventType` + `emitGithubWebhookEvent()` |
| `packages/server/src/services/ceremony-dispatcher.ts` | `handleGithubEvent()` + `findMatchingGithubCeremonies()` |
| `packages/server/src/engine/workflow-runner.ts` | `TriggerSource.kind` extended with `'github'` |
| `packages/server/src/db/schema.ts` | `github_webhook_secret`, `github_events`, `ceremony_github_fires` tables |
| `packages/server/src/db/index.ts` | Wave 18 bootstrap migration block |
| `packages/squadboard-sdk/src/bundle/schema.ts` | `BundleCeremonyGithubTrigger`, `BundleCeremonyTriggerKind += 'github'` |
| `packages/server/src/services/bundle-loader.ts` | `normalizeCeremonyTrigger()` helper; imports new SDK types |

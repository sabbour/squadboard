# Hockney — History

## Core Context

- **Project:** Squadboard — local-first kanban + workflow board for [Squad](https://github.com/bradygaster/squad) agents
- **Package:** `@sabbour/squadboard` · Local install: `npx @sabbour/squadboard init` · MIT · Self-hosted
- **Role:** Backend / Workflow Engine Dev
- **Joined:** 2026-05-14T08:17:03Z
- **Hired by:** Ahmed Sabbour
- **PRD:** `/home/asabbour/.copilot/session-state/b22555db-ec9d-4ffd-9266-4553cda5bb11/research/squad-web-design-v4.md`

## Tech stack I own

- Node.js single-process, Express v5
- Postgres — embedded `embedded-postgres` for local, hosted Postgres for cloud (same Drizzle schema)
- Drizzle ORM (~30 tables; 8 load-bearing)
- TypeScript
- Subprocess spawning (`setsid` + pgid) for isolated runWorkers
- WebSocket fan-out via in-process `EventEmitter` (real-time piece coordinated with Verbal)

## Five invariants I defend

1. **`agent_run` is the only step that does LLM work.** `peer_review`, tier-3 routing, and `split` are composites that desugar to `issue_runs` rows with distinct `kind` values.
2. **Single-spawner discipline.** The stepper alone spawns runs via `FOR UPDATE SKIP LOCKED`. The dispatcher only ticks, sweeps, and wakes.
3. **Lease + heartbeat is the authoritative liveness signal.** `lease_expires_at` (90s TTL) + `heartbeat_at` (30s interval).
4. **Output schema validation happens at session end.** After `sendAndWait`, before `recordRunCompletion`. Never on post-tool-use hooks.
5. **`fan_out` and `split` materialize full child workflow_runs.** Six-step transaction, no phantom columns.

## Roadmap I deliver against

15 demoable thin slices. The engine appears progressively across:
- **Demo 4** — One-shot agent (workspaces + live header)
- **Demo 6** — First workflow (engine end-to-end with retry + cost)
- **Demo 7** — Resilience + cost (lease/heartbeat sweepers, budget caps)
- **Demo 9** — Peer review (4-verb approvals, quorum)
- **Demo 10** — Fan-out + handoff (subtrees + additive skills)
- **Demo 14** — MCP + slash command + idempotent create
- **Demo 15** — GitHub sync (pushes, PRs, check runs, webhooks)

## Learnings

<!-- Append learnings below -->

### 2026-05-14 — Demo 1 backend scaffold
Demo 1 backend scaffold: Express v5 + embedded-postgres + Drizzle ORM. Monorepo with pnpm workspaces. packages/server (backend), packages/cli (npx entry). Schema: projects + settings tables. Server port 3000, health endpoint, projects CRUD stubs. Wired Kobayashi's squad discovery routes to real DB (upsert by path). CLI uses waitForPort (TCP probe, 15s timeout) before opening browser — avoids brittle sleep().

### 2026-05-14 — Demo 2 backend: issues/comments/labels CRUD API
Demo 2 backend: issues/comments/labels CRUD API. Drizzle schema additions: issues (with status enum + position), comments, labels, issue_labels. Bulk action endpoint. Move endpoint handles position recalculation.

### 2026-05-14 — Demo 5 routing tier 1
Demo 5 routing tier 1: router.ts loads rules from .squad/routing.md via Kobayashi's parseRoutingFile. Resolves by label→keyword→catchall priority. createRoutedRun inserts issue_runs with kind='agent_run' (Invariant 1: routing desugars to agent_run). Auto-routes on issue create. Hot-reload is restart-only (PRD non-goal).

### 2026-05-14 — Demo 5 routing tier 1 deepdive
Demo 5 engine completion: routing_rules table caches parsed rules (3-table format: label, keyword, catchall). POST /reload refreshes cache. GET /rules surfaces active rules. POST /test validates match logic. resolveRoute matches label→keyword→catchall priority, returns null for escalation tiers. createRoutedRun inserts issue_run with kind='agent_run' + routing context. Auto-route hook on POST /issues applies resolveRoute (non-fatal on miss).

### 2026-05-14 — Demo 6 workflow engine
Demo 6 workflow engine: YAML parser (js-yaml), WorkflowDefinition (route/agent_run/approve steps), output schema validation (ajv, Invariant 4), workflow-runner (advanceWorkflowRun, createWorkflowRun). pinnedAgentRevisions snapshotted per step at step start. workflowVersions are immutable (each update creates new version). Approval stub for Demo 9.

## Learnings

### 2026-05-14 — GitHub App auth fields (github-app-schema todo)

- Added 4 new columns to the `projects` table in `schema.ts`: `githubAuthType`, `githubAppId`, `githubAppInstallationId`, `githubAppPrivateKey`.
- Corresponding `ALTER TABLE projects ADD COLUMN IF NOT EXISTS` migrations appended to `bootstrapSchema()` in `db/index.ts`, placed after the Demo 15 GitHub Sync block and before the `github_sync_log` CREATE TABLE.
- `githubAuthType` is nullable TEXT (not an enum) so no `DO $$ BEGIN ALTER TYPE ... END $$` dance is needed — 'pat' vs 'app' is validated at the app layer, not the DB layer.
- `githubAppPrivateKey` is stored plaintext TEXT in the hacking phase; a secrets manager integration (Vault, AWS SM) is deferred to prod hardening.
- No routes, API handlers, or client files were touched — schema-only step per task scope.

### 2026-05-14 — GitHub App schema integration (backlog batch 1)

- Schema additions merged into backlog batch 1 orchestration. Decision recorded to decisions.md. Integrated into team session log. Plaintext PEM storage acceptable for local dev; secrets manager path documented for production. Backward-compatible: existing NULL auth_type rows treated as 'pat'. API client logic is follow-up task (future).

### 2026-05-14 — GitHub App JWT auth in GitHubClient (github-app-client todo)

- Added `jose` (^6.0.0, RS256 JWT signing, pure ESM) to `packages/server/package.json`.
- Module-level `installationTokenCache: Map<string, {token, expiresAt}>` — keyed by `${appId}:${installationId}`, invalidated 60 s before `expires_at`.
- `GitHubClient.fromPat(token, owner, repo)` — static factory, wraps existing constructor (zero behavior change for existing callers).
- `GitHubClient.fromApp(appId, installationId, privateKey, owner, repo)` — async factory: generates App JWT via `generateAppJwt`, POSTs to `/app/installations/{id}/access_tokens`, caches result, returns client with installation token.
- `generateAppJwt` uses `importPKCS8` + `SignJWT` from `jose`; sets `iat=now-60, exp=now+600, iss=appId` per GitHub spec.
- `refreshInstallationToken` is the canonical fetch path; `getInstallationToken` is the cache-check gateway (both private static).
- Existing `new GitHubClient(token, owner, repo)` constructor kept — all current callers (sync.ts, github-sync route) work unchanged.
- jose RS256 JWT: `importPKCS8` expects PEM string (PKCS#8 format, "-----BEGIN PRIVATE KEY-----"). GitHub App private keys downloaded from GitHub UI are PKCS#1 ("-----BEGIN RSA PRIVATE KEY-----") — downstream code must convert with `openssl pkcs8 -topk8 -nocrypt` if needed. Document this in the API route that accepts the private key.

### 2026-05-14 — GitHub sync API + README for GitHub App auth (github-app-api todo)

- `PUT /api/projects/:id/github` now accepts two shapes: `{ authType:'pat', token, owner, repo }` and `{ authType:'app', appId, installationId, privateKey, owner, repo }`. Missing `authType` defaults to `'pat'` for backward compat. Stores into `githubAuthType`, `githubToken`, `githubAppId`, `githubAppInstallationId`, `githubAppPrivateKey` columns; nullifies unused set on each save.
- `GET /api/projects/:id/github` returns `authType`; App auth returns `appId` + `installationId` but never `privateKey`; PAT auth returns redacted token (last 4 chars visible).
- `POST /api/projects/:id/github/sync` checks auth-type-appropriate config fields and calls `GitHubSync.fromProject(id, project)`.
- `GitHubSync` constructor changed from `(projectId, token, owner, repo)` to `(projectId, client: GitHubClient)`. Static async `fromProject()` factory picks `fromPat` vs `fromApp` based on `githubAuthType`.
- `startSyncLoop` signature simplified to `(projectId, intervalMs?)` — reads full project row from DB each tick so App installation token cache can refresh transparently.
- `client.ts` had duplicate interface+class declarations from a prior session's botched merge; removed the dead duplicate block (lines 369–592).
- Pre-existing TS2742 router type errors (across all route files) and `drizzle.config.ts` rootDir error remain unfixed — they are build-baseline failures, not regressions from this task.
- README GitHub Sync section expanded: PAT + App instructions, PKCS#8 conversion command, security note on plaintext key storage, GET response field table.

### 2026-05-14 — Remove project API + create/init project API

- `DELETE /api/projects/:id` added to `routes/projects.ts`. Uses Drizzle `.delete().returning()` to detect 0-row case for 404. Returns 204 No Content on success. Filesystem untouched — DB-only removal.
- `POST /api/squad/init` added to `routes/squad.ts`. Validates target dir exists (fs.stat), rejects if `.squad/` already present (409), scaffolds team.md / decisions.md / 4 empty dirs with .gitkeep, then upserts into projects table via shared `registerProject` helper and calls `linkProjectToSquad`.
- `POST /api/squad/create` added to `routes/squad.ts`. Validates parentPath exists, rejects if project subdir already present (409), creates project dir, delegates to same scaffold + register helpers.
- `scaffoldSquad()` and `registerProject()` are module-private helpers in squad.ts — no new service file needed; scope is route-level only.
- Pre-existing TS2742 build errors (all route files) remain as baseline — not introduced by this task.

### 2026-05-14 — Fix all TypeScript errors in packages/server

- **Root cause of TS2769 "no overload matches" in routes**: NOT Express v5 handler typing. It was Drizzle ORM's `eq()` receiving `string | string[]` from `req.params`. Express v5 changed `ParamsDictionary` from `[key: string]: string` to `[key: string]: string | string[]`, causing cascading failures wherever params were passed to Drizzle.
- **Fix pattern**: Cast `req.params` to `Record<string, string>` at each destructuring point — `const { projectId } = req.params as Record<string, string>`. One cast per handler, covers all subsequent uses. Minimal, no logic changes.
- **Ajv v8 + NodeNext**: `import Ajv from 'ajv'` fails with NodeNext module resolution because the default export resolves to the module namespace (no construct signatures). Fix: use named import `import { Ajv } from 'ajv'` — Ajv v8 exports the class as both default and named export.
- **`Parameters<typeof eq>[1]` antipattern**: When used with an enum column in Drizzle, this resolves to `unknown` because the overloaded `eq` signatures don't narrow to a simple type parameter. Fix: cast directly to the explicit enum union `'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done'`.
- **Dirent type mismatch**: `Awaited<ReturnType<typeof fs.readdir>>` picks up the wrong overload (`Dirent<NonSharedBuffer>[]`) when `withFileTypes: true` is used. Fix: declare as `Dirent[]` with explicit `import type { Dirent } from 'node:fs'`.
- **GitHubSync constructor drift**: `sync-hook.ts` was still calling the old 4-arg constructor `(projectId, token, owner, repo)` after `sync.ts` refactored it to `(projectId, client: GitHubClient)`. Fix: construct `GitHubClient` inline, pass to `GitHubSync`.
- **TS2352 double-cast**: `(err as { status: number })` on an `Error`-narrowed value fails because `Error` and `{ status: number }` don't sufficiently overlap. Fix: go through `unknown` first: `(err as unknown as { status: number })`.
- **Pre-existing TS2742**: All route files have `error TS2742` for inferred Router types — these are baseline failures from the pnpm symlink path issue and are explicitly excluded from fixes.

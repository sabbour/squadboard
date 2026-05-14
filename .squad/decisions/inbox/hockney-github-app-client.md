# Decision: GitHub App JWT auth in GitHubClient

**Date:** 2026-05-14  
**By:** Hockney (Backend / Workflow Engine Dev)  
**Task:** github-app-client todo

## What

`packages/server/src/github/client.ts` now supports two auth modes via static factory methods:

- `GitHubClient.fromPat(token, owner, repo)` — existing PAT path (wraps constructor, zero behavior change)
- `GitHubClient.fromApp(appId, installationId, privateKey, owner, repo)` — GitHub App JWT path

**JWT flow (per GitHub spec):**
1. `generateAppJwt`: RS256 JWT signed with app private key. `iat=now-60, exp=now+600, iss=appId`. Uses `jose` (`importPKCS8` + `SignJWT`).
2. POST `https://api.github.com/app/installations/{installationId}/access_tokens` with JWT as Bearer.
3. Cache returned `{ token, expires_at }` in module-level `Map<string, {token, expiresAt}>` keyed by `${appId}:${installationId}`.
4. Invalidate cache 60 s before `expires_at` (GitHub tokens last ~1 hr).
5. Client uses installation token as Bearer for all API calls — same `request<T>()` method.

## Dependencies

- `jose ^6.0.0` added to `packages/server/package.json` (pure ESM, no native deps).

## Key constraint: PKCS#8 vs PKCS#1

`jose`'s `importPKCS8` expects **PKCS#8** PEM format (`-----BEGIN PRIVATE KEY-----`). GitHub App private keys downloaded from the GitHub UI are **PKCS#1** (`-----BEGIN RSA PRIVATE KEY-----`). The API route that stores `github_app_private_key` must either:
- Accept the raw key and convert in-server (requires openssl native binding), or
- Document that users must convert before storing: `openssl pkcs8 -topk8 -nocrypt -in github-app.pem -out github-app-pkcs8.pem`

**Deferred:** conversion helper is a follow-up (next API route task). For now, the client assumes PKCS#8 input.

## Backward compatibility

Existing `new GitHubClient(token, owner, repo)` constructor is **unchanged**. All current callers (`sync.ts`, `routes/github-sync.ts`) continue to work. `fromPat` is an ergonomic alias only.

## Secrets note

`github_app_private_key` stored plaintext in Postgres — same posture as `github_token` (PAT). Acceptable for local-first hacking phase. Production must use a secrets manager reference.

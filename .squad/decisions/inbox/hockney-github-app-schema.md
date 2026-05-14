# Decision: GitHub App Auth Fields Added to Projects Schema

**Date:** 2026-05-14  
**Author:** Hockney  
**Status:** Accepted  

## Context

The projects table previously only supported PAT-based GitHub authentication (`github_token`). To support GitHub App authentication (required for installations without per-user PATs), four new columns are needed.

## Decision

Added the following columns to the `projects` table in `schema.ts` and as `ALTER TABLE … ADD COLUMN IF NOT EXISTS` migrations in `bootstrapSchema()`:

| Column | SQL name | Type | Notes |
|---|---|---|---|
| `githubAuthType` | `github_auth_type` | TEXT | `'pat'` or `'app'`; NULL is treated as `'pat'` for backward compat |
| `githubAppId` | `github_app_id` | TEXT | Numeric GitHub App ID stored as string |
| `githubAppInstallationId` | `github_app_installation_id` | TEXT | Installation ID scoped to the org/repo |
| `githubAppPrivateKey` | `github_app_private_key` | TEXT | PEM private key — **stored plaintext in hacking phase** |

## Rationale

- **Nullable TEXT for authType instead of a DB enum**: Avoids the `ALTER TYPE … ADD VALUE` ceremony; `'pat' | 'app'` validation is enforced at the application layer.
- **Plaintext PEM in hacking phase**: Acceptable for local self-hosted dev. A secrets manager (Vault / AWS Secrets Manager) is the production path — tracked as a future task.
- **Backward compatibility**: Existing rows with `github_auth_type = NULL` are treated as PAT auth by the sync service. No data migration required.

## Consequences

- API and client logic to read/write these columns is a follow-up task (not in scope here).
- The private key must never be logged or returned in list-projects API responses — enforced when the API layer is wired up.

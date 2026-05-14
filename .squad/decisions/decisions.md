# Team Decisions

## 2026-05-14: MCP Integration docs corrected to reference VS Code and GitHub Copilot CLI

**By:** Redfoot (DevRel / Docs)

**What:** README MCP Integration section (lines 110–149) completely rewritten. Removed all references to Claude Desktop and Cursor. Now documents two integration paths:

1. **Visual Studio Code** — with MCP extension installed, add `squadboard` to `.vscode/mcp.json` (project-level, committed to repo). Config block uses `type: "stdio"` with stdio transport via `node packages/cli/dist/index.js mcp`.
2. **GitHub Copilot CLI** — add `squadboard` to `~/.copilot/mcp-config.json` (user-level). Same JSON config block, just different file location.

Both paths use the same stdlib transport (`stdio`) and the same `squadboard mcp` CLI entry point. Documentation includes inline guidance for path adjustment relative to workspace root (VS Code) and absolute path usage (Copilot CLI).

**Why:** The original docs were aspirational / placeholder copy. Reality: Squadboard integrates with VS Code (via MCP extension) and GitHub Copilot CLI (via mcp-config.json), not Claude Desktop or Cursor. Both require the same JSON config format; only the file location differs. The fix aligns docs with actual product surface.

**Files changed:**
- `README.md` — rewritten MCP Integration section (110–149)

**Commit:** `3c93923` (`fix: update MCP docs to reference VS Code and GitHub Copilot CLI`)

**Owner:** Redfoot (reject authority on user-facing copy).

**Rationale:** Show-before-tell: each integration now leads with the actual config file path, followed by the JSON block, then restart/reload guidance. This matches DevRel best practice — destination-first (where to put it), then mechanism (what to paste).

---

## 2026-05-14: Fix dev script to run client and server concurrently

**By:** Keyser (Frontend Dev)

**Date:** 2026-05-14

**Status:** Merged

**What:** Updated root `package.json` `dev` script from:
```
"dev": "pnpm --filter @sabbour/squadboard-server dev"
```
to:
```
"dev": "pnpm --filter @sabbour/squadboard-server --filter @sabbour/squadboard-client run dev"
```

**Why:** `pnpm run dev` only started the Express server on port 3000. Visiting `localhost:3000` returned a JSON stub (`{"status":"ok",...}`) because the Vite dev server was never launched. Users had to start the client manually in a second terminal.

**How:** pnpm supports multiple `--filter` flags natively and runs each matched package's script in parallel — no extra dependencies (`concurrently`, etc.) required, and cross-platform by design.

**Impact:**
- `pnpm run dev` now starts both the Express server (`:3000`) and Vite dev server (`:5173`) in parallel.
- Vite's existing proxy config (`/api` → `http://localhost:3000`) routes API calls correctly — no change needed there.
- README already directed users to `localhost:5173`; no docs update required.

---

## 2026-05-14: GitHub App Auth Fields Added to Projects Schema

**Date:** 2026-05-14  
**Author:** Hockney  
**Status:** Accepted  

**Context:** The projects table previously only supported PAT-based GitHub authentication (`github_token`). To support GitHub App authentication (required for installations without per-user PATs), four new columns are needed.

**Decision:** Added the following columns to the `projects` table in `schema.ts` and as `ALTER TABLE … ADD COLUMN IF NOT EXISTS` migrations in `bootstrapSchema()`:

| Column | SQL name | Type | Notes |
|---|---|---|---|
| `githubAuthType` | `github_auth_type` | TEXT | `'pat'` or `'app'`; NULL is treated as `'pat'` for backward compat |
| `githubAppId` | `github_app_id` | TEXT | Numeric GitHub App ID stored as string |
| `githubAppInstallationId` | `github_app_installation_id` | TEXT | Installation ID scoped to the org/repo |
| `githubAppPrivateKey` | `github_app_private_key` | TEXT | PEM private key — **stored plaintext in hacking phase** |

**Rationale:**
- **Nullable TEXT for authType instead of a DB enum**: Avoids the `ALTER TYPE … ADD VALUE` ceremony; `'pat' | 'app'` validation is enforced at the application layer.
- **Plaintext PEM in hacking phase**: Acceptable for local self-hosted dev. A secrets manager (Vault / AWS Secrets Manager) is the production path — tracked as a future task.
- **Backward compatibility**: Existing rows with `github_auth_type = NULL` are treated as PAT auth by the sync service. No data migration required.

**Consequences:**
- API and client logic to read/write these columns is a follow-up task (not in scope here).
- The private key must never be logged or returned in list-projects API responses — enforced when the API layer is wired up.

---

## 2026-05-14: HookPipeline architecture

**Date:** 2026-05-14
**By:** Kobayashi

**What:** HookPipeline is a sequential hook runner per lifecycle point. globalPipeline singleton registered at server startup. output-validation hook implements Invariant 4 by calling validateAgentOutput. Hooks can mutate output (for future transformation use cases). Pipeline stops on first failure.

---

## 2026-05-14: Demo 6 workflow engine architecture + open question resolution

**Date:** 2026-05-14
**By:** Hockney

**What:** YAML workflows parsed with js-yaml. Output schema validation with ajv (Invariant 4). workflowVersions are immutable — updates create new version. pinnedAgentRevisions: snapshotted per step at step start (resolves open question #1). Approval step is stubbed — fills in Demo 9. validateAgentOutput replaces direct status update in recordRunCompletion.

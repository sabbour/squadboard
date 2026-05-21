# Decision: CLI connect/diagnose + Electron-first init

**Date:** 2026-05-21  
**Author:** Hockney (Backend / Workflow Engine Dev)  
**Status:** ✅ IMPLEMENTED

---

## Summary

The Squadboard CLI now has an explicit `connect` setup flow, a `diagnose` health check, and an Electron-first `init` path. Electron dev mode also self-starts the backend when nothing is already listening on port 3000.

---

## Decisions Made

1. **`squadboard connect` is the canonical MCP setup path.**
   - It merges `.mcp.json` in the current working directory using the existing Squadboard MCP entry logic.
   - It also injects Squadboard detection/delegation hints into `.github/agents/squad.agent.md` when that file exists.

2. **`--write-mcp-config` is removed from user-facing CLI flows.**
   - `init` and `mcp` no longer advertise or parse the old flag.
   - `writeMcpConfigFile()` stays as an internal helper used by `connect`.

3. **Agent hint injection is intentionally idempotent.**
   - If `squadboard_*` is already present, the CLI skips patching `squad.agent.md`.
   - The injected ceremony delegation block matches the backend squad-sync guidance so setup behavior stays aligned across surfaces.

4. **`squadboard diagnose` favors operator-readable output over raw JSON.**
   - It reports server health, MCP config presence, squad agent hint status, Electron app discovery, and whether port 3000 is listening in a compact terminal table.
   - Server reachability uses `GET /api/health`; the port check is a single short TCP probe.

5. **`squadboard init` now prefers Electron, but never hard-depends on it.**
   - After the backend is ready, the CLI looks for the monorepo root and `packages/electron/dist/main/index.js`.
   - If Electron is available, it launches detached via `npx electron ...`; otherwise it falls back to the browser.
   - `--no-electron` and `SQUADBOARD_NO_ELECTRON` force browser fallback.

6. **Electron dev mode must be resilient when the server is not already running.**
   - `startServer()` now probes localhost:3000 first in dev.
   - If something is already listening, Electron reuses it.
   - If not, Electron spawns `packages/server/dist/index.js` itself.
   - If the server build is missing, Electron logs a clear message and continues so the UI can surface the connection problem instead of crashing.

---

## Validation

- `cd packages/cli && pnpm build`
- `node packages/cli/dist/index.js --help`
- `node packages/cli/dist/index.js diagnose`
- `node packages/cli/dist/index.js connect --squad-storage fs` in a scratch directory (verified write + idempotent hint injection)
- `cd packages/electron && pnpm exec tsc --noEmit --ignoreConfig --target ES2022 --module NodeNext --moduleResolution NodeNext --lib ES2022,DOM --types node src/main/server-launcher.ts`

## Notes

- `packages/electron` still has a pre-existing workspace-wide `tsconfig.json` deprecation error (`baseUrl` / TS5101) when running its normal typecheck script. That baseline issue is unrelated to the `server-launcher.ts` change, so the targeted compile above was used to validate the touched file.

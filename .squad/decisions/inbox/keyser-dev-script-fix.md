# Decision: Fix dev script to run client and server concurrently

**By:** Keyser (Frontend Dev)
**Date:** 2026-05-14
**Status:** Merged

## What

Updated root `package.json` `dev` script from:
```
"dev": "pnpm --filter @sabbour/squadboard-server dev"
```
to:
```
"dev": "pnpm --filter @sabbour/squadboard-server --filter @sabbour/squadboard-client run dev"
```

## Why

`pnpm run dev` only started the Express server on port 3000. Visiting `localhost:3000` returned a JSON stub (`{"status":"ok",...}`) because the Vite dev server was never launched. Users had to start the client manually in a second terminal.

## How

pnpm supports multiple `--filter` flags natively and runs each matched package's script in parallel — no extra dependencies (`concurrently`, etc.) required, and cross-platform by design.

## Impact

- `pnpm run dev` now starts both the Express server (`:3000`) and Vite dev server (`:5173`) in parallel.
- Vite's existing proxy config (`/api` → `http://localhost:3000`) routes API calls correctly — no change needed there.
- README already directed users to `localhost:5173`; no docs update required.

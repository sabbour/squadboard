# Hockney — Postgres arm64 Fix

**Date:** 2026-05-14  
**Author:** Hockney (Backend/Engine)  
**Requested by:** Ahmed

---

## Root Cause

`embedded-postgres@17.5.0-beta.15` ships a dynamically-linked binary for
`linux/arm64` (`@embedded-postgres/linux-arm64`).  That binary requires two
shared libraries that are **not available** on this machine:

| Library | Required by binary | System has |
|---|---|---|
| `libpq.so.5` | yes | **not installed** |
| `libicuuc.so.60` | yes | `libicuuc.so.74` (incompatible major version) |

When the server started, `embedded-postgres` spawned `initdb` which
immediately failed to load its shared libs — the OS returned exit code **127**
("command not found / shared library error").  The library re-raised that as
the string `"Postgres init script exited with code 127."`, which we caught as
a fatal startup error.

This is a fundamental incompatibility: the prebuilt binary was compiled
against ICU 60 (Ubuntu 18.04 era), while this system runs ICU 74 (Ubuntu
24.04).  Simply installing `libpq.so.5` would not fix it because the ICU
version mismatch remains.

---

## What Was Tried (and Ruled Out)

**Option A — install `@embedded-postgres/linux-arm64` manually:**  
The package is already installed in the pnpm store
(`node_modules/.pnpm/@embedded-postgres+linux-arm64@17.5.0-beta.15`).  
The package is linked and the binary is executable — the problem is the
missing/incompatible system shared libraries, not the package itself.
Upgrading to a newer embedded-postgres release might help if a future build
links against ICU 74, but that's a dependency bump with unknown side effects.

---

## Fix Applied — Option B: Graceful Degradation

Modified `packages/server/src/db/postgres.ts` to implement a **four-path
fallback** inside `startEmbeddedPostgres()`:

```
Path 1  DATABASE_URL env var is set
         → skip embedded entirely, return that connection string directly.

Path 2  Try embedded-postgres as before (unchanged happy path).
         → on success: existing behavior, no change for macOS / linux-x64.
         → on failure with exit-code-127 string: warn + fall through.

Path 3  Check if a Postgres instance is already reachable on localhost:54321
        (2-second timeout, using the same credentials).
         → if reachable: ensureDatabase() + return embedded connection string.

Path 4  None of the above worked → throw a clear, actionable Error explaining
        the root cause and the two fix options for linux/arm64.
```

Key implementation details:
- `isEmbeddedBinaryFailure(err)` detects the string sentinel thrown by the
  library (`"exited with code 127"`), handling both `string` and `Error`.
- Non-127 errors from `pg.initialise()` are re-thrown immediately (no silent
  swallowing of real bugs).
- `pg` is nulled before falling through to prevent a double-stop() in the
  shutdown handler.
- Zero new runtime dependencies.
- TypeScript-clean (no new type errors beyond the pre-existing drizzle.config
  rootDir issue).

---

## README Update

Added a linux/arm64 callout block to the **Getting Started → Prerequisites**
section in `README.md`, explaining:
- Why embedded Postgres may not work
- How to set `DATABASE_URL` + install system Postgres (`sudo apt install
  postgresql`)
- That the server prints a clear error and falls back automatically

---

## How to Test on This Machine

1. **Without system Postgres (current state)** — start dev server and confirm
   you see the new warning + actionable error instead of the generic "fatal
   startup error":
   ```
   [postgres] embedded-postgres binary cannot run on linux/arm64 ...
   Error: [postgres] embedded-postgres is not available ...
     • Set DATABASE_URL=...
   ```

2. **With `DATABASE_URL`** — install postgres, then:
   ```bash
   export DATABASE_URL=postgresql://postgres@localhost:5432/squadboard
   pnpm run dev
   # Expected: "[postgres] DATABASE_URL set — skipping embedded postgres"
   # Followed by: "[squadboard] listening"
   ```

3. **On macOS / linux-x64** — behavior is unchanged; embedded-postgres starts
   as before (Path 2 succeeds without reaching the catch).

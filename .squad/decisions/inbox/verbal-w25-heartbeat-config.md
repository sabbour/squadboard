# Verbal W25 — Heartbeat Configurability

**Author:** Verbal (Backend Dev / real-time / WebSocket specialist)
**Date:** 2026-05-16
**Commit:** `3583d07e`
**Status:** Shipped

---

## Decision

Per-sweep cadence overrides for the heartbeat sweep registry are now
configurable via a single editable file (`packages/server/heartbeat.config.json`).
Brady can tune intervalMs, scale defaults by multiplier, or disable sweeps
without touching code. A new `GET /api/heartbeat/config` endpoint exposes
the effective settings for verification.

## Why

Heartbeat sweeps were hard-coded at registration (5s/30s/60s). Tuning
cadences for noisy/quiet environments required a code change → rebuild
→ restart cycle. Brady asked for a config file. This unblocks future
operational tuning (e.g., lengthen `github-sync-overdue` on low-bandwidth
networks, disable `idle-live-sessions` during local dev to reduce log
noise).

## What changed

| File | Change |
|---|---|
| `packages/server/heartbeat.config.json` | NEW — editable defaults matching coded cadences |
| `packages/server/src/engine/heartbeat-config.ts` | NEW — loader + `applyHeartbeatConfig()` mutator |
| `packages/server/src/engine/heartbeat.ts` | adds `getEffectiveIntervals()` for introspection |
| `packages/server/src/routes/heartbeat.ts` | NEW route `GET /api/heartbeat/config` |
| `packages/server/src/index.ts` | calls `applyHeartbeatConfig()` immediately before `heartbeat.register()` block |
| `packages/server/src/__tests__/heartbeat-config.test.ts` | NEW — 11 vitest cases (ENOENT, invalid JSON, overrides, multiplier, enabled toggle, invalid values, multi-sweep) |
| `packages/server/package.json` | adds `heartbeat.config.json` to published files list |

## Config schema

```json
{
  "sweeps": {
    "<sweep-id>": {
      "intervalMs": 5000,    // exact override (takes precedence)
      "multiplier": 2,       // OR scale the coded default by this factor
      "enabled": true        // toggle the sweep at startup
    }
  }
}
```

Loaded once at boot, never hot-reloaded — restart required for changes.

## Verification

- `pnpm test heartbeat-config` → 11/11 passing
- `pnpm -r build` → green
- `curl localhost:3000/api/heartbeat/config` → returns effective intervals

## Tradeoffs

- **No hot reload.** Intentional: the loader runs in `applyHeartbeatConfig()`
  before `register()`, so a change requires a restart. Hot reload would
  require coordinating with running `setInterval` handles; out of scope.
- **No validation beyond type-checks.** Invalid `intervalMs` (0, negative,
  non-number) is silently ignored. Future: schema validation via Ajv if
  the file grows.
- **Cached load.** The first `loadHeartbeatConfig()` call wins for the
  process lifetime. Tests use the `_resetHeartbeatConfigCache()` escape
  hatch (underscore-prefixed to discourage prod use).

## Follow-ups (optional)

- Add a small Heartbeat UI panel that pretty-prints `/api/heartbeat/config`
  alongside the existing per-sweep status cards. Currently the data is
  reachable only via curl or the JSON endpoint.
- If we ever ship a hosted install, document precedence: env var >
  config file > coded default (currently only config file > coded default).

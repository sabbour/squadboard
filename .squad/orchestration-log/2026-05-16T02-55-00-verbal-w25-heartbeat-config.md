# Orchestration Log: Wave 25 — Verbal (Heartbeat Config)

**Wave:** 25
**Agent:** Verbal (Backend / Real-time / WebSocket specialist)
**Timestamp:** 2026-05-16T02:55:00-07:00
**Status:** Complete

## Summary

Per-component sweep cadence config via heartbeat.config.json + GET /api/heartbeat/config + 11 vitest cases. Brady can now tune intervalMs, scale defaults by multiplier, or disable sweeps without touching code.

## Commits

- `3583d07e` — Add heartbeat.config.json + loader + GET /api/heartbeat/config

## Changes

**Files:**

| File | Change |
|---|---|
| `packages/server/heartbeat.config.json` | NEW — editable defaults matching coded cadences |
| `packages/server/src/engine/heartbeat-config.ts` | NEW — loader + `applyHeartbeatConfig()` mutator |
| `packages/server/src/engine/heartbeat.ts` | adds `getEffectiveIntervals()` for introspection |
| `packages/server/src/routes/heartbeat.ts` | NEW route `GET /api/heartbeat/config` |
| `packages/server/src/index.ts` | calls `applyHeartbeatConfig()` before `heartbeat.register()` |
| `packages/server/src/__tests__/heartbeat-config.test.ts` | NEW — 11 vitest cases |
| `packages/server/package.json` | adds `heartbeat.config.json` to published files list |

### Config Schema

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

- **No hot reload.** Intentional: avoids coordination with running `setInterval` handles
- **No validation beyond type-checks.** Invalid `intervalMs` silently ignored (future: Ajv schema if file grows)
- **Cached load.** First `loadHeartbeatConfig()` call wins for process lifetime; tests use `_resetHeartbeatConfigCache()` escape hatch

## Follow-ups (Optional)

- Add Heartbeat UI panel that pretty-prints `/api/heartbeat/config` alongside per-sweep status cards
- Document precedence for hosted install: env var > config file > coded default

---

**Coordinator:** Brady
**Spawn Date:** 2026-05-16
**Wave Close Date:** 2026-05-16T02:55:00-07:00

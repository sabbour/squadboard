# Hockney P0/P1 backend fixes — 2026-05-20

## What changed
- Replaced the sweeper's raw UUID array splice with Drizzle `inArray()` so expired-step retries are parameterized instead of string-built.
- Wrapped workflow advancement write sequences in Drizzle transactions so step completion, review-run creation, fan-out state changes, handoffs, and cursor advancement commit atomically.
- Added a hard timeout path for `runWorker` agent runs, propagated timeout control into the Squad SDK bridge, and introduced terminal `timed_out` handling across engine/runtime surfaces.

## Why
- `sql.raw()` with interpolated row ids was a direct SQL injection vector.
- Multi-statement workflow advancement allowed concurrent workers to observe and write partial state, corrupting parent/child progression.
- Hung Squad SDK calls could renew heartbeats forever; explicit timeout + heartbeat teardown restores lease-based liveness and gives operators a visible terminal state instead of an immortal run.

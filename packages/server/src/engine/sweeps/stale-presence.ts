/**
 * sweeps/stale-presence.ts — Phase 3 Heartbeat
 *
 * Evicts in-memory presence records whose connectedAt is older than 60 s.
 * Presence is tracked in an in-memory map (presence.ts) — it resets on
 * restart, so there is no DB row to clean. A genuine WS client pings
 * frequently enough that its record is refreshed; truly stale entries are
 * phantom slots from crashed or silent-closed connections.
 *
 * Runs every 60 s by default.
 */
import type { Sweep, SweepResult } from '../heartbeat.js';
import { sweepStalePresence } from '../../realtime/presence.js';

const MAX_PRESENCE_AGE_MS = 60_000; // 60 seconds

export const stalePresenceSweep: Sweep = {
  id: 'stale-presence',
  label: 'Presence',
  description: 'Evicts stale browser presence records left behind by disconnected clients.',
  scope: 'mixed',
  intervalMs: 60_000,
  enabled: true,

  async run(): Promise<SweepResult> {
    const evicted = sweepStalePresence(MAX_PRESENCE_AGE_MS);
    return { acted: evicted, errors: 0 };
  },
};

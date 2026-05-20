/**
 * sweeps/idle-live-sessions.ts — Phase 3 Heartbeat
 *
 * Finds live_sessions that have been 'active' but have had no activity
 * (updatedAt) in the last 10 minutes, and marks them 'idle'.
 * The UI uses the idle state to dim the session card and stop the live
 * streaming animation.
 *
 * Runs every 120 s by default.
 */
import type { Sweep, SweepResult } from '../heartbeat.js';
import { getDb, schema } from '../../db/index.js';
import { and, eq, lt, sql } from 'drizzle-orm';

const IDLE_AFTER_MS = 10 * 60_000; // 10 minutes

export const idleLiveSessionsSweep: Sweep = {
  id: 'idle-live-sessions',
  label: 'Live sessions',
  description: 'Marks inactive live sessions idle so the UI stops showing them as actively streaming.',
  scope: 'project',
  intervalMs: 120_000,
  enabled: true,

  async run(): Promise<SweepResult> {
    const db = getDb();
    const cutoff = new Date(Date.now() - IDLE_AFTER_MS);

    const result = await db
      .update(schema.liveSessions)
      .set({ status: 'idle', updatedAt: new Date() })
      .where(
        and(
          eq(schema.liveSessions.status, 'active'),
          // updatedAt is the proxy for last activity — no separate lastActivityAt column.
          lt(schema.liveSessions.updatedAt, cutoff),
        ),
      )
      .returning({ id: schema.liveSessions.id });

    return { acted: result.length, errors: 0 };
  },
};

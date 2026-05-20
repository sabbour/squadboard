/**
 * log-monitor-drain.ts
 *
 * Sweep that periodically drains the in-process LogMonitor's queued repairs.
 * Safe auto-fix boundary: only disables repeatedly-failing sweeps via
 * heartbeat.setSweepEnabled(). No filesystem, schema, or external mutations.
 */
import type { Sweep, SweepResult } from '../heartbeat.js';
import { heartbeat } from '../heartbeat.js';
import { logMonitor } from '../../services/log-monitor.js';

export const logMonitorDrainSweep: Sweep = {
  id: 'log-monitor',
  label: 'Log monitor',
  description: 'Drains queued safe repairs identified by the in-process log monitor.',
  scope: 'system',
  intervalMs: 60_000,
  enabled: true,

  async run(): Promise<SweepResult> {
    const applied = await logMonitor.drain({
      setSweepEnabled: (id, enabled) => heartbeat.setSweepEnabled(id, enabled),
    });

    const { events, pendingFixes } = logMonitor.getState();

    return {
      acted: applied,
      errors: 0,
      details: [
        `events=${events.length}`,
        `pending=${pendingFixes.length}`,
        `applied=${applied}`,
      ].join(' '),
    };
  },
};

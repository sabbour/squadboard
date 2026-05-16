/**
 * heartbeat-config.test.ts — W25
 *
 * Verifies that per-sweep cadence overrides from heartbeat.config.json apply
 * correctly to registered Sweep objects. The config loader caches by module,
 * so each test mocks node:fs and resets the cache before running.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Sweep, SweepResult } from '../engine/heartbeat.js';

// Mock node:fs.readFileSync — we control what the config loader sees per test.
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

import { readFileSync } from 'node:fs';
import {
  loadHeartbeatConfig,
  applyHeartbeatConfig,
  _resetHeartbeatConfigCache,
} from '../engine/heartbeat-config.js';

const mockedReadFileSync = vi.mocked(readFileSync);

function makeSweep(id: string, intervalMs: number, enabled = true): Sweep {
  return {
    id,
    intervalMs,
    enabled,
    async run(): Promise<SweepResult> { return { acted: 0, errors: 0 }; },
  };
}

beforeEach(() => {
  _resetHeartbeatConfigCache();
  mockedReadFileSync.mockReset();
});

describe('loadHeartbeatConfig', () => {
  it('returns empty sweeps when the config file does not exist', () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockedReadFileSync.mockImplementation(() => { throw enoent; });

    const cfg = loadHeartbeatConfig();
    expect(cfg).toEqual({ sweeps: {} });
  });

  it('returns empty sweeps when the config file is invalid JSON', () => {
    mockedReadFileSync.mockReturnValue('not-json{');
    const cfg = loadHeartbeatConfig();
    expect(cfg).toEqual({ sweeps: {} });
  });

  it('returns the parsed config when the file is present and valid', () => {
    mockedReadFileSync.mockReturnValue(JSON.stringify({
      sweeps: { 'ceremonies-due': { intervalMs: 7777, enabled: true } },
    }));
    const cfg = loadHeartbeatConfig();
    expect(cfg.sweeps['ceremonies-due']).toEqual({ intervalMs: 7777, enabled: true });
  });

  it('caches the result across calls (file read only once)', () => {
    mockedReadFileSync.mockReturnValue(JSON.stringify({ sweeps: {} }));
    loadHeartbeatConfig();
    loadHeartbeatConfig();
    loadHeartbeatConfig();
    expect(mockedReadFileSync).toHaveBeenCalledTimes(1);
  });
});

describe('applyHeartbeatConfig', () => {
  it('leaves sweep intervals untouched when no override is present', () => {
    mockedReadFileSync.mockReturnValue(JSON.stringify({ sweeps: {} }));
    const sweep = makeSweep('ceremonies-due', 5000, true);
    applyHeartbeatConfig([sweep]);
    expect(sweep.intervalMs).toBe(5000);
    expect(sweep.enabled).toBe(true);
  });

  it('overrides intervalMs with the exact value when provided', () => {
    mockedReadFileSync.mockReturnValue(JSON.stringify({
      sweeps: { 'stuck-issue-runs': { intervalMs: 99999 } },
    }));
    const sweep = makeSweep('stuck-issue-runs', 30000, true);
    applyHeartbeatConfig([sweep]);
    expect(sweep.intervalMs).toBe(99999);
    expect(sweep.enabled).toBe(true);
  });

  it('scales intervalMs by multiplier when intervalMs is not set', () => {
    mockedReadFileSync.mockReturnValue(JSON.stringify({
      sweeps: { 'stale-presence': { multiplier: 5 } },
    }));
    const sweep = makeSweep('stale-presence', 30000, true);
    applyHeartbeatConfig([sweep]);
    expect(sweep.intervalMs).toBe(150000);
  });

  it('prefers intervalMs over multiplier when both are present', () => {
    mockedReadFileSync.mockReturnValue(JSON.stringify({
      sweeps: { 'idle-live-sessions': { intervalMs: 12345, multiplier: 99 } },
    }));
    const sweep = makeSweep('idle-live-sessions', 60000, true);
    applyHeartbeatConfig([sweep]);
    expect(sweep.intervalMs).toBe(12345);
  });

  it('toggles enabled=false when override sets it', () => {
    mockedReadFileSync.mockReturnValue(JSON.stringify({
      sweeps: { 'github-sync-overdue': { enabled: false } },
    }));
    const sweep = makeSweep('github-sync-overdue', 60000, true);
    applyHeartbeatConfig([sweep]);
    expect(sweep.enabled).toBe(false);
    expect(sweep.intervalMs).toBe(60000); // unchanged
  });

  it('ignores invalid intervalMs (0 / negative / wrong type)', () => {
    mockedReadFileSync.mockReturnValue(JSON.stringify({
      sweeps: {
        'a': { intervalMs: 0 },
        'b': { intervalMs: -1 },
        'c': { intervalMs: 'fast' as unknown as number },
      },
    }));
    const a = makeSweep('a', 1000, true);
    const b = makeSweep('b', 1000, true);
    const c = makeSweep('c', 1000, true);
    applyHeartbeatConfig([a, b, c]);
    expect(a.intervalMs).toBe(1000);
    expect(b.intervalMs).toBe(1000);
    expect(c.intervalMs).toBe(1000);
  });

  it('applies overrides to multiple sweeps in a single call', () => {
    mockedReadFileSync.mockReturnValue(JSON.stringify({
      sweeps: {
        'sweep-a': { intervalMs: 100 },
        'sweep-b': { multiplier: 2 },
        'sweep-c': { enabled: false },
      },
    }));
    const a = makeSweep('sweep-a', 1000, true);
    const b = makeSweep('sweep-b', 1000, true);
    const c = makeSweep('sweep-c', 1000, true);
    const d = makeSweep('sweep-d', 1000, true); // no override
    applyHeartbeatConfig([a, b, c, d]);
    expect(a.intervalMs).toBe(100);
    expect(b.intervalMs).toBe(2000);
    expect(c.enabled).toBe(false);
    expect(d.intervalMs).toBe(1000);
  });
});

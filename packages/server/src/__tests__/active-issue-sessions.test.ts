/**
 * active-issue-sessions.test.ts — Wave 28 JIS-T5 regression
 *
 * Verifies register/get/unregister/list behaviour and checks for
 * registration leaks (unregister cleans up completely).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  register,
  get,
  unregister,
  list,
  type RunningIssueSession,
} from '../engine/active-issue-sessions.js';

// ---------------------------------------------------------------------------
// Helpers: minimal RunningIssueSession implementation for testing
// ---------------------------------------------------------------------------

function makeSession(runId: string, projectId = 'proj-001'): RunningIssueSession {
  return {
    getRunId:    () => runId,
    getProjectId: () => projectId,
    steer:       async (_message: string, _actor?: string) => { /* no-op */ },
    dispose:     async () => { /* no-op */ },
  };
}

// ---------------------------------------------------------------------------
// Reset registry between tests to prevent state leaks.
// Since the module uses a module-level Map, unregister all known run IDs.
// ---------------------------------------------------------------------------

const TEST_RUN_IDS = ['run-alpha', 'run-beta', 'run-gamma'];

beforeEach(() => {
  TEST_RUN_IDS.forEach(id => unregister(id));
});

// ---------------------------------------------------------------------------
// register / get
// ---------------------------------------------------------------------------

describe('register() and get()', () => {
  it('registers a session and retrieves it by runId', () => {
    const session = makeSession('run-alpha');
    register('run-alpha', session);

    const found = get('run-alpha');
    expect(found).toBe(session);
  });

  it('get() returns undefined for unregistered runId', () => {
    expect(get('run-nonexistent')).toBeUndefined();
  });

  it('register() overwrites an existing entry (restart semantics)', () => {
    const s1 = makeSession('run-alpha');
    const s2 = makeSession('run-alpha');
    register('run-alpha', s1);
    register('run-alpha', s2);

    expect(get('run-alpha')).toBe(s2);
    expect(get('run-alpha')).not.toBe(s1);
  });

  it('getRunId() on retrieved session returns the correct id', () => {
    const session = makeSession('run-beta');
    register('run-beta', session);

    const found = get('run-beta');
    expect(found?.getRunId()).toBe('run-beta');
  });

  it('getProjectId() on retrieved session returns correct project', () => {
    const session = makeSession('run-beta', 'proj-xyz');
    register('run-beta', session);

    const found = get('run-beta');
    expect(found?.getProjectId()).toBe('proj-xyz');
  });
});

// ---------------------------------------------------------------------------
// unregister
// ---------------------------------------------------------------------------

describe('unregister()', () => {
  it('removes the session from the registry', () => {
    const session = makeSession('run-alpha');
    register('run-alpha', session);
    unregister('run-alpha');

    expect(get('run-alpha')).toBeUndefined();
  });

  it('unregister() on an unknown runId is a no-op (does not throw)', () => {
    expect(() => unregister('run-never-registered')).not.toThrow();
  });

  it('unregistering one session does not affect others', () => {
    const sA = makeSession('run-alpha');
    const sB = makeSession('run-beta');
    register('run-alpha', sA);
    register('run-beta', sB);

    unregister('run-alpha');

    expect(get('run-alpha')).toBeUndefined();
    expect(get('run-beta')).toBe(sB);
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe('list()', () => {
  it('returns an empty array when no sessions are registered', () => {
    // All test run IDs cleared in beforeEach
    const all = list();
    const testIds = all.filter(({ runId }) => TEST_RUN_IDS.includes(runId));
    expect(testIds).toHaveLength(0);
  });

  it('lists all registered sessions', () => {
    const sA = makeSession('run-alpha');
    const sB = makeSession('run-beta');
    register('run-alpha', sA);
    register('run-beta', sB);

    const all = list();
    const testEntries = all.filter(({ runId }) => TEST_RUN_IDS.includes(runId));

    expect(testEntries).toHaveLength(2);
    expect(testEntries.map(e => e.runId).sort()).toEqual(['run-alpha', 'run-beta']);
    expect(testEntries.find(e => e.runId === 'run-alpha')?.session).toBe(sA);
    expect(testEntries.find(e => e.runId === 'run-beta')?.session).toBe(sB);
  });

  it('list() returns a snapshot — removing from map does not mutate the snapshot', () => {
    const sA = makeSession('run-alpha');
    register('run-alpha', sA);

    const snapshot = list();
    unregister('run-alpha');

    // Snapshot captured before unregister — still has the entry
    const entry = snapshot.find(e => e.runId === 'run-alpha');
    expect(entry).toBeDefined();
    expect(entry?.session).toBe(sA);

    // But live get() reflects the unregister
    expect(get('run-alpha')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// No-leak checks
// ---------------------------------------------------------------------------

describe('no-leak checks', () => {
  it('registered session is fully removed after unregister', () => {
    const session = makeSession('run-gamma');
    register('run-gamma', session);
    expect(get('run-gamma')).toBeDefined();

    unregister('run-gamma');
    expect(get('run-gamma')).toBeUndefined();

    const all = list();
    expect(all.find(e => e.runId === 'run-gamma')).toBeUndefined();
  });

  it('steer() interface is callable without errors', async () => {
    const session = makeSession('run-alpha');
    register('run-alpha', session);

    const found = get('run-alpha');
    expect(found).toBeDefined();
    await expect(found!.steer('please focus on tests', 'user-123')).resolves.toBeUndefined();
  });

  it('dispose() interface is callable without errors', async () => {
    const session = makeSession('run-beta');
    register('run-beta', session);

    const found = get('run-beta');
    expect(found).toBeDefined();
    await expect(found!.dispose()).resolves.toBeUndefined();
  });
});

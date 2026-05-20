/**
 * W30 M3 — Process handlers unit tests.
 *
 * Tests the pure functions (formatUnhandledRejection, formatUncaughtException, gracefulTeardown).
 * These can be tested without actually subscribing to process.on() and crashing the test runner.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatBackendErrorLog,
  formatUnhandledRejection,
  formatUncaughtException,
  gracefulTeardown,
} from '../process-handlers.js';

/**
 * Helper: produce a rejected promise that won't trigger an
 * `unhandledRejection` event on the test runtime. The function under
 * test (`formatUnhandledRejection`) only inspects the rejection reason
 * passed alongside the promise, so attaching a no-op `.catch` here is
 * test-only noise reduction — the promise is still in the rejected state
 * when handed to the formatter.
 */
function silentlyRejected<T = unknown>(reason: T): Promise<T> {
  const p = Promise.reject(reason);
  p.catch(() => {});
  return p;
}

function parseLog(line: string): Record<string, unknown> {
  return JSON.parse(line) as Record<string, unknown>;
}

describe('process-handlers — formatUnhandledRejection', () => {
  it('formats an Error rejection with stack trace', () => {
    const err = new Error('Something went wrong');
    err.stack = 'Error: Something went wrong\n  at file.ts:10';

    const result = formatUnhandledRejection(err, silentlyRejected(err));

    const log = parseLog(result);
    expect(log.event).toBe('unhandledRejection');
    expect(log.source).toBe('process');
    expect(log.severity).toBe('fatal');
    expect(log.message).toBe('Something went wrong');
    expect(log.stack).toContain('at file.ts:10');
  });

  it('handles Error with no stack', () => {
    const err = new Error('No stack error');
    err.stack = undefined;

    const result = formatUnhandledRejection(err, silentlyRejected(err));

    const log = parseLog(result);
    expect(log.message).toBe('No stack error');
    expect(log.stack).toBe('(no stack)');
  });

  it('formats a string rejection', () => {
    const result = formatUnhandledRejection('string rejection', silentlyRejected('string'));

    expect(parseLog(result).message).toBe('string rejection');
  });

  it('formats null rejection', () => {
    const result = formatUnhandledRejection(null, silentlyRejected(null));

    expect(parseLog(result).message).toContain('null');
  });

  it('formats undefined rejection', () => {
    const result = formatUnhandledRejection(undefined, silentlyRejected(undefined));

    expect(parseLog(result).message).toContain('undefined');
  });

  it('formats object rejection as JSON', () => {
    const obj = { error: 'test', code: 42 };
    const result = formatUnhandledRejection(obj, silentlyRejected(obj));

    const log = parseLog(result);
    expect(log.reasonType).toBe('Object');
    expect(log.details).toContain('error');
    expect(log.details).toContain('test');
    expect(log.details).toContain('42');
  });

  it('handles circular reference in object rejection', () => {
    const circular: any = { a: 1 };
    circular.self = circular; // Create circular reference

    const result = formatUnhandledRejection(circular, silentlyRejected(circular));

    expect(parseLog(result).message).toContain('circular');
  });

  it('includes timestamp', () => {
    const result = formatUnhandledRejection('test', silentlyRejected('test'));

    expect(parseLog(result).timestamp).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // ISO timestamp
  });
});

describe('process-handlers — formatUncaughtException', () => {
  it('formats an Error with stack trace', () => {
    const err = new Error('Uncaught error');
    err.stack = 'Error: Uncaught error\n  at app.ts:20';

    const result = formatUncaughtException(err);

    const log = parseLog(result);
    expect(log.event).toBe('uncaughtException');
    expect(log.source).toBe('process');
    expect(log.severity).toBe('fatal');
    expect(log.message).toBe('Uncaught error');
    expect(log.stack).toContain('at app.ts:20');
  });

  it('handles Error with no stack', () => {
    const err = new Error('No stack');
    err.stack = undefined;

    const result = formatUncaughtException(err);

    const log = parseLog(result);
    expect(log.message).toBe('No stack');
    expect(log.stack).toContain('no stack trace');
  });

  it('includes timestamp', () => {
    const err = new Error('test');
    const result = formatUncaughtException(err);

    expect(parseLog(result).timestamp).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // ISO timestamp
  });
});

describe('process-handlers — formatBackendErrorLog', () => {
  it('emits structured JSON with context for backend errors', () => {
    const line = formatBackendErrorLog(
      'http.route_error',
      new Error('route exploded'),
      { method: 'GET', path: '/api/test', status: 500 },
    );

    const log = parseLog(line);
    expect(log.component).toBe('squadboard');
    expect(log.event).toBe('http.route_error');
    expect(log.severity).toBe('error');
    expect(log.message).toBe('route exploded');
    expect(log.context).toMatchObject({ method: 'GET', path: '/api/test', status: 500 });
  });
});

describe('process-handlers — gracefulTeardown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('completes gracefully when teardown succeeds quickly', async () => {
    const teardownFn = vi.fn().mockResolvedValue(undefined) as () => Promise<void>;

    const promise = gracefulTeardown(teardownFn, 5000);
    await vi.runAllTimersAsync();

    expect(teardownFn).toHaveBeenCalledOnce();
    await expect(promise).resolves.toBeUndefined();
  });

  it('fires timeout callback if teardown exceeds timeout', async () => {
    const onTimeoutFn = vi.fn();
    const teardownFn = vi.fn(
      () => new Promise((resolve) => setTimeout(resolve, 10000)),
    ) as () => Promise<void>;

    const promise = gracefulTeardown(teardownFn, 1000, onTimeoutFn);

    await vi.advanceTimersByTimeAsync(1000);

    expect(onTimeoutFn).toHaveBeenCalledOnce();
    await expect(promise).resolves.toBeUndefined();
  });

  it('resolves even if teardown throws', async () => {
    const teardownFn = vi.fn().mockRejectedValue(new Error('teardown failed')) as () => Promise<void>;

    const promise = gracefulTeardown(teardownFn, 5000);
    await vi.runAllTimersAsync();

    expect(teardownFn).toHaveBeenCalledOnce();
    // Should not throw — should resolve normally
    await expect(promise).resolves.toBeUndefined();
  });

  it('uses default timeout of 5000ms', async () => {
    const timeoutFn = vi.fn();
    const teardownFn = vi.fn(
      () => new Promise((resolve) => setTimeout(resolve, 10000)),
    ) as () => Promise<void>;

    const promise = gracefulTeardown(teardownFn, undefined, timeoutFn);

    await vi.advanceTimersByTimeAsync(5000);

    expect(timeoutFn).toHaveBeenCalledOnce();
    await expect(promise).resolves.toBeUndefined();
  });

  it('does not call onTimeout if teardown completes before timeout', async () => {
    const onTimeoutFn = vi.fn();
    const teardownFn = vi.fn().mockResolvedValue(undefined) as () => Promise<void>;

    const promise = gracefulTeardown(teardownFn, 5000, onTimeoutFn);
    await vi.runAllTimersAsync();

    expect(onTimeoutFn).not.toHaveBeenCalled();
    await expect(promise).resolves.toBeUndefined();
  });

  it('handles teardown that completes after timeout has fired', async () => {
    // A stray resolve after timeout has fired should not cause double-resolution
    let resolveTeradown: () => void;
    const teardownFn = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveTeradown = resolve;
        }),
    ) as () => Promise<void>;

    const promise = gracefulTeardown(teardownFn, 1000);

    // Advance past timeout
    await vi.advanceTimersByTimeAsync(1000);
    expect(teardownFn).toHaveBeenCalledOnce();

    // Now resolve the teardown (after timeout has fired)
    resolveTeradown!();
    await vi.runAllTimersAsync();

    // Should still resolve correctly without errors
    await expect(promise).resolves.toBeUndefined();
  });
});

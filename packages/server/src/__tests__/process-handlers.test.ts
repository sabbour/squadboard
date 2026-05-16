/**
 * W30 M3 — Process handlers unit tests.
 *
 * Tests the pure functions (formatUnhandledRejection, formatUncaughtException, gracefulTeardown).
 * These can be tested without actually subscribing to process.on() and crashing the test runner.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatUnhandledRejection,
  formatUncaughtException,
  gracefulTeardown,
} from '../process-handlers.js';

describe('process-handlers — formatUnhandledRejection', () => {
  it('formats an Error rejection with stack trace', () => {
    const err = new Error('Something went wrong');
    err.stack = 'Error: Something went wrong\n  at file.ts:10';

    const result = formatUnhandledRejection(err, Promise.reject(err));

    expect(result).toContain('unhandledRejection');
    expect(result).toContain('Something went wrong');
    expect(result).toContain('at file.ts:10');
  });

  it('handles Error with no stack', () => {
    const err = new Error('No stack error');
    err.stack = undefined;

    const result = formatUnhandledRejection(err, Promise.reject(err));

    expect(result).toContain('No stack error');
    expect(result).toContain('(no stack)');
  });

  it('formats a string rejection', () => {
    const result = formatUnhandledRejection('string rejection', Promise.reject('string'));

    expect(result).toContain('string rejection');
  });

  it('formats null rejection', () => {
    const result = formatUnhandledRejection(null, Promise.reject(null));

    expect(result).toContain('null');
  });

  it('formats undefined rejection', () => {
    const result = formatUnhandledRejection(undefined, Promise.reject(undefined));

    expect(result).toContain('undefined');
  });

  it('formats object rejection as JSON', () => {
    const obj = { error: 'test', code: 42 };
    const result = formatUnhandledRejection(obj, Promise.reject(obj));

    expect(result).toContain('error');
    expect(result).toContain('test');
    expect(result).toContain('42');
  });

  it('handles circular reference in object rejection', () => {
    const circular: any = { a: 1 };
    circular.self = circular; // Create circular reference

    const result = formatUnhandledRejection(circular, Promise.reject(circular));

    expect(result).toContain('circular');
  });

  it('includes timestamp', () => {
    const result = formatUnhandledRejection('test', Promise.reject('test'));

    expect(result).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // ISO timestamp
  });
});

describe('process-handlers — formatUncaughtException', () => {
  it('formats an Error with stack trace', () => {
    const err = new Error('Uncaught error');
    err.stack = 'Error: Uncaught error\n  at app.ts:20';

    const result = formatUncaughtException(err);

    expect(result).toContain('uncaughtException');
    expect(result).toContain('Uncaught error');
    expect(result).toContain('at app.ts:20');
  });

  it('handles Error with no stack', () => {
    const err = new Error('No stack');
    err.stack = undefined;

    const result = formatUncaughtException(err);

    expect(result).toContain('No stack');
    expect(result).toContain('no stack trace');
  });

  it('includes timestamp', () => {
    const err = new Error('test');
    const result = formatUncaughtException(err);

    expect(result).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // ISO timestamp
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

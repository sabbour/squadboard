/**
 * W30 M3 — Process error handlers for unhandledRejection and uncaughtException.
 *
 * Extracts error formatting and graceful teardown logic into pure functions
 * for testability. The actual process.on() subscriptions happen in index.ts.
 */

export type BackendLogSeverity = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

interface NormalizedError {
  reasonType: string;
  message: string;
  name?: string;
  stack?: string;
  details?: string;
}

interface BackendLogRecord extends NormalizedError {
  component: 'squadboard';
  event: string;
  source: string;
  severity: BackendLogSeverity;
  timestamp: string;
  context?: Record<string, unknown>;
}

const MAX_FIELD_LENGTH = 4_000;

function truncate(value: string): string {
  return value.length > MAX_FIELD_LENGTH
    ? `${value.slice(0, MAX_FIELD_LENGTH)}…[truncated ${value.length - MAX_FIELD_LENGTH} chars]`
    : value;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return `[circular or non-serializable] ${String(value)}`;
  }
}

function normalizeUnknownError(value: unknown, fallbackMessage = 'Unknown error'): NormalizedError {
  if (value instanceof Error) {
    return {
      reasonType: 'Error',
      name: value.name,
      message: value.message || fallbackMessage,
      stack: truncate(value.stack ?? '(no stack)'),
    };
  }

  if (typeof value === 'string') {
    return { reasonType: 'string', message: value };
  }

  if (value === null) {
    return { reasonType: 'null', message: 'Promise rejected with null' };
  }

  if (value === undefined) {
    return { reasonType: 'undefined', message: 'Promise rejected with undefined' };
  }

  if (typeof value === 'object') {
    const details = safeStringify(value);
    return {
      reasonType: value.constructor?.name ?? 'object',
      message: truncate(details),
      details: truncate(details),
    };
  }

  return { reasonType: typeof value, message: String(value) };
}

function stringifyRecord(record: BackendLogRecord): string {
  return JSON.stringify(record);
}

export function formatBackendErrorLog(
  event: string,
  err: unknown,
  context?: Record<string, unknown>,
  severity: BackendLogSeverity = 'error',
  source = 'backend',
): string {
  return stringifyRecord({
    component: 'squadboard',
    event,
    source,
    severity,
    timestamp: new Date().toISOString(),
    ...normalizeUnknownError(err),
    ...(context ? { context } : {}),
  });
}

/**
 * Format an unhandled rejection reason as one structured JSON log line.
 * Handles Error objects, strings, primitives, and circular references.
 */
export function formatUnhandledRejection(reason: unknown, _promise: Promise<unknown>): string {
  return formatBackendErrorLog(
    'unhandledRejection',
    reason,
    undefined,
    'fatal',
    'process',
  );
}

/**
 * Format an uncaught exception as one structured JSON log line.
 */
export function formatUncaughtException(err: Error): string {
  return formatBackendErrorLog(
    'uncaughtException',
    err.stack ? err : Object.assign(err, { stack: '(no stack trace)' }),
    undefined,
    'fatal',
    'process',
  );
}

/**
 * Graceful teardown with timeout.
 *
 * Attempts to run an async teardown function with a hard timeout.
 * If teardown stalls beyond timeoutMs, force-exits.
 *
 * @param teardownFn — async function that performs shutdown (e.g., CHECKPOINT, closeDb)
 * @param timeoutMs — hard timeout in milliseconds (default 5000)
 * @param onTimeout — callback if timeout fires (default: no-op)
 * @returns Promise that settles after teardown completes or timeout fires
 */
export async function gracefulTeardown(
  teardownFn: () => Promise<void>,
  timeoutMs: number = 5000,
  onTimeout?: () => void,
): Promise<void> {
  const startMs = Date.now();
  console.log(JSON.stringify({
    component: 'squadboard',
    event: 'teardown.start',
    source: 'process',
    severity: 'info',
    timestamp: new Date().toISOString(),
  }));

  return new Promise((resolve) => {
    let settled = false;

    // Set hard timeout: if teardown takes too long, force resolution.
    const timeoutHandle = setTimeout(() => {
      if (!settled) {
        settled = true;
        const durationMs = Date.now() - startMs;
        console.log(JSON.stringify({
          component: 'squadboard',
          event: 'teardown.timeout',
          source: 'process',
          severity: 'error',
          timestamp: new Date().toISOString(),
          durationMs,
        }));
        if (onTimeout) onTimeout();
        resolve();
      }
    }, timeoutMs);

    // Run the teardown. Once it settles, clear the timeout and resolve.
    teardownFn()
      .catch((err) => {
        // Teardown threw — log but don't re-throw so we can still exit cleanly.
        const durationMs = Date.now() - startMs;
        console.error(formatBackendErrorLog('teardown.error', err, { durationMs }, 'error', 'process'));
      })
      .finally(() => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutHandle);
          const durationMs = Date.now() - startMs;
          console.log(JSON.stringify({
            component: 'squadboard',
            event: 'teardown.done',
            source: 'process',
            severity: 'info',
            timestamp: new Date().toISOString(),
            durationMs,
          }));
          resolve();
        }
      });
  });
}

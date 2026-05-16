/**
 * W30 M3 — Process error handlers for unhandledRejection and uncaughtException.
 *
 * Extracts error formatting and graceful teardown logic into pure functions
 * for testability. The actual process.on() subscriptions happen in index.ts.
 */

/**
 * Format an unhandled rejection reason into a loggable string.
 * Handles Error objects, strings, primitives, and circular references.
 */
export function formatUnhandledRejection(reason: unknown, promise: Promise<unknown>): string {
  const timestamp = new Date().toISOString();
  let reasonStr = '';

  if (reason instanceof Error) {
    reasonStr = `${reason.message}\n${reason.stack ?? '(no stack)'}`;
  } else if (typeof reason === 'string') {
    reasonStr = reason;
  } else if (reason === null) {
    reasonStr = 'Promise rejected with null';
  } else if (reason === undefined) {
    reasonStr = 'Promise rejected with undefined';
  } else if (typeof reason === 'object') {
    try {
      reasonStr = JSON.stringify(reason, null, 2);
    } catch (e) {
      reasonStr = `[circular or non-serializable] ${String(reason)}`;
    }
  } else {
    reasonStr = String(reason);
  }

  return `[squadboard] unhandledRejection at ${timestamp}\n${reasonStr}`;
}

/**
 * Format an uncaught exception into a loggable string.
 */
export function formatUncaughtException(err: Error): string {
  const timestamp = new Date().toISOString();
  const stack = err.stack ?? `${err.message}\n(no stack trace)`;
  return `[squadboard] uncaughtException at ${timestamp}\n${stack}`;
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
  return new Promise((resolve) => {
    let settled = false;

    // Set hard timeout: if teardown takes too long, force resolution.
    const timeoutHandle = setTimeout(() => {
      if (!settled) {
        settled = true;
        if (onTimeout) onTimeout();
        resolve();
      }
    }, timeoutMs);

    // Run the teardown. Once it settles, clear the timeout and resolve.
    teardownFn()
      .catch((err) => {
        // Teardown threw — log but don't re-throw so we can still exit cleanly.
        console.error('[squadboard] teardown error (non-fatal):', err);
      })
      .finally(() => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutHandle);
          resolve();
        }
      });
  });
}

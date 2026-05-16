/**
 * packages/server/src/daemon/invoker.ts
 *
 * Ceremony invoker — calls squadboard.scribe.closeOut() via the ceremony
 * registry. Falls back to a stub if the q8 SDK function hasn't landed yet.
 *
 * The invoker is intentionally thin: it does not own retry logic. If the
 * ceremony fails, the daemon logs the failure, marks isCeremonyRunning=false,
 * and waits for the next tick.
 */

// ---------------------------------------------------------------------------
// q8 dependency — Kobayashi's closeOut SDK function
//
// TODO(q8): import { closeOut } from '@sabbour/squadboard-sdk'
// When Kobayashi's PR lands, replace the stub below with the real import.
// ---------------------------------------------------------------------------

export interface CloseOutResult {
  ceremonyId: string;
  committedAt?: string;
  filesChanged?: number;
  summary?: string;
  error?: string;
}

// Stub shim — returns a fake CloseOutResult so the daemon loop works before q8 lands.
async function closeOutStub(): Promise<CloseOutResult> {
  console.log('[daemon:invoker] closeOut stub invoked (q8 not yet landed)');
  return {
    ceremonyId: 'scribe-close-out',
    committedAt: new Date().toISOString(),
    filesChanged: 0,
    summary: 'stub — no-op until @sabbour/squadboard-sdk closeOut is available',
  };
}

// ---------------------------------------------------------------------------
// Try to load the real SDK (graceful degradation)
// ---------------------------------------------------------------------------

type CloseOutFn = () => Promise<CloseOutResult>;

async function resolveCloseOut(): Promise<CloseOutFn> {
  // When q8 lands, Kobayashi registers the ceremony in services/ceremony-translator.ts
  // and exports closeOut from @sabbour/squadboard-sdk. Until then, use stub.
  try {
    // Dynamic import so missing module doesn't crash the daemon at startup.
    // TODO(q8): replace module path with actual SDK path
    const sdk = await import('@sabbour/squadboard-sdk' as string).catch(
      () => null,
    );
    if (sdk && typeof (sdk as Record<string, unknown>).closeOut === 'function') {
      console.log('[daemon:invoker] @sabbour/squadboard-sdk closeOut resolved — using real implementation');
      return (sdk as { closeOut: CloseOutFn }).closeOut;
    }
  } catch {
    // SDK not available — fall through to stub
  }
  console.log('[daemon:invoker] @sabbour/squadboard-sdk not available — using stub (q8 pending)');
  return closeOutStub;
}

// Resolve once at module load; re-use across ticks.
const closeOutPromise: Promise<CloseOutFn> = resolveCloseOut();

// ---------------------------------------------------------------------------
// Public invoker
// ---------------------------------------------------------------------------

export interface InvokerResult {
  ceremonyId: 'scribe-close-out';
  result: CloseOutResult;
  durationMs: number;
  error?: string;
}

export async function invokeCeremony(): Promise<InvokerResult> {
  const closeOut = await closeOutPromise;
  const start = Date.now();

  try {
    const result = await closeOut();
    return {
      ceremonyId: 'scribe-close-out',
      result,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ceremonyId: 'scribe-close-out',
      result: {
        ceremonyId: 'scribe-close-out',
        error: message,
      },
      durationMs: Date.now() - start,
      error: message,
    };
  }
}

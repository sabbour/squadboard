/**
 * packages/server/src/daemon/invoker.ts
 *
 * Ceremony invoker — calls the shared server Scribe close-out service, which
 * in turn invokes the SDK convergence point: squadboard.scribe.closeOut().
 *
 * The invoker is intentionally thin: it does not own retry logic. If the
 * ceremony fails, the daemon logs the failure, marks isCeremonyRunning=false,
 * and waits for the next tick.
 */

import {
  invokeScribeCloseOut,
  type ScribeCloseOutResult,
  type ScribeCloseOutSource,
} from '../services/scribe-closeout.js';

export type CloseOutResult = ScribeCloseOutResult | {
  ceremonyId: 'scribe-close-out';
  source: ScribeCloseOutSource;
  projectId: string | null;
  healthReportPath: null;
  metadataPath: null;
  error?: string;
};

export interface InvokerOptions {
  projectId?: string | null;
  teamRoot?: string | null;
  source?: ScribeCloseOutSource;
  extra?: Record<string, unknown> | null;
  captureCloseout?: boolean;
  callMcp?: boolean;
}

// ---------------------------------------------------------------------------
// Public invoker
// ---------------------------------------------------------------------------

export interface InvokerResult {
  ceremonyId: 'scribe-close-out';
  result: CloseOutResult;
  durationMs: number;
  teamRoot?: string;
  error?: string;
}

export async function invokeCeremony(opts: InvokerOptions = {}): Promise<InvokerResult> {
  const start = Date.now();
  const projectId = opts.projectId?.trim() || process.env.SQUADBOARD_DEFAULT_PROJECT_ID?.trim() || null;
  const source = opts.source ?? 'daemon';

  try {
    const result = await invokeScribeCloseOut({
      projectId,
      teamRoot: opts.teamRoot,
      source,
      extra: opts.extra,
      captureCloseout: opts.captureCloseout,
      callMcp: opts.callMcp,
    });
    return {
      ceremonyId: 'scribe-close-out',
      result,
      durationMs: Date.now() - start,
      teamRoot: result.teamRoot,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ceremonyId: 'scribe-close-out',
      result: {
        ceremonyId: 'scribe-close-out',
        source,
        projectId,
        healthReportPath: null,
        metadataPath: null,
        error: message,
      },
      durationMs: Date.now() - start,
      error: message,
    };
  }
}

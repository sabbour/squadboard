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
// Stub shim — returns a fake CloseOutResult so the daemon loop works before q8 lands.
async function closeOutStub() {
    console.log('[daemon:invoker] closeOut stub invoked (q8 not yet landed)');
    return {
        ceremonyId: 'scribe-close-out',
        committedAt: new Date().toISOString(),
        filesChanged: 0,
        summary: 'stub — no-op until @sabbour/squadboard-sdk closeOut is available',
    };
}
async function resolveCloseOut() {
    // When q8 lands, Kobayashi registers the ceremony in services/ceremony-translator.ts
    // and exports closeOut from @sabbour/squadboard-sdk. Until then, use stub.
    try {
        // Dynamic import so missing module doesn't crash the daemon at startup.
        // TODO(q8): replace module path with actual SDK path
        const sdk = await import('@sabbour/squadboard-sdk').catch(() => null);
        if (sdk && typeof sdk.closeOut === 'function') {
            console.log('[daemon:invoker] @sabbour/squadboard-sdk closeOut resolved — using real implementation');
            return sdk.closeOut;
        }
    }
    catch {
        // SDK not available — fall through to stub
    }
    console.log('[daemon:invoker] @sabbour/squadboard-sdk not available — using stub (q8 pending)');
    return closeOutStub;
}
// Resolve once at module load; re-use across ticks.
const closeOutPromise = resolveCloseOut();
export async function invokeCeremony() {
    const closeOut = await closeOutPromise;
    const start = Date.now();
    try {
        const result = await closeOut();
        return {
            ceremonyId: 'scribe-close-out',
            result,
            durationMs: Date.now() - start,
        };
    }
    catch (err) {
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
//# sourceMappingURL=invoker.js.map
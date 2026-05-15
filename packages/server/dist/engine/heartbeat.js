/**
 * heartbeat.ts — Phase 3
 *
 * Sweep registry that replaces the monolithic dispatcher tick.
 * Each sweep runs on its own interval; one failure never stops others.
 *
 * EventBus events emitted:
 *   heartbeat.sweep.completed — {sweepId, result, durationMs}
 *   heartbeat.sweep.error     — {sweepId, error, durationMs}
 */
import { eventBus } from '../realtime/event-bus.js';
// ─── Heartbeat class ──────────────────────────────────────────────────────────
export class Heartbeat {
    registry = new Map();
    running = false;
    lastTickAt;
    lastError;
    /** Add a sweep to the registry. Must be called before start(). */
    register(sweep) {
        this.registry.set(sweep.id, { sweep });
    }
    /** Schedule all enabled sweeps on their individual intervals. */
    start() {
        if (this.running)
            return;
        this.running = true;
        console.log(`[heartbeat] starting — ${this.registry.size} sweep(s) registered`);
        for (const state of this.registry.values()) {
            this._schedule(state);
        }
    }
    /** Clear all intervals cleanly. */
    stop() {
        if (!this.running)
            return;
        this.running = false;
        for (const state of this.registry.values()) {
            if (state.intervalHandle) {
                clearInterval(state.intervalHandle);
                state.intervalHandle = undefined;
            }
        }
        console.log('[heartbeat] stopped');
    }
    /**
     * Manual run — used by tests and the "Run now" UI button.
     * If sweepId is omitted, runs ALL registered sweeps once.
     */
    async tick(sweepId) {
        if (sweepId !== undefined) {
            const state = this.registry.get(sweepId);
            if (!state)
                throw new Error(`[heartbeat] unknown sweep: ${sweepId}`);
            await this._runSweep(state);
        }
        else {
            for (const state of this.registry.values()) {
                await this._runSweep(state);
            }
        }
    }
    /**
     * Returns a status snapshot used by GET /api/heartbeat and the
     * Heartbeat panel in the Diagnostics UI.
     */
    getStatus() {
        return {
            lastTickAt: this.lastTickAt?.toISOString(),
            lastError: this.lastError,
            sweeps: Array.from(this.registry.values()).map((state) => ({
                id: state.sweep.id,
                enabled: state.sweep.enabled,
                lastResult: state.lastResult,
                lastRunAt: state.lastRunAt?.toISOString(),
                nextRunAt: state.nextRunAt?.toISOString(),
                lastError: state.lastError,
            })),
        };
    }
    /**
     * Toggle the enabled flag of a registered sweep by id.
     * Used by PATCH /api/heartbeat/sweeps/:id in the route layer.
     */
    setSweepEnabled(id, enabled) {
        const state = this.registry.get(id);
        if (!state)
            throw new Error(`[heartbeat] unknown sweep: ${id}`);
        state.sweep.enabled = enabled;
        if (enabled && this.running && !state.intervalHandle) {
            // Re-schedule if it wasn't scheduled before.
            this._schedule(state);
        }
        else if (!enabled && state.intervalHandle) {
            clearInterval(state.intervalHandle);
            state.intervalHandle = undefined;
        }
    }
    // ─── Private helpers ────────────────────────────────────────────────────────
    _schedule(state) {
        if (!state.sweep.enabled)
            return;
        state.nextRunAt = new Date(Date.now() + state.sweep.intervalMs);
        state.intervalHandle = setInterval(async () => {
            await this._runSweep(state);
        }, state.sweep.intervalMs);
    }
    async _runSweep(state) {
        if (!state.sweep.enabled)
            return;
        const start = Date.now();
        this.lastTickAt = new Date();
        state.lastRunAt = new Date();
        // Optimistically advance nextRunAt so the status UI always shows something reasonable.
        state.nextRunAt = new Date(Date.now() + state.sweep.intervalMs);
        try {
            const result = await state.sweep.run();
            const durationMs = Date.now() - start;
            state.lastResult = result;
            delete state.lastError;
            eventBus.emitHeartbeatEvent('heartbeat.sweep.completed', {
                sweepId: state.sweep.id,
                result,
                durationMs,
            });
            if (result.acted > 0 || process.env.LOG_LEVEL === 'debug') {
                console.log(`[heartbeat] ${state.sweep.id} — acted=${result.acted} errors=${result.errors} (${durationMs}ms)` +
                    (result.details ? ` ${result.details}` : ''));
            }
        }
        catch (err) {
            const durationMs = Date.now() - start;
            const errorMsg = err instanceof Error ? err.message : String(err);
            state.lastError = errorMsg;
            this.lastError = `${state.sweep.id}: ${errorMsg}`;
            console.error(`[heartbeat] sweep ${state.sweep.id} threw:`, err);
            eventBus.emitHeartbeatEvent('heartbeat.sweep.error', {
                sweepId: state.sweep.id,
                error: errorMsg,
                durationMs,
            });
        }
    }
}
/** Singleton instance wired up in index.ts. */
export const heartbeat = new Heartbeat();
//# sourceMappingURL=heartbeat.js.map
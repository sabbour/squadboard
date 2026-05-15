/**
 * squad-stream.ts — Long-lived multi-turn SquadClient sessions, streamed.
 *
 * Wraps `@bradygaster/squad-sdk`'s SquadClient + Session into a
 * resource-managed, EventBus-publishing object that powers Squadboard's
 * Live Session UX. Unlike `squad-client.ts` (one-shot `sendAndWait`), each
 * RunningLiveSession stays open across many user turns, and forwards
 * granular SDK events to:
 *
 *   1. The `live_session_events` table (durable timeline)
 *   2. The in-process `eventBus` (which the WS server fans out to clients)
 *   3. Roll-up counters on the parent `live_sessions` row (tokens + cost)
 *
 * The set of currently-open sessions is held in-process; if the server
 * restarts, sessions are marked failed/cancelled and clients must start a
 * new one. (Persistent resume across restarts is a Phase 3 concern.)
 */
import { readFile } from 'node:fs/promises';
import { eq, sql as drizzleSql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { liveSessions, liveSessionEvents, agents as agentsTable, projects as projectsTable } from '../db/schema.js';
import { eventBus } from '../realtime/event-bus.js';
import { estimateCost } from './pricing.js';
import { resolveModel } from './model-defaults.js';
/** Read the field from an unknown SDK event without type errors. */
function pickString(obj, ...keys) {
    if (!obj || typeof obj !== 'object')
        return undefined;
    const o = obj;
    for (const k of keys) {
        const v = o[k];
        if (typeof v === 'string')
            return v;
        if (v && typeof v === 'object') {
            const nested = pickString(v, ...keys);
            if (nested !== undefined)
                return nested;
        }
    }
    return undefined;
}
function pickNumber(obj, ...keys) {
    if (!obj || typeof obj !== 'object')
        return undefined;
    const o = obj;
    for (const k of keys) {
        const v = o[k];
        if (typeof v === 'number')
            return v;
        if (v && typeof v === 'object') {
            const nested = pickNumber(v, ...keys);
            if (nested !== undefined)
                return nested;
        }
    }
    return undefined;
}
function summariseTitle(prompt) {
    const trimmed = prompt.trim().replace(/\s+/g, ' ');
    return trimmed.length <= 80 ? trimmed : `${trimmed.slice(0, 77)}…`;
}
/**
 * One running live session. Holds the SDK client + session and wires events.
 * Never share this across concurrent sendMessage calls — call `sendPrompt`
 * sequentially (the route enforces this via the session lock map).
 */
class RunningLiveSession {
    id;
    projectId;
    sdkSessionId;
    client;
    session;
    model;
    isClosed = false;
    constructor(args) {
        this.id = args.id;
        this.projectId = args.projectId;
        this.client = args.client;
        this.session = args.session;
        this.sdkSessionId = args.session.sessionId;
        this.model = args.model;
        this.attachListeners();
    }
    attachListeners() {
        // Names emitted by Squad SDK adapter (see node_modules/@bradygaster/squad-sdk/dist/adapter/client.js):
        //   assistant.message_delta | assistant.message | assistant.usage |
        //   assistant.reasoning_delta | assistant.reasoning |
        //   assistant.turn_start | assistant.turn_end | assistant.intent |
        //   session.idle | session.error
        this.session.on('assistant.message', (e) => this.onAssistantMessage(e));
        this.session.on('assistant.message_delta', (e) => this.onDelta(e));
        this.session.on('assistant.reasoning_delta', (e) => this.onReasoning(e));
        this.session.on('assistant.usage', (e) => this.onUsage(e));
        this.session.on('assistant.turn_start', (e) => this.publish('session.tool', { phase: 'turn_start', raw: e }));
        this.session.on('assistant.turn_end', (e) => this.publish('session.tool', { phase: 'turn_end', raw: e }));
        this.session.on('session.idle', () => this.publish('session.tool', { phase: 'idle' }));
        this.session.on('session.error', (e) => this.onError(e));
    }
    async publish(type, payload) {
        const enrichedPayload = { sessionId: this.id, ...payload };
        try {
            const db = getDb();
            await db.insert(liveSessionEvents).values({
                sessionId: this.id,
                type,
                payload: enrichedPayload,
            });
        }
        catch (err) {
            console.warn('[squad-stream] failed to persist event', type, err);
        }
        eventBus.emitSessionEvent(type, this.projectId, enrichedPayload);
    }
    async onAssistantMessage(event) {
        const content = pickString(event, 'content', 'text', 'message') ?? '';
        const messageId = pickString(event, 'messageId', 'id');
        await this.publish('session.message', {
            role: 'assistant',
            messageId,
            content,
        });
        await this.bumpTurnCount();
    }
    async onDelta(event) {
        const delta = pickString(event, 'delta', 'content', 'text') ?? '';
        if (!delta)
            return;
        await this.publish('session.delta', { delta });
    }
    async onReasoning(event) {
        const delta = pickString(event, 'delta', 'content', 'text') ?? '';
        if (!delta)
            return;
        await this.publish('session.delta', { delta, kind: 'reasoning' });
    }
    async onUsage(event) {
        const inputTokens = pickNumber(event, 'inputTokens', 'input_tokens', 'promptTokens', 'prompt_tokens') ?? 0;
        const outputTokens = pickNumber(event, 'outputTokens', 'output_tokens', 'completionTokens', 'completion_tokens') ?? 0;
        const model = pickString(event, 'model') ?? this.model ?? null;
        const turnCost = estimateCost(model, inputTokens, outputTokens);
        await this.publish('session.usage', {
            inputTokens,
            outputTokens,
            model,
            cost: turnCost,
        });
        try {
            const db = getDb();
            await db
                .update(liveSessions)
                .set({
                inputTokens: drizzleSql `${liveSessions.inputTokens} + ${inputTokens}`,
                outputTokens: drizzleSql `${liveSessions.outputTokens} + ${outputTokens}`,
                costUsd: drizzleSql `${liveSessions.costUsd} + ${turnCost.toFixed(6)}`,
                updatedAt: new Date(),
            })
                .where(eq(liveSessions.id, this.id));
        }
        catch (err) {
            console.warn('[squad-stream] failed to update usage rollup', err);
        }
    }
    async onError(event) {
        const message = pickString(event, 'message', 'error') ?? 'Unknown SDK error';
        await this.publish('session.error', { message });
        try {
            const db = getDb();
            await db
                .update(liveSessions)
                .set({ status: 'failed', errorMessage: message, updatedAt: new Date() })
                .where(eq(liveSessions.id, this.id));
        }
        catch {
            // best effort
        }
    }
    async bumpTurnCount() {
        try {
            const db = getDb();
            await db
                .update(liveSessions)
                .set({
                turnCount: drizzleSql `${liveSessions.turnCount} + 1`,
                updatedAt: new Date(),
            })
                .where(eq(liveSessions.id, this.id));
        }
        catch {
            // non-fatal
        }
    }
    async sendPrompt(prompt) {
        if (this.isClosed)
            throw new Error('Session is closed');
        const db = getDb();
        await db
            .update(liveSessions)
            .set({ status: 'active', updatedAt: new Date() })
            .where(eq(liveSessions.id, this.id));
        await this.publish('session.message', { role: 'user', content: prompt });
        await this.session.sendMessage({ prompt });
    }
    /**
     * Cancel the in-flight turn (if any). Best-effort: returns true when the
     * SDK exposes abort and we actually called it; false when not. Either way
     * the session stays alive for subsequent sendPrompt calls.
     */
    async interrupt() {
        if (this.isClosed)
            throw new Error('Session is closed');
        if (typeof this.session.abort === 'function') {
            try {
                await this.session.abort();
                await this.publish('session.steered', {
                    action: 'interrupt',
                    honoured: true,
                });
                return true;
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : 'abort failed';
                await this.publish('session.error', { message: `interrupt failed: ${msg}` });
                return false;
            }
        }
        await this.publish('session.steered', {
            action: 'interrupt',
            honoured: false,
            reason: 'SDK session does not expose abort()',
        });
        return false;
    }
    /** Public wrapper around the private publisher for use by the start helper. */
    async publishLifecycle(type, payload) {
        await this.publish(type, payload);
    }
    async close(reason = 'completed') {
        if (this.isClosed)
            return;
        this.isClosed = true;
        try {
            await this.session.close();
        }
        catch (err) {
            console.warn('[squad-stream] session.close failed', err);
        }
        try {
            await this.client.disconnect();
        }
        catch (err) {
            console.warn('[squad-stream] client.disconnect failed', err);
        }
        try {
            const db = getDb();
            await db
                .update(liveSessions)
                .set({ status: reason, completedAt: new Date(), updatedAt: new Date() })
                .where(eq(liveSessions.id, this.id));
        }
        catch {
            // non-fatal
        }
        await this.publish('session.completed', { reason });
        runningSessions.delete(this.id);
    }
}
const runningSessions = new Map();
/**
 * Create + start a brand new live session. Persists the row, opens an SDK
 * session, sends the first prompt asynchronously, and returns the IDs.
 *
 * The first prompt is dispatched via `sendMessage` (not awaited beyond the
 * SDK's own ack), so this returns quickly — clients should subscribe to WS
 * events to follow progress.
 */
export async function startLiveSession(input) {
    const db = getDb();
    let agentName = input.agentName ?? null;
    let charterPath = input.charterPath ?? null;
    let agentModel = null;
    if (input.agentId && (!agentName || !charterPath)) {
        const [row] = await db
            .select({ name: agentsTable.name, charterPath: agentsTable.charterPath, model: agentsTable.model })
            .from(agentsTable)
            .where(eq(agentsTable.id, input.agentId));
        if (row) {
            agentName = agentName ?? row.name;
            charterPath = charterPath ?? row.charterPath;
            agentModel = row.model ?? null;
        }
    }
    else if (input.agentId) {
        const [row] = await db
            .select({ model: agentsTable.model })
            .from(agentsTable)
            .where(eq(agentsTable.id, input.agentId));
        agentModel = row?.model ?? null;
    }
    const [projectRow] = await db
        .select({ defaultModel: projectsTable.defaultModel })
        .from(projectsTable)
        .where(eq(projectsTable.id, input.projectId));
    const resolved = resolveModel({
        sessionModel: input.model,
        agentModel,
        projectDefaultModel: projectRow?.defaultModel ?? null,
    });
    const charter = charterPath
        ? await readFile(charterPath, 'utf8').catch(() => `(charter not found at: ${charterPath})`)
        : 'You are a Squad agent helping the user inside Squadboard. Be concise and helpful.';
    const [created] = await db
        .insert(liveSessions)
        .values({
        projectId: input.projectId,
        agentId: input.agentId ?? null,
        agentName,
        title: input.title ?? summariseTitle(input.prompt),
        status: 'active',
        model: resolved.model,
    })
        .returning();
    if (!created)
        throw new Error('Failed to create live session row');
    const token = process.env.GITHUB_TOKEN ?? process.env.SQUADBOARD_GITHUB_TOKEN;
    const { SquadClient } = await import('@bradygaster/squad-sdk/client');
    const client = new SquadClient({
        ...(token ? { githubToken: token } : { useLoggedInUser: true }),
        cwd: input.workspacePath,
    });
    await client.connect();
    let session;
    try {
        session = await client.createSession({
            model: resolved.model,
            streaming: true,
            systemMessage: { mode: 'replace', content: charter },
            workingDirectory: input.workspacePath,
            onPermissionRequest: () => ({ kind: 'approved' }),
        });
    }
    catch (err) {
        await client.disconnect().catch(() => { });
        await db
            .update(liveSessions)
            .set({
            status: 'failed',
            errorMessage: err instanceof Error ? err.message : String(err),
            completedAt: new Date(),
        })
            .where(eq(liveSessions.id, created.id));
        throw err;
    }
    await db
        .update(liveSessions)
        .set({ sdkSessionId: session.sessionId, updatedAt: new Date() })
        .where(eq(liveSessions.id, created.id));
    const running = new RunningLiveSession({
        id: created.id,
        projectId: input.projectId,
        client,
        session,
        model: resolved.model,
    });
    runningSessions.set(created.id, running);
    await running.publishLifecycle('session.started', {
        title: created.title,
        agentName,
        model: resolved.model,
        modelResolvedVia: resolved.via,
        sdkSessionId: session.sessionId,
    });
    // Fire-and-forget: surface failures via session.error event.
    void running.sendPrompt(input.prompt).catch(async (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        await running.publishLifecycle('session.error', { message: msg });
        await running.close('failed');
    });
    return { sessionId: created.id, sdkSessionId: session.sessionId };
}
export async function sendPromptToSession(sessionId, prompt) {
    const running = runningSessions.get(sessionId);
    if (!running) {
        throw new Error('Session not running (it may have completed or the server restarted)');
    }
    // Sequence inside the SDK; if a prior turn is still in flight the SDK
    // queues internally. Errors propagate to the caller.
    await running.sendPrompt(prompt);
}
/**
 * Best-effort interrupt of the current SDK turn.
 *
 * The SDK exposes an optional `abort()` on the underlying session. If the
 * connector supports it (model providers vary), the in-flight turn is
 * cancelled but the session stays alive for follow-up `sendPrompt`. If
 * abort isn't available we publish a synthetic `session.error` so the
 * client can render an "interrupt requested but not honoured" notice.
 *
 * Returns true when abort was actually invoked, false when the SDK
 * surface didn't expose it.
 */
export async function interruptLiveSession(sessionId) {
    const running = runningSessions.get(sessionId);
    if (!running) {
        throw new Error('Session not running (it may have completed or the server restarted)');
    }
    return running.interrupt();
}
export function getRunningLiveSession(sessionId) {
    const running = runningSessions.get(sessionId);
    if (!running)
        return null;
    return { id: running.id, projectId: running.projectId };
}
export async function endLiveSession(sessionId, reason = 'cancelled') {
    const running = runningSessions.get(sessionId);
    if (!running) {
        // Already gone — mark cancelled in DB if still active.
        const db = getDb();
        await db
            .update(liveSessions)
            .set({ status: reason, completedAt: new Date(), updatedAt: new Date() })
            .where(eq(liveSessions.id, sessionId));
        return;
    }
    await running.close(reason);
}
export function isSessionRunning(sessionId) {
    return runningSessions.has(sessionId);
}
/** Best-effort shutdown — call on server stop to avoid leaking SDK clients. */
export async function shutdownAllLiveSessions() {
    const all = [...runningSessions.values()];
    await Promise.allSettled(all.map((s) => s.close('cancelled')));
}
//# sourceMappingURL=squad-stream.js.map
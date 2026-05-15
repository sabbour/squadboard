/**
 * fan-out-adapter.ts — Phase 15: parallel SDK fan-out session spawning.
 *
 * Bridges Squadboard's engine to the SDK's `spawnParallel()` so that when a
 * fan_out step is configured with `mode: parallel`, all child workflow_runs
 * have their first LLM session spawned concurrently with `Promise.allSettled`
 * (error-isolated) instead of being claimed one-tick-per-child by the
 * dispatcher (~5 s minimum gap between children).
 *
 * Invariant 1 (bridge bypasses SquadCoordinator) is preserved: we only
 * borrow `spawnParallel` — the coordinator object is never instantiated.
 *
 * Invariant 4 (children flow through the normal step lifecycle) is also
 * preserved: this adapter just kicks off the LLM session and stamps
 * (status='running', lease_expires_at, heartbeat_at, started_at, session_id)
 * onto each child's first step_run. The dispatcher's normal sweepers,
 * heartbeat, retry policy, and merge gate continue to own everything else.
 *
 * Failure isolation: one child's spawn failure marks ONLY that child's
 * step_run as failed — other children proceed. If the entire helper crashes
 * before persisting, the dispatcher will pick up the still-pending children
 * on its next tick (Phase 15 architectural decision #4: idempotent).
 */

import { readFile } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import { spawnParallel } from '@bradygaster/squad-sdk/coordinator';
import type {
  AgentSpawnConfig,
  FanOutDependencies,
  SpawnResult,
} from '@bradygaster/squad-sdk/coordinator';
import type { AgentCharter } from '@bradygaster/squad-sdk/agents';
import { getDb, getPool } from '../db/index.js';
import { resolveModel, BUILTIN_FALLBACK } from './model-defaults.js';
import { eventBus } from '../realtime/event-bus.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FanOutChild {
  workflowRunId: string;
  /** First step_run in the child's workflow (typically agent_run). */
  stepRunId: string;
  agentName: string;
  /** Resolved agent UUID — required for charter/model lookup. */
  agentId: string;
  /** Path to the agent's charter.md on disk (already resolved). */
  charterPath: string;
  /** Agent's configured model, or null for project/fallback resolution. */
  agentModel?: string | null;
  /** Project's default model, or null for fallback. */
  projectDefaultModel?: string | null;
  /** Workspace path for the SDK session. */
  workspacePath: string;
  /** .squad/ directory for the project. */
  squadPath: string;
  /** Prompt assembled from the child's first step (title + body, etc.). */
  task: string;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  context?: string;
  modelOverride?: string;
}

export interface FanOutSpawnOptions {
  parentStepRunId: string;
  parentWorkflowRunId: string;
  projectId: string;
  children: FanOutChild[];
  /** Concurrency cap to avoid blasting the LLM provider. Default: 8. */
  maxConcurrent?: number;
}

export interface FanOutSpawnResult {
  sessionId?: string;
  status: 'success' | 'failed';
  childWorkflowRunId: string;
  childStepRunId: string;
  agentName: string;
  error?: string;
  startedAt: Date;
  endedAt: Date;
}

/**
 * Telemetry payload shape for the `fan_out.parallel_spawn` event bus event.
 * Phase 12 flow viz can subscribe to this and render parallel-spawn fan-outs
 * distinctly from serial fan-outs.
 */
export interface FanOutSpawnTelemetry {
  parentStepRunId: string;
  parentWorkflowRunId: string;
  projectId: string;
  childCount: number;
  successCount: number;
  failureCount: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

const DEFAULT_MAX_CONCURRENT = 8;

/**
 * Spawn the first LLM session for each child of a fan_out step concurrently.
 * Persists session_id + lease + heartbeat onto each child's first step_run.
 *
 * Returns one FanOutSpawnResult per child (success or failed). Always
 * resolves — never throws — so the caller can preserve the engine's
 * fail-closed contract (on helper-level error, log + let the dispatcher
 * pick up unstarted children on the next tick).
 */
export async function spawnFanOutChildren(
  opts: FanOutSpawnOptions,
): Promise<FanOutSpawnResult[]> {
  const startedAt = Date.now();
  const maxConcurrent = opts.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  const results: FanOutSpawnResult[] = [];

  // Chunked concurrency cap — implemented inline to avoid a new dep.
  // Each chunk is one call to spawnParallel(); within a chunk, the SDK uses
  // Promise.allSettled. Across chunks, we serialise to honour maxConcurrent.
  for (let i = 0; i < opts.children.length; i += maxConcurrent) {
    const chunk = opts.children.slice(i, i + maxConcurrent);
    const chunkResults = await spawnChunk(chunk);
    results.push(...chunkResults);
  }

  const durationMs = Date.now() - startedAt;
  const successCount = results.filter((r) => r.status === 'success').length;
  const failureCount = results.filter((r) => r.status === 'failed').length;

  // Phase 15 telemetry — always emit, even if all spawns failed (so ops
  // dashboards can spot a totally-broken parallel-spawn deploy).
  const telemetry: FanOutSpawnTelemetry = {
    parentStepRunId: opts.parentStepRunId,
    parentWorkflowRunId: opts.parentWorkflowRunId,
    projectId: opts.projectId,
    childCount: opts.children.length,
    successCount,
    failureCount,
    durationMs,
  };
  try {
    eventBus.emitFanOutEvent('fan_out.parallel_spawn', opts.projectId, telemetry);
  } catch (err: unknown) {
    console.error('[fan-out-adapter] failed to emit telemetry event:', err);
  }

  console.log(
    `[fan-out-adapter] parallel spawn complete: ${successCount}/${opts.children.length} ` +
      `succeeded (${failureCount} failed) in ${durationMs} ms ` +
      `(parent=${opts.parentStepRunId}, maxConcurrent=${maxConcurrent})`,
  );

  return results;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function spawnChunk(children: FanOutChild[]): Promise<FanOutSpawnResult[]> {
  // Index children by agentName so we can map SDK SpawnResult back to the
  // originating child — the SDK keys results by agentName only. To stay
  // robust against duplicate agentNames in one fan_out (split_by=count with
  // round-robin), we tag each config with a per-call unique agentName and
  // unwrap it on the way back.
  const tagged = children.map((c, idx) => ({
    child: c,
    taggedName: `${c.agentName}#${idx}`,
  }));

  const childByTag = new Map(tagged.map((t) => [t.taggedName, t.child]));

  const configs: AgentSpawnConfig[] = tagged.map(({ child, taggedName }) => {
    const config: AgentSpawnConfig = {
      agentName: taggedName,
      task: child.task,
      priority: child.priority ?? 'normal',
    };
    if (child.context) config.context = child.context;
    if (child.modelOverride) config.modelOverride = child.modelOverride;
    return config;
  });

  const deps = buildDependencies(childByTag);

  let sdkResults: SpawnResult[];
  try {
    sdkResults = await spawnParallel(configs, deps);
  } catch (err: unknown) {
    // The SDK's spawnParallel uses Promise.allSettled internally so it
    // shouldn't reject — but defend against future changes.
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[fan-out-adapter] spawnParallel itself rejected:', msg);
    return tagged.map(({ child, taggedName }) => ({
      sessionId: undefined,
      status: 'failed',
      childWorkflowRunId: child.workflowRunId,
      childStepRunId: child.stepRunId,
      agentName: child.agentName,
      error: `spawnParallel rejected: ${msg}`,
      startedAt: new Date(),
      endedAt: new Date(),
      // Suppress the unused taggedName lint
      ...(taggedName ? {} : {}),
    }));
  }

  // Persist session_id + lifecycle stamp + telemetry per child.
  const out: FanOutSpawnResult[] = [];
  for (const sdkResult of sdkResults) {
    const child = childByTag.get(sdkResult.agentName);
    if (!child) {
      console.warn(
        `[fan-out-adapter] unknown taggedName from SDK: ${sdkResult.agentName} — skipping persist`,
      );
      continue;
    }

    const startedAtDate = sdkResult.startTime ?? new Date();
    const endedAtDate = sdkResult.endTime ?? new Date();

    if (sdkResult.status === 'success' && sdkResult.sessionId) {
      try {
        await markStepRunRunning(child.stepRunId, sdkResult.sessionId);
      } catch (err: unknown) {
        // If the persist fails (e.g. row was already advanced by another
        // worker), drop to failed and let the dispatcher reconcile.
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[fan-out-adapter] failed to persist session_id for step_run ${child.stepRunId}:`,
          msg,
        );
        out.push({
          sessionId: sdkResult.sessionId,
          status: 'failed',
          childWorkflowRunId: child.workflowRunId,
          childStepRunId: child.stepRunId,
          agentName: child.agentName,
          error: `persist failed: ${msg}`,
          startedAt: startedAtDate,
          endedAt: endedAtDate,
        });
        continue;
      }

      out.push({
        sessionId: sdkResult.sessionId,
        status: 'success',
        childWorkflowRunId: child.workflowRunId,
        childStepRunId: child.stepRunId,
        agentName: child.agentName,
        startedAt: startedAtDate,
        endedAt: endedAtDate,
      });
    } else {
      // Spawn-time failure: mark the step_run failed with the SDK's error.
      // The dispatcher's sweeper does NOT retry this (it never reached
      // 'running' via the normal claim path) — Phase 15 architectural
      // decision #3: spawn-level failures are fatal at the spawn level.
      const errorMsg = sdkResult.error ?? 'spawn failed (no error message)';
      try {
        await markStepRunFailed(child.stepRunId, errorMsg);
      } catch (err: unknown) {
        console.error(
          `[fan-out-adapter] failed to mark step_run ${child.stepRunId} failed:`,
          err,
        );
      }

      out.push({
        sessionId: sdkResult.sessionId,
        status: 'failed',
        childWorkflowRunId: child.workflowRunId,
        childStepRunId: child.stepRunId,
        agentName: child.agentName,
        error: errorMsg,
        startedAt: startedAtDate,
        endedAt: endedAtDate,
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// SDK dependency adapters
// ---------------------------------------------------------------------------

function buildDependencies(
  childByTag: Map<string, FanOutChild>,
): FanOutDependencies {
  return {
    compileCharter: async (taggedName: string): Promise<AgentCharter> => {
      const child = childByTag.get(taggedName);
      if (!child) {
        throw new Error(`compileCharter: unknown taggedName ${taggedName}`);
      }
      const content = await readFile(child.charterPath, 'utf8').catch(
        () => `(charter not found at: ${child.charterPath})`,
      );
      return {
        name: child.agentName,
        displayName: child.agentName,
        role: 'agent',
        expertise: [],
        style: '',
        prompt: content,
        modelPreference: child.agentModel ?? undefined,
      } as AgentCharter;
    },

    resolveModel: async (
      charter: AgentCharter,
      override?: string,
    ): Promise<string> => {
      // SDK passes (charter, override). Our resolver chain wins:
      //   override (sessionModel) > charter.modelPreference (agentModel) >
      //   project.defaultModel > BUILTIN_FALLBACK
      const resolved = resolveModel({
        sessionModel: override ?? null,
        agentModel: charter.modelPreference ?? null,
        // projectDefaultModel is per-child; pulled from the FanOutChild via
        // the tagged-name registry inside compileCharter call site. The
        // SDK's signature is (charter, override) only, so we re-resolve
        // here using the agent-level + fallback layers. The project default
        // is applied during preflight (see prepareFanOutChildren) so this
        // path stays correct even without per-call project context.
        projectDefaultModel: null,
      });
      return resolved.model;
    },

    createSession: async (
      config: { model: string; clientName?: string; agentName?: string },
    ): Promise<{ sessionId: string; sendMessage: (opts: unknown) => Promise<void> }> => {
      // Resolve the originating child from the SDK-supplied clientName
      // (`squad-agent-${taggedName}`) so we know which workspace to spawn in.
      const taggedName = (config.clientName ?? '').replace(/^squad-agent-/, '');
      const child = childByTag.get(taggedName);
      if (!child) {
        throw new Error(
          `createSession: cannot resolve child from clientName=${config.clientName}`,
        );
      }

      const token =
        process.env['GITHUB_TOKEN'] ?? process.env['SQUADBOARD_GITHUB_TOKEN'];

      // Late-import the SDK client so this module stays cheap to load
      // when no parallel fan_out is in play.
      const { SquadClient } = await import('@bradygaster/squad-sdk/client');
      const client = new SquadClient({
        ...(token ? { githubToken: token } : { useLoggedInUser: true }),
        cwd: child.workspacePath,
      });

      await client.connect();

      const charter = await readFile(child.charterPath, 'utf8').catch(() => '');

      const session = await client.createSession({
        model: config.model || BUILTIN_FALLBACK,
        systemMessage: { mode: 'replace', content: charter },
        workingDirectory: child.workspacePath,
      });

      // SDK contract for spawnParallel.createSession:
      //   - return { sessionId, sendMessage(opts) }
      //   - sendMessage receives { prompt, mode: 'immediate' } from the SDK
      //   - we do sendAndWait inside sendMessage so the LLM work actually
      //     runs (and its output stays available to the engine's normal
      //     advancement gate).
      // We disconnect inside sendMessage's finally so the client lifetime
      // matches the spawn op exactly.
      const sessionId = String(
        (session as { id?: string; sessionId?: string }).id ??
          (session as { sessionId?: string }).sessionId ??
          `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );

      return {
        sessionId,
        sendMessage: async (opts: unknown): Promise<void> => {
          const o = (opts as { prompt?: string }) ?? {};
          const prompt = o.prompt ?? child.task;
          try {
            await client.sendAndWait(session, { prompt });
          } finally {
            await client.disconnect().catch(() => {});
          }
        },
      };
    },

    // Minimal SessionPool adapter — the SDK only calls .add() during spawn.
    // We keep an in-process Map so .add() is a no-op-with-side-effect that
    // matches the type signature without pulling in SDK lifecycle plumbing.
    sessionPool: makeMinimalSessionPool(),

    // Minimal EventBus adapter — the SDK calls .emit() with session.created
    // and session.error events. We forward them onto our realtime event bus
    // tagged with the originating child so the WS layer can stream live.
    eventBus: makeMinimalEventBus(childByTag),
  } as unknown as FanOutDependencies;
}

function makeMinimalSessionPool(): unknown {
  const sessions = new Map<string, unknown>();
  return {
    add: (s: { id: string }) => {
      sessions.set(s.id, s);
    },
    remove: (id: string) => sessions.delete(id),
    get: (id: string) => sessions.get(id),
    findByAgent: () => undefined,
    active: () => Array.from(sessions.values()),
    updateStatus: () => undefined,
    get size() {
      return sessions.size;
    },
    get atCapacity() {
      return false;
    },
    shutdown: async () => {
      sessions.clear();
    },
    on: () => () => undefined,
  };
}

function makeMinimalEventBus(
  childByTag: Map<string, FanOutChild>,
): unknown {
  return {
    emit: async (event: {
      type?: string;
      sessionId?: string;
      payload?: { agentName?: string; error?: string; priority?: string };
    }): Promise<void> => {
      // Tag the SDK event with the originating childStepRunId/workflowRunId
      // so subscribers can correlate without a separate join.
      const taggedName = event.payload?.agentName;
      const child = taggedName ? childByTag.get(taggedName) : undefined;
      const enriched = {
        type: event.type,
        sessionId: event.sessionId,
        payload: {
          ...event.payload,
          agentName: child?.agentName ?? event.payload?.agentName,
          childStepRunId: child?.stepRunId,
          childWorkflowRunId: child?.workflowRunId,
        },
        timestamp: new Date(),
      };
      // Forward as a session.error / session.started bus event when known.
      try {
        if (event.type === 'session.created') {
          eventBus.emitSessionEvent(
            'session.started',
            child?.workflowRunId ?? 'global',
            enriched,
          );
        } else if (event.type === 'session.error') {
          eventBus.emitSessionEvent(
            'session.error',
            child?.workflowRunId ?? 'global',
            enriched,
          );
        }
      } catch (err: unknown) {
        console.error('[fan-out-adapter] eventBus forward failed:', err);
      }
    },
    on: () => () => undefined,
    onAny: () => () => undefined,
    clear: () => undefined,
  };
}

// ---------------------------------------------------------------------------
// Persistence helpers (raw SQL — schema.ts updates lag behind on hacking phase)
// ---------------------------------------------------------------------------

async function markStepRunRunning(stepRunId: string, sessionId: string): Promise<void> {
  const db = getDb();
  // Lease TTL is 90 s — matches issue_runs.LEASE_TTL_SECONDS so the
  // dispatcher's sweepExpiredStepLeases() applies the same recovery rules.
  await db.execute(sql`
    UPDATE step_runs
       SET status           = 'running',
           session_id       = ${sessionId},
           lease_expires_at = NOW() + INTERVAL '90 seconds',
           heartbeat_at     = NOW(),
           started_at       = NOW(),
           updated_at       = NOW()
     WHERE id = ${stepRunId}
  `);
}

async function markStepRunFailed(stepRunId: string, errorMessage: string): Promise<void> {
  // Persist via raw pool because step_runs has no error_message column —
  // we stuff the message into the output field with a [SPAWN_FAILED] prefix
  // so the dispatcher / merge gate recognises it.
  const pool = getPool();
  const tagged = `[SPAWN_FAILED] ${errorMessage}`;
  await pool.query(
    `UPDATE step_runs
        SET status      = 'failed',
            output      = $1,
            updated_at  = NOW()
      WHERE id = $2`,
    [tagged, stepRunId],
  );
}

// Agent session runner — SquadClient (ACP) only, no fallbacks.

import { readFile } from 'node:fs/promises';
import { resolveModel } from './model-defaults.js';
import { estimateCost } from './pricing.js';

export interface SessionOptions {
  agentName: string;
  charterPath: string;
  workspacePath: string;
  squadPath: string;
  task: string; // issue title + body
  systemPrompt?: string; // optional prebuilt spawn/system prompt
  model?: string; // optional — passed through from session/run
  agentModel?: string | null; // optional — agent's configured model
  projectDefaultModel?: string | null; // optional — project-level default
  onEvent?: AgentSessionEventHandler;
}

export interface SessionResult {
  output: string;
  tokensUsed: number;
  costUsd: string;
  inputTokens?: number;
  outputTokens?: number;
  resolvedModel: string;
  modelResolvedVia: 'session' | 'agent' | 'project' | 'fallback';
}

export type AgentSessionEventType =
  | 'session.created'
  | 'message_delta'
  | 'reasoning_delta'
  | 'usage'
  | 'turn_start'
  | 'turn_end'
  | 'idle'
  | 'error'
  | 'tool.call'
  | 'tool.result';

export interface AgentSessionEvent {
  type: AgentSessionEventType;
  payload: Record<string, unknown>;
}

export type AgentSessionEventHandler = (event: AgentSessionEvent) => void | Promise<void>;

/**
 * Extract text from SquadClient.sendAndWait() return value.
 * @github/copilot-sdk returns AssistantMessageEvent:
 *   { type: "assistant.message", data: { messageId: string, content: string } }
 * The Squad adapter passes it through raw from session.sendAndWait().
 */
function extractOutput(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    // Primary path: AssistantMessageEvent shape from @github/copilot-sdk
    if (r['data'] && typeof r['data'] === 'object') {
      const data = r['data'] as Record<string, unknown>;
      if (typeof data['content'] === 'string') return data['content'];
    }
    if (typeof r['content'] === 'string') return r['content'];
    if (typeof r['text'] === 'string') return r['text'];
    if (typeof r['message'] === 'string') return r['message'];
    if (r['message'] && typeof (r['message'] as Record<string, unknown>)['content'] === 'string') {
      return (r['message'] as Record<string, unknown>)['content'] as string;
    }
  }
  return JSON.stringify(result ?? '');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function pickNumber(obj: unknown, ...keys: string[]): number | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const o = obj as Record<string, unknown>;
  for (const key of keys) {
    const value = o[key];
    if (typeof value === 'number') return value;
    if (value && typeof value === 'object') {
      const nested = pickNumber(value, ...keys);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function pickString(obj: unknown, ...keys: string[]): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const o = obj as Record<string, unknown>;
  for (const key of keys) {
    const value = o[key];
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
      const nested = pickString(value, ...keys);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

async function emitAgentSessionEvent(
  handler: AgentSessionEventHandler | undefined,
  type: AgentSessionEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!handler) return;
  try {
    await handler({ type, payload });
  } catch (err) {
    console.warn('[squad-client] live event handler failed:', err instanceof Error ? err.message : String(err));
  }
}

export async function createAgentSession(options: SessionOptions): Promise<SessionResult> {
  const systemPrompt = options.systemPrompt
    ?? (await readFile(options.charterPath, 'utf8')
      .catch(() => `(charter not found at: ${options.charterPath})`));

  const resolved = resolveModel({
    sessionModel: options.model,
    agentModel: options.agentModel ?? null,
    projectDefaultModel: options.projectDefaultModel ?? null,
  });

  const token = process.env.GITHUB_TOKEN ?? process.env.SQUADBOARD_GITHUB_TOKEN;

  const { SquadClient } = await import('@bradygaster/squad-sdk/client');
  const client = new SquadClient({
    ...(token ? { githubToken: token } : { useLoggedInUser: true }),
    cwd: options.workspacePath,
  });

  await client.connect();
  let observedInputTokens: number | undefined;
  let observedOutputTokens: number | undefined;
  let observedModel: string | undefined;
  let session: Awaited<ReturnType<typeof client.createSession>> | null = null;
  const listeners: Array<{ type: string; handler: (event: unknown) => void }> = [];

  const attach = (eventType: AgentSessionEventType, handler: (event: unknown) => void) => {
    if (!session) return;
    session.on(eventType, handler);
    listeners.push({ type: eventType, handler });
  };

  try {
    session = await client.createSession({
      model: resolved.model,
      streaming: true,
      systemMessage: { mode: 'replace', content: systemPrompt },
      workingDirectory: options.workspacePath,
      onPermissionRequest: () => ({ kind: 'approved' }),
      hooks: {
        onPreToolUse: async (input: unknown, invocation: { sessionId?: string } = {}) => {
          const payload = asRecord(input);
          await emitAgentSessionEvent(options.onEvent, 'tool.call', {
            sessionId: invocation.sessionId,
            toolName: pickString(payload, 'toolName') ?? 'unknown',
            args: payload.toolArgs,
            cwd: payload.cwd,
            timestamp: payload.timestamp,
          });
        },
        onPostToolUse: async (input: unknown, invocation: { sessionId?: string } = {}) => {
          const payload = asRecord(input);
          await emitAgentSessionEvent(options.onEvent, 'tool.result', {
            sessionId: invocation.sessionId,
            toolName: pickString(payload, 'toolName') ?? 'unknown',
            args: payload.toolArgs,
            result: payload.toolResult,
            cwd: payload.cwd,
            timestamp: payload.timestamp,
          });
        },
        onErrorOccurred: async (input: unknown, invocation: { sessionId?: string } = {}) => {
          await emitAgentSessionEvent(options.onEvent, 'error', {
            sessionId: invocation.sessionId,
            ...asRecord(input),
          });
        },
      },
    });

    await emitAgentSessionEvent(options.onEvent, 'session.created', {
      sdkSessionId: session.sessionId,
      model: resolved.model,
      modelResolvedVia: resolved.via,
      workingDirectory: options.workspacePath,
    });

    attach('message_delta', (event) => {
      void emitAgentSessionEvent(options.onEvent, 'message_delta', asRecord(event));
    });
    attach('reasoning_delta', (event) => {
      void emitAgentSessionEvent(options.onEvent, 'reasoning_delta', asRecord(event));
    });
    attach('usage', (event) => {
      const payload = asRecord(event);
      const inputTokens = pickNumber(payload, 'inputTokens', 'input_tokens', 'promptTokens', 'prompt_tokens') ?? 0;
      const outputTokens = pickNumber(payload, 'outputTokens', 'output_tokens', 'completionTokens', 'completion_tokens') ?? 0;
      const model = pickString(payload, 'model') ?? resolved.model;
      observedInputTokens = inputTokens;
      observedOutputTokens = outputTokens;
      observedModel = model;
      void emitAgentSessionEvent(options.onEvent, 'usage', {
        ...payload,
        inputTokens,
        outputTokens,
        model,
        cost: estimateCost(model, inputTokens, outputTokens),
      });
    });
    attach('turn_start', (event) => {
      void emitAgentSessionEvent(options.onEvent, 'turn_start', asRecord(event));
    });
    attach('turn_end', (event) => {
      void emitAgentSessionEvent(options.onEvent, 'turn_end', asRecord(event));
    });
    attach('idle', (event) => {
      void emitAgentSessionEvent(options.onEvent, 'idle', asRecord(event));
    });
    attach('error', (event) => {
      void emitAgentSessionEvent(options.onEvent, 'error', asRecord(event));
    });

    const result = await client.sendAndWait(session, { prompt: options.task });

    const output = extractOutput(result);
    const inputTokens = observedInputTokens ?? Math.ceil((systemPrompt.length + options.task.length) / 4);
    const outputTokens = observedOutputTokens ?? Math.ceil(output.length / 4);
    const resolvedCostModel = observedModel ?? resolved.model;

    return {
      output,
      tokensUsed: inputTokens + outputTokens,
      costUsd: estimateCost(resolvedCostModel, inputTokens, outputTokens).toFixed(6),
      inputTokens,
      outputTokens,
      resolvedModel: resolvedCostModel,
      modelResolvedVia: resolved.via,
    };
  } finally {
    if (session) {
      for (const listener of listeners) {
        try {
          session.off(listener.type, listener.handler);
        } catch {
          // SDK session may already be closing; disconnect below is authoritative.
        }
      }
    }
    await client.disconnect().catch(() => {});
  }
}

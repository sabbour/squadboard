/**
 * coordinator/llm-client.ts — Thin LLM wrapper for the mini-coordinator (W29 MC-3).
 *
 * Composes [system: preamble, user: stringified input], calls the SDK
 * SquadClient, strips code fences, and validates the response against
 * coordinatorDecisionSchema.
 *
 * The `LlmCaller` abstraction keeps the real SDK out of unit tests — pass a
 * fake via `callCoordinatorLlm({ ..., llmCaller: fakeCaller })`.
 */

import type { CoordinatorDecision, CoordinatorCallMeta } from "./types.js";
import { coordinatorDecisionSchema } from "./schemas.js";

// ---------------------------------------------------------------------------
// Injectable LlmCaller abstraction
// ---------------------------------------------------------------------------

export interface LlmCallerOpts {
  messages: Array<{ role: "system" | "user"; content: string }>;
  model: string;
  temperature: number;
  abortSignal?: AbortSignal;
}

export interface LlmCallerResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
}

export interface LlmCaller {
  call(opts: LlmCallerOpts): Promise<LlmCallerResult>;
}

// ---------------------------------------------------------------------------
// Real SDK adapter (default)
// ---------------------------------------------------------------------------

class SquadClientLlmCaller implements LlmCaller {
  async call(opts: LlmCallerOpts): Promise<LlmCallerResult> {
    const token = process.env.GITHUB_TOKEN ?? process.env.SQUADBOARD_GITHUB_TOKEN;
    const { SquadClient } = await import("@bradygaster/squad-sdk/client");
    const client = new SquadClient({
      ...(token ? { githubToken: token } : { useLoggedInUser: true }),
      cwd: process.cwd(),
    });

    await client.connect();
    try {
      const systemMsg = opts.messages.find((m) => m.role === "system");
      const userMsg = opts.messages.find((m) => m.role === "user");

      const session = await client.createSession({
        model: opts.model,
        systemMessage: {
          mode: "replace",
          content: systemMsg?.content ?? "",
        },
        workingDirectory: process.cwd(),
        onPermissionRequest: () => ({ kind: "approved" }),
        ...(opts.abortSignal ? { signal: opts.abortSignal } : {}),
      });

      const result = await client.sendAndWait(session, {
        prompt: userMsg?.content ?? "",
      });

      const text = extractText(result);
      // Estimate tokens from character counts (4 chars ≈ 1 token)
      const promptTokens = Math.ceil(
        ((systemMsg?.content.length ?? 0) + (userMsg?.content.length ?? 0)) / 4,
      );
      const completionTokens = Math.ceil(text.length / 4);

      return { text, promptTokens, completionTokens, model: opts.model };
    } finally {
      await client.disconnect().catch(() => {});
    }
  }
}

function extractText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (r["data"] && typeof r["data"] === "object") {
      const data = r["data"] as Record<string, unknown>;
      if (typeof data["content"] === "string") return data["content"];
    }
    if (typeof r["content"] === "string") return r["content"];
    if (typeof r["text"] === "string") return r["text"];
    if (typeof r["message"] === "string") return r["message"];
    if (
      r["message"] &&
      typeof (r["message"] as Record<string, unknown>)["content"] === "string"
    ) {
      return (r["message"] as Record<string, unknown>)["content"] as string;
    }
  }
  return JSON.stringify(result ?? "");
}

/** Singleton real adapter — callers that don't inject get this. */
export const defaultLlmCaller: LlmCaller = new SquadClientLlmCaller();

// ---------------------------------------------------------------------------
// Public call params / result types
// ---------------------------------------------------------------------------

export interface CoordinatorLlmCallParams {
  preamble: string;
  userPayload: string;
  model: string;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  llmCaller?: LlmCaller;
}

export interface CoordinatorLlmResult {
  decision: CoordinatorDecision;
  meta: Omit<import("./types.js").CoordinatorCallMeta, "cacheHit" | "inputHash">;
  rawText: string;
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

export async function callCoordinatorLlm(
  params: CoordinatorLlmCallParams,
): Promise<CoordinatorLlmResult> {
  const { preamble, userPayload, model, abortSignal, timeoutMs = 30_000, llmCaller } = params;
  const caller = llmCaller ?? defaultLlmCaller;

  // Build abort signal with timeout
  let signal = abortSignal;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  if (!abortSignal) {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    signal = controller.signal;
  }

  const messages: Array<{ role: "system" | "user"; content: string }> = [
    { role: "system", content: preamble },
    { role: "user", content: userPayload },
  ];

  const startMs = Date.now();
  let callerResult: LlmCallerResult;
  try {
    callerResult = await caller.call({
      messages,
      model,
      temperature: 0,
      abortSignal: signal,
    });
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }

  const durationMs = Date.now() - startMs;
  const rawText = callerResult.text;

  // Strip code fences
  const stripped = stripCodeFences(rawText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    throw new CoordinatorLlmParseError(rawText, err);
  }

  let decision: CoordinatorDecision;
  try {
    decision = coordinatorDecisionSchema.parse(parsed);
  } catch (err) {
    throw new CoordinatorLlmParseError(rawText, err);
  }

  return {
    decision,
    meta: {
      model: callerResult.model,
      promptTokens: callerResult.promptTokens,
      completionTokens: callerResult.completionTokens,
      durationMs,
    },
    rawText,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/i);
  if (fenceMatch && fenceMatch[1]) {
    return fenceMatch[1].trim();
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class CoordinatorLlmParseError extends Error {
  constructor(
    public readonly rawText: string,
    public readonly zodError?: unknown,
  ) {
    super("Coordinator LLM returned unparseable decision");
    this.name = "CoordinatorLlmParseError";
  }
}

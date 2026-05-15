/**
 * services/formulator.ts — Shared "Formulate" primitive.
 *
 * The "Formulate" UX is universal: user pastes a brief, raw idea, the system
 * returns a clean, structured object (issue, skill, tool, …) for them to
 * review and accept. This module owns the LLM plumbing common to every
 * formulator: model resolution (via the standard chain), the SquadClient
 * session, JSON extraction, and a tiny error type.
 *
 * Domain-specific formulators (inbox, skills, tools) build their own prompt,
 * call `runFormulator(...)`, then validate/normalise the parsed JSON against
 * their own shape.
 */

import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { resolveModel, type ResolveModelResult } from '../sdk/model-defaults.js';

export interface RunFormulatorOpts {
  /** User-facing prompt (the formatter prompt, NOT a system message). */
  prompt: string;
  /** Used to resolve `project.defaultModel`. */
  projectId?: string | null;
  /** Reserved for per-agent formulators; currently unused. */
  agentModel?: string | null;
  /** Override the default "JSON-only assistant" system message. */
  systemMessage?: string;
}

export interface RunFormulatorResult {
  raw: string;
  modelUsed: ResolveModelResult;
}

const DEFAULT_SYSTEM_MESSAGE =
  'You are a precise JSON-only assistant. Return only the requested JSON object — no markdown fences, no prose.';

/**
 * Resolve the model + run the SquadClient session. Returns the raw text from
 * the LLM plus the resolved model so callers can surface it in UI.
 */
export async function runFormulator(opts: RunFormulatorOpts): Promise<RunFormulatorResult> {
  let projectDefaultModel: string | null = null;
  if (opts.projectId) {
    try {
      const db = getDb();
      const [proj] = await db
        .select({ defaultModel: schema.projects.defaultModel })
        .from(schema.projects)
        .where(eq(schema.projects.id, opts.projectId))
        .limit(1);
      projectDefaultModel = proj?.defaultModel ?? null;
    } catch {
      // Best-effort: fall through to fallback.
    }
  }

  const modelUsed = resolveModel({
    sessionModel: null,
    agentModel: opts.agentModel ?? null,
    projectDefaultModel,
  });

  const token = process.env.GITHUB_TOKEN ?? process.env.SQUADBOARD_GITHUB_TOKEN;
  const { SquadClient } = await import('@bradygaster/squad-sdk/client');
  const client = new SquadClient({
    ...(token ? { githubToken: token } : { useLoggedInUser: true }),
    cwd: process.cwd(),
  });
  await client.connect();
  try {
    const session = await client.createSession({
      model: modelUsed.model,
      systemMessage: {
        mode: 'replace',
        content: opts.systemMessage ?? DEFAULT_SYSTEM_MESSAGE,
      },
      workingDirectory: process.cwd(),
      onPermissionRequest: () => ({ kind: 'approved' }),
    });
    const result = await client.sendAndWait(session, { prompt: opts.prompt });
    return { raw: extractText(result), modelUsed };
  } finally {
    await client.disconnect().catch(() => {});
  }
}

/**
 * Extract a textual response from a SquadClient `sendAndWait` result. The SDK
 * shape varies slightly between versions, so we try the common locations
 * before falling back to `JSON.stringify`.
 */
export function extractText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
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

/**
 * Parse a JSON object out of chatty LLM output. Handles direct JSON,
 * ```json … ``` fences, and "any prose then `{…}`" patterns.
 */
export function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch && fenceMatch[1]) {
      try {
        return JSON.parse(fenceMatch[1].trim());
      } catch {
        /* fall through */
      }
    }
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first !== -1 && last > first) {
      try {
        return JSON.parse(trimmed.slice(first, last + 1));
      } catch {
        /* fall through */
      }
    }
    throw new Error(`LLM output was not valid JSON: ${trimmed.slice(0, 200)}`);
  }
}

export type { ResolveModelResult };

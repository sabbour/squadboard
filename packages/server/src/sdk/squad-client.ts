// Agent session runner.
// Backend priority: @bradygaster/squad-sdk (GITHUB_TOKEN) → llm CLI → ollama → offline briefing.

import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export interface SessionOptions {
  agentName: string;
  charterPath: string;
  workspacePath: string;
  squadPath: string;
  task: string; // issue title + body
  model?: string; // optional — passed through from agent.model
}

export interface SessionResult {
  output: string;
  tokensUsed: number;
  costUsd: string;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Extract text from the unknown return value of SquadClient.sendAndWait().
 * The underlying copilot-sdk returns AssistantMessageEvent:
 *   { type: "assistant.message", data: { content: string } }
 * The Squad adapter passes it through raw, so we check data.content first,
 * then fall back to top-level content/text fields.
 */
function extractSdkText(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  if (r['data'] && typeof r['data'] === 'object') {
    const data = r['data'] as Record<string, unknown>;
    if (typeof data['content'] === 'string' && data['content'].trim()) {
      return data['content'].trim();
    }
  }
  if (typeof r['content'] === 'string' && (r['content'] as string).trim()) {
    return (r['content'] as string).trim();
  }
  if (typeof r['text'] === 'string' && (r['text'] as string).trim()) {
    return (r['text'] as string).trim();
  }
  return null;
}

/**
 * Attempt to call the real Squad SDK (SquadClient from @bradygaster/squad-sdk).
 * Requires GITHUB_TOKEN or SQUADBOARD_GITHUB_TOKEN in the environment.
 * Returns null if no token is present or the call fails — caller falls through.
 */
async function trySquadSdk(
  charter: string,
  task: string,
  workspacePath: string,
  model?: string,
): Promise<string | null> {
  const token = process.env.GITHUB_TOKEN ?? process.env.SQUADBOARD_GITHUB_TOKEN;
  if (!token) {
    console.warn(
      '[squad-client] No GITHUB_TOKEN set — Squad SDK backend skipped. Set GITHUB_TOKEN for real LLM calls.',
    );
    return null;
  }

  let client: import('@bradygaster/squad-sdk/client').SquadClient | undefined;
  try {
    const { SquadClient } = await import('@bradygaster/squad-sdk/client');
    client = new SquadClient({ githubToken: token, cwd: workspacePath, useLoggedInUser: false });
    await client.connect();

    const session = await client.createSession({
      ...(model ? { model } : {}),
      systemMessage: { mode: 'replace' as const, content: charter },
      workingDirectory: workspacePath,
    });

    const result = await client.sendAndWait(session, { prompt: task });
    const text = extractSdkText(result);
    return text;
  } catch (err) {
    console.warn('[squad-client] Squad SDK failed:', err instanceof Error ? err.message : err);
    return null;
  } finally {
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // best-effort cleanup — do not mask the original error
      }
    }
  }
}

/**
 * Attempt to invoke a local LLM CLI with the charter as the system prompt.
 * Tries `llm` (https://llm.datasette.io) then `ollama run llama3`.
 * Returns null if neither is available or both fail.
 */
async function tryLlmBackend(charter: string, task: string): Promise<string | null> {
  // Try 'llm' CLI — supports many models via plugins, free for local backends
  try {
    const { stdout } = await execFileP('llm', ['-s', charter, task], {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (stdout.trim()) return stdout.trim();
  } catch {
    // not installed or invocation failed
  }

  // Try ollama with the default llama3 model
  try {
    const { stdout } = await execFileP(
      'ollama',
      ['run', 'llama3', `${charter}\n\n---\n\n${task}`],
      { timeout: 180_000, maxBuffer: 10 * 1024 * 1024 },
    );
    if (stdout.trim()) return stdout.trim();
  } catch {
    // not installed or invocation failed
  }

  return null;
}

/**
 * Build a structured offline briefing when no LLM backend is reachable.
 * Includes the full charter and task so the output is genuinely useful —
 * a developer can read it and understand exactly what the agent would execute.
 */
function buildOfflineBriefing(options: SessionOptions, charter: string): SessionResult {
  const output = [
    `# Agent Task Briefing — ${options.agentName}`,
    ``,
    `> **Offline run** — no LLM backend detected (\`@bradygaster/squad-sdk\`, \`llm\`, and \`ollama\` are not available on this host).`,
    `> To get a live response: set GITHUB_TOKEN for the Squad SDK backend, install the \`llm\` CLI (\`pip install llm\`) and configure a model, or run \`ollama serve\` with the \`llama3\` model pulled.`,
    ``,
    `## Workspace`,
    `\`${options.workspacePath}\``,
    ``,
    `## Agent Charter`,
    `*Source: \`${options.charterPath}\`*`,
    ``,
    charter.trim() || '_(charter not found at the path above)_',
    ``,
    `## Task`,
    options.task,
  ].join('\n');

  const inputTokens = Math.ceil((charter.length + options.task.length) / 4);
  return { output, tokensUsed: inputTokens, costUsd: '0.000', inputTokens, outputTokens: 0 };
}

export async function createAgentSession(options: SessionOptions): Promise<SessionResult> {
  const charter = await readFile(options.charterPath, 'utf8').catch(
    () => `(charter not found at: ${options.charterPath})`,
  );
  const task = options.task;

  // 1. Try @bradygaster/squad-sdk — real LLM via GitHub Copilot (primary backend)
  const sdkOutput = await trySquadSdk(charter, task, options.workspacePath, options.model);
  if (sdkOutput !== null) {
    const inputTokens = Math.ceil((charter.length + task.length) / 4);
    const outputTokens = Math.ceil(sdkOutput.length / 4);
    return {
      output: sdkOutput,
      tokensUsed: inputTokens + outputTokens,
      costUsd: '0.000',
      inputTokens,
      outputTokens,
    };
  }

  // 2. Try local LLM backends (llm CLI → ollama)
  const llmOutput = await tryLlmBackend(charter, task);
  if (llmOutput !== null) {
    const inputTokens = Math.ceil((charter.length + task.length) / 4);
    const outputTokens = Math.ceil(llmOutput.length / 4);
    return {
      output: llmOutput,
      tokensUsed: inputTokens + outputTokens,
      costUsd: '0.000',
      inputTokens,
      outputTokens,
    };
  }

  // 3. Offline briefing — always works, zero cost
  console.warn('[squad-client] No LLM backend available — returning offline briefing for %s', options.agentName);
  return buildOfflineBriefing(options, charter);
}

// Agent session runner.
// Tries real LLM backends (llm CLI, ollama) via subprocess before falling back to a
// structured offline briefing that includes the full charter + task.

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
}

export interface SessionResult {
  output: string;
  tokensUsed: number;
  costUsd: string;
  inputTokens?: number;
  outputTokens?: number;
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
    `> **Offline run** — no LLM backend detected (\`gh copilot\` extension, \`llm\`, and \`ollama\` are not available on this host).`,
    `> To get a live response: install the \`llm\` CLI (\`pip install llm\`) and configure a model, or run \`ollama serve\` with the \`llama3\` model pulled.`,
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

  const llmOutput = await tryLlmBackend(charter, options.task);
  if (llmOutput !== null) {
    const inputTokens = Math.ceil((charter.length + options.task.length) / 4);
    const outputTokens = Math.ceil(llmOutput.length / 4);
    return {
      output: llmOutput,
      tokensUsed: inputTokens + outputTokens,
      costUsd: '0.000',
      inputTokens,
      outputTokens,
    };
  }

  console.warn('[squad-client] No LLM backend available — returning offline briefing for %s', options.agentName);
  return buildOfflineBriefing(options, charter);
}

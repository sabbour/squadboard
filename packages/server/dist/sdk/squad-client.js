// Agent session runner.
// Backend priority: Copilot SDK (GITHUB_TOKEN) → llm CLI → ollama → offline briefing.
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileP = promisify(execFile);
/**
 * Attempt to call GitHub Copilot's API via @copilot-extensions/preview-sdk.
 * Requires GITHUB_TOKEN or SQUADBOARD_GITHUB_TOKEN in the environment.
 * Returns null if no token is present or the call fails.
 */
async function tryCopilotSdk(charter, task, model) {
    const token = process.env.GITHUB_TOKEN ?? process.env.SQUADBOARD_GITHUB_TOKEN;
    if (!token) {
        console.warn('[squad-client] No GITHUB_TOKEN set — Copilot SDK backend skipped. Set GITHUB_TOKEN for real LLM calls.');
        return null;
    }
    try {
        const { prompt } = await import('@copilot-extensions/preview-sdk');
        const { message } = await prompt({
            token,
            ...(model ? { model } : {}),
            messages: [
                { role: 'system', content: charter },
                { role: 'user', content: task },
            ],
        });
        const content = typeof message.content === 'string'
            ? message.content
            : JSON.stringify(message.content);
        return content.trim() || null;
    }
    catch (err) {
        console.warn('[squad-client] Copilot SDK failed:', err instanceof Error ? err.message : err);
        return null;
    }
}
/**
 * Attempt to invoke a local LLM CLI with the charter as the system prompt.
 * Tries `llm` (https://llm.datasette.io) then `ollama run llama3`.
 * Returns null if neither is available or both fail.
 */
async function tryLlmBackend(charter, task) {
    // Try 'llm' CLI — supports many models via plugins, free for local backends
    try {
        const { stdout } = await execFileP('llm', ['-s', charter, task], {
            timeout: 120_000,
            maxBuffer: 10 * 1024 * 1024,
        });
        if (stdout.trim())
            return stdout.trim();
    }
    catch {
        // not installed or invocation failed
    }
    // Try ollama with the default llama3 model
    try {
        const { stdout } = await execFileP('ollama', ['run', 'llama3', `${charter}\n\n---\n\n${task}`], { timeout: 180_000, maxBuffer: 10 * 1024 * 1024 });
        if (stdout.trim())
            return stdout.trim();
    }
    catch {
        // not installed or invocation failed
    }
    return null;
}
/**
 * Build a structured offline briefing when no LLM backend is reachable.
 * Includes the full charter and task so the output is genuinely useful —
 * a developer can read it and understand exactly what the agent would execute.
 */
function buildOfflineBriefing(options, charter) {
    const output = [
        `# Agent Task Briefing — ${options.agentName}`,
        ``,
        `> **Offline run** — no LLM backend detected (\`gh copilot\` extension, \`llm\`, and \`ollama\` are not available on this host).`,
        `> To get a live response: set GITHUB_TOKEN for the Copilot SDK backend, install the \`llm\` CLI (\`pip install llm\`) and configure a model, or run \`ollama serve\` with the \`llama3\` model pulled.`,
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
export async function createAgentSession(options) {
    const charter = await readFile(options.charterPath, 'utf8').catch(() => `(charter not found at: ${options.charterPath})`);
    const task = options.task;
    // 1. Try Copilot SDK — real LLM via GitHub Copilot API (primary backend)
    const copilotOutput = await tryCopilotSdk(charter, task, options.model);
    if (copilotOutput !== null) {
        const inputTokens = Math.ceil((charter.length + task.length) / 4);
        const outputTokens = Math.ceil(copilotOutput.length / 4);
        return {
            output: copilotOutput,
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
//# sourceMappingURL=squad-client.js.map
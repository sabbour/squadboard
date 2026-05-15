// Agent session runner — SquadClient (ACP) only, no fallbacks.
import { readFile } from 'node:fs/promises';
import { resolveModel } from './model-defaults.js';
/**
 * Extract text from SquadClient.sendAndWait() return value.
 * @github/copilot-sdk returns AssistantMessageEvent:
 *   { type: "assistant.message", data: { messageId: string, content: string } }
 * The Squad adapter passes it through raw from session.sendAndWait().
 */
function extractOutput(result) {
    if (typeof result === 'string')
        return result;
    if (result && typeof result === 'object') {
        const r = result;
        // Primary path: AssistantMessageEvent shape from @github/copilot-sdk
        if (r['data'] && typeof r['data'] === 'object') {
            const data = r['data'];
            if (typeof data['content'] === 'string')
                return data['content'];
        }
        if (typeof r['content'] === 'string')
            return r['content'];
        if (typeof r['text'] === 'string')
            return r['text'];
        if (typeof r['message'] === 'string')
            return r['message'];
        if (r['message'] && typeof r['message']['content'] === 'string') {
            return r['message']['content'];
        }
    }
    return JSON.stringify(result ?? '');
}
export async function createAgentSession(options) {
    const charter = await readFile(options.charterPath, 'utf8')
        .catch(() => `(charter not found at: ${options.charterPath})`);
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
    try {
        const session = await client.createSession({
            model: resolved.model,
            systemMessage: { mode: 'replace', content: charter },
            workingDirectory: options.workspacePath,
            onPermissionRequest: () => ({ kind: 'approved' }),
        });
        const result = await client.sendAndWait(session, { prompt: options.task });
        const output = extractOutput(result);
        const inputTokens = Math.ceil((charter.length + options.task.length) / 4);
        const outputTokens = Math.ceil(output.length / 4);
        return {
            output,
            tokensUsed: inputTokens + outputTokens,
            costUsd: '0.000',
            inputTokens,
            outputTokens,
            resolvedModel: resolved.model,
            modelResolvedVia: resolved.via,
        };
    }
    finally {
        await client.disconnect().catch(() => { });
    }
}
//# sourceMappingURL=squad-client.js.map
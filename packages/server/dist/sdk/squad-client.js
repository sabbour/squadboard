// Thin wrapper around @sabbour/squad-sdk SquadClient.
// Falls back gracefully if SDK not installed so the server runs during hacking phase.
function stubSession(options) {
    return {
        output: `Agent ${options.agentName} processed task: ${options.task.slice(0, 80)}\nWorkspace: ${options.workspacePath}\n[stub output — real SDK integration in production]`,
        tokensUsed: 150,
        costUsd: '0.002',
    };
}
export async function createAgentSession(options) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sdk = await import('@sabbour/squad-sdk');
        return await sdk.SquadClient.createSession({
            agentName: options.agentName,
            charterPath: options.charterPath,
            workspacePath: options.workspacePath,
            squadPath: options.squadPath,
            task: options.task,
        });
    }
    catch (err) {
        const code = err.code;
        if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
            console.warn('[squad-client] @sabbour/squad-sdk not installed — using stub session');
            return stubSession(options);
        }
        throw err;
    }
}
//# sourceMappingURL=squad-client.js.map
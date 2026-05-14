// Thin wrapper around @sabbour/squad-sdk SquadClient.
// Falls back gracefully if SDK not installed so the server runs during hacking phase.

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
}

function stubSession(options: SessionOptions): SessionResult {
  return {
    output: `Agent ${options.agentName} processed task: ${options.task.slice(0, 80)}\nWorkspace: ${options.workspacePath}\n[stub output — real SDK integration in production]`,
    tokensUsed: 150,
    costUsd: '0.002',
  };
}

export async function createAgentSession(options: SessionOptions): Promise<SessionResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdk: any = await import('@sabbour/squad-sdk');
    return await sdk.SquadClient.createSession({
      agentName: options.agentName,
      charterPath: options.charterPath,
      workspacePath: options.workspacePath,
      squadPath: options.squadPath,
      task: options.task,
    });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
      console.warn('[squad-client] @sabbour/squad-sdk not installed — using stub session');
      return stubSession(options);
    }
    throw err;
  }
}

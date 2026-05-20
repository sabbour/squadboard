import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getCapturedSessionConfig,
  setCapturedSessionConfig,
  mockConnect,
  mockDisconnect,
} = vi.hoisted(() => {
  let capturedSessionConfig: Record<string, unknown> | null = null;
  return {
    getCapturedSessionConfig: () => capturedSessionConfig,
    setCapturedSessionConfig: (config: Record<string, unknown> | null) => {
      capturedSessionConfig = config;
    },
    mockConnect: vi.fn().mockResolvedValue(undefined),
    mockDisconnect: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('@bradygaster/squad-sdk/client', () => {
  class MockSession {
    readonly sessionId = 'sdk-session-123';
    private readonly handlers = new Map<string, Set<(event: unknown) => void>>();

    on(eventType: string, handler: (event: unknown) => void) {
      if (!this.handlers.has(eventType)) this.handlers.set(eventType, new Set());
      this.handlers.get(eventType)!.add(handler);
    }

    off(eventType: string, handler: (event: unknown) => void) {
      this.handlers.get(eventType)?.delete(handler);
    }

    emit(eventType: string, event: unknown) {
      for (const handler of this.handlers.get(eventType) ?? []) handler(event);
    }

    async sendAndWait() {
      this.emit('message_delta', { type: 'message_delta', delta: 'hello' });
      this.emit('reasoning_delta', { type: 'reasoning_delta', delta: 'thinking' });
      this.emit('usage', {
        type: 'usage',
        inputTokens: 10,
        outputTokens: 20,
        model: 'gpt-5.4',
      });

      const config = getCapturedSessionConfig();
      const hooks = config?.hooks as {
        onPreToolUse?: (input: unknown, invocation: { sessionId: string }) => Promise<void>;
        onPostToolUse?: (input: unknown, invocation: { sessionId: string }) => Promise<void>;
      } | undefined;

      await hooks?.onPreToolUse?.(
        { timestamp: 1, cwd: '/repo', toolName: 'bash', toolArgs: { command: 'pnpm test' } },
        { sessionId: this.sessionId },
      );
      await hooks?.onPostToolUse?.(
        {
          timestamp: 2,
          cwd: '/repo',
          toolName: 'bash',
          toolArgs: { command: 'pnpm test' },
          toolResult: { textResultForLlm: 'ok', resultType: 'success' },
        },
        { sessionId: this.sessionId },
      );

      this.emit('turn_start', { type: 'turn_start' });
      this.emit('turn_end', { type: 'turn_end' });
      this.emit('idle', { type: 'idle' });

      return { data: { content: 'done' } };
    }
  }

  class SquadClient {
    connect = mockConnect;
    disconnect = mockDisconnect;

    async createSession(config: Record<string, unknown>) {
      setCapturedSessionConfig(config);
      return new MockSession();
    }

    async sendAndWait(session: MockSession) {
      return session.sendAndWait();
    }
  }

  return { SquadClient };
});

import { createAgentSession, type AgentSessionEvent } from '../sdk/squad-client.js';

beforeEach(() => {
  vi.clearAllMocks();
  setCapturedSessionConfig(null);
});

describe('createAgentSession live event bridge', () => {
  it('wires SDK streaming events and tool hooks through onEvent', async () => {
    const events: AgentSessionEvent[] = [];

    const result = await createAgentSession({
      agentName: 'Kobayashi',
      charterPath: '/repo/.squad/agents/kobayashi/charter.md',
      workspacePath: '/repo',
      squadPath: '/repo/.squad',
      task: 'Inspect live run signals',
      systemPrompt: 'You are Kobayashi.',
      agentModel: 'gpt-5.4',
      projectDefaultModel: null,
      onEvent: (event) => events.push(event),
    });

    const config = getCapturedSessionConfig();
    expect(config).toMatchObject({
      model: 'gpt-5.4',
      streaming: true,
      workingDirectory: '/repo',
    });
    expect(config?.hooks).toBeTruthy();

    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining([
        'session.created',
        'message_delta',
        'reasoning_delta',
        'usage',
        'tool.call',
        'tool.result',
        'turn_start',
        'turn_end',
        'idle',
      ]),
    );
    expect(events.find((e) => e.type === 'usage')?.payload).toMatchObject({
      inputTokens: 10,
      outputTokens: 20,
      model: 'gpt-5.4',
      cost: 0.000325,
    });
    expect(events.find((e) => e.type === 'tool.call')?.payload).toMatchObject({
      sessionId: 'sdk-session-123',
      toolName: 'bash',
      args: { command: 'pnpm test' },
    });
    expect(result).toMatchObject({
      output: 'done',
      inputTokens: 10,
      outputTokens: 20,
      tokensUsed: 30,
      costUsd: '0.000325',
      resolvedModel: 'gpt-5.4',
    });
    expect(mockDisconnect).toHaveBeenCalled();
  });
});

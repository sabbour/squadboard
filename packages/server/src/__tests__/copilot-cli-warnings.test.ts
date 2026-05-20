import { describe, expect, it } from 'vitest';
import {
  buildCopilotCliNodeOptions,
  configureCopilotCliWarningSuppression,
} from '../services/copilot-cli-warnings.js';

describe('copilot CLI warning suppression', () => {
  it('adds a child-process-only ExperimentalWarning suppression flag', () => {
    expect(buildCopilotCliNodeOptions({})).toBe('--disable-warning=ExperimentalWarning');
  });

  it('preserves existing NODE_OPTIONS while appending the specific suppression', () => {
    expect(buildCopilotCliNodeOptions({ NODE_OPTIONS: '--max-old-space-size=4096' }))
      .toBe('--max-old-space-size=4096 --disable-warning=ExperimentalWarning');
  });

  it('does not override explicit warning controls', () => {
    expect(buildCopilotCliNodeOptions({ NODE_OPTIONS: '--trace-warnings' })).toBe('--trace-warnings');
    expect(buildCopilotCliNodeOptions({ NODE_OPTIONS: '--no-warnings' })).toBe('--no-warnings');
  });

  it('supports an opt-out for debugging the Copilot CLI child process', () => {
    expect(buildCopilotCliNodeOptions({
      NODE_OPTIONS: '--max-old-space-size=4096',
      SQUADBOARD_COPILOT_CLI_EXPERIMENTAL_WARNINGS: 'true',
    })).toBe('--max-old-space-size=4096');
  });

  it('mutates only the provided env object', () => {
    const env: NodeJS.ProcessEnv = {};
    configureCopilotCliWarningSuppression(env);
    expect(env.NODE_OPTIONS).toBe('--disable-warning=ExperimentalWarning');
  });
});

const DISABLE_EXPERIMENTAL_WARNING_FLAG = '--disable-warning=ExperimentalWarning';
const WARNING_OPT_OUT_VALUES = new Set(['1', 'true', 'yes', 'on']);

function hasWarningControlFlag(nodeOptions: string): boolean {
  return [
    '--no-warnings',
    '--trace-warnings',
    DISABLE_EXPERIMENTAL_WARNING_FLAG,
  ].some((flag) => nodeOptions.includes(flag));
}

export function buildCopilotCliNodeOptions(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const optOut = env['SQUADBOARD_COPILOT_CLI_EXPERIMENTAL_WARNINGS']?.trim().toLowerCase();
  if (optOut && WARNING_OPT_OUT_VALUES.has(optOut)) return env.NODE_OPTIONS;

  const existing = env.NODE_OPTIONS?.trim() ?? '';
  if (existing && hasWarningControlFlag(existing)) return env.NODE_OPTIONS;
  return existing ? `${existing} ${DISABLE_EXPERIMENTAL_WARNING_FLAG}` : DISABLE_EXPERIMENTAL_WARNING_FLAG;
}

export function configureCopilotCliWarningSuppression(env: NodeJS.ProcessEnv = process.env): void {
  const next = buildCopilotCliNodeOptions(env);
  if (next) env.NODE_OPTIONS = next;
}

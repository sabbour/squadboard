/**
 * IPC channel allowlist.
 *
 * All channels must be declared here before the preload exposes them.
 * Renderer code may ONLY invoke channels present in this list.
 * L5/L6 will extend this list as MCP and first-run channels are added.
 */
export const IPC_CHANNELS = [
  'health.check',
  'projects.list',
  'projects.create',
  'app.version',
  'app.openExternal',
  'dialog.openFolder',
  'system.openDevTools',
] as const;

export type IpcChannel = (typeof IPC_CHANNELS)[number];

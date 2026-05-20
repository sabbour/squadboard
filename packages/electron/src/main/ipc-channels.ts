/**
 * IPC channel allowlist.
 *
 * All channels must be declared here before the preload exposes them.
 * Renderer code may ONLY invoke channels present in this list.
 * L6 will add first-run channels.
 */
export const IPC_CHANNELS = [
  'health.check',
  'projects.list',
  'projects.create',
  'app.version',
  'app.openExternal',
  'dialog.openFolder',
  'system.openDevTools',
  // MCP endpoint discovery and configuration
  'mcp.getConnectionInfo',
  'mcp.setDefaultProject',
  'mcp.getDefaultProject',
] as const;

export type IpcChannel = (typeof IPC_CHANNELS)[number];

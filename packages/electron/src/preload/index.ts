/**
 * Context-isolated preload script.
 *
 * Exposes a minimal `window.squadboard` API to the renderer via
 * `contextBridge`. The renderer has NO access to Node.js or Electron APIs
 * directly — all communication goes through the allowlisted IPC channels
 * defined here.
 *
 * Channel allowlist is the single source of truth: if a channel isn't listed
 * here, the renderer cannot invoke it even if a handler is registered in main.
 *
 * L5 will extend the allowlist with MCP channels.
 * L6 will add first-run channels.
 */
import { contextBridge, ipcRenderer } from 'electron';

/** IPC channels the renderer is allowed to invoke. */
const ALLOWED_CHANNELS = [
  'health.check',
  'projects.list',
  'projects.create',
  'app.version',
  'app.openExternal',
  'dialog.openFolder',
  'system.openDevTools',
] as const;

type AllowedChannel = (typeof ALLOWED_CHANNELS)[number];

/** Channels main can send TO the renderer (push events). */
const ALLOWED_RECEIVE_CHANNELS = [
  'menu.newProject',
  'menu.about',
] as const;

type AllowedReceiveChannel = (typeof ALLOWED_RECEIVE_CHANNELS)[number];

function isAllowedChannel(channel: string): channel is AllowedChannel {
  return (ALLOWED_CHANNELS as readonly string[]).includes(channel);
}

function isAllowedReceiveChannel(channel: string): channel is AllowedReceiveChannel {
  return (ALLOWED_RECEIVE_CHANNELS as readonly string[]).includes(channel);
}

const squadboardApi = {
  /**
   * Invoke a main-process IPC handler and await the result.
   * Only channels in the allowlist are accepted.
   */
  invoke: (channel: AllowedChannel, ...args: unknown[]): Promise<unknown> => {
    if (!isAllowedChannel(channel)) {
      return Promise.reject(new Error(`IPC channel not allowed: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },

  /**
   * Subscribe to push events from the main process.
   * Returns an unsubscribe function.
   */
  on: (
    channel: AllowedReceiveChannel,
    listener: (...args: unknown[]) => void,
  ): (() => void) => {
    if (!isAllowedReceiveChannel(channel)) {
      console.warn(`[preload] receive channel not allowed: ${channel}`);
      return () => {};
    }
    const wrapped = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
      listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.off(channel, wrapped);
  },

  /**
   * Unsubscribe a listener (alternative to the returned function from `on`).
   */
  off: (channel: AllowedReceiveChannel, listener: (...args: unknown[]) => void): void => {
    if (!isAllowedReceiveChannel(channel)) return;
    ipcRenderer.off(channel, listener as Parameters<typeof ipcRenderer.off>[1]);
  },
};

contextBridge.exposeInMainWorld('squadboard', squadboardApi);

// Augment the global Window type for TypeScript consumers in the renderer.
declare global {
  interface Window {
    squadboard: typeof squadboardApi;
  }
}

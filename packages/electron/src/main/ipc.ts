/**
 * IPC handler registry — v1 stubs.
 *
 * Handlers are registered here and called by the main process after the
 * BrowserWindow is created. Each handler is a stub that will be wired to
 * real server functions in L3-L5.
 *
 * OUT OF SCOPE for L2:
 *   - Real projects.list / projects.create API calls (L3)
 *   - MCP channel handlers (L5)
 *   - First-run wizard handlers (L6)
 */
import { ipcMain, app, shell, dialog, BrowserWindow } from 'electron';
import type { IpcChannel } from './ipc-channels.js';

type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown;

const registry = new Map<IpcChannel, Handler>();

function handle(channel: IpcChannel, handler: Handler): void {
  registry.set(channel, handler);
  ipcMain.handle(channel, handler);
}

export function registerIpcHandlers(win: BrowserWindow): void {
  handle('health.check', async () => {
    // Stub: once server-launcher exposes a health endpoint, ping it here.
    // For now returns static OK so the renderer can verify IPC is working.
    return { status: 'ok', source: 'electron-stub' };
  });

  handle('projects.list', async () => {
    // Stub: L3 will call fetch('http://localhost:3000/api/projects') here.
    return [];
  });

  handle('projects.create', async (_event, payload) => {
    // Stub: L3 will POST to /api/projects here.
    console.log('[ipc] projects.create stub called with', payload);
    return { id: 'stub', name: 'stub' };
  });

  handle('app.version', async () => app.getVersion());

  handle('app.openExternal', async (_event, url) => {
    if (typeof url !== 'string') throw new Error('url must be a string');
    await shell.openExternal(url);
  });

  handle('dialog.openFolder', async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  handle('system.openDevTools', async () => {
    // Only meaningful in dev; guarded by isDev check in main.
    if (!app.isPackaged) {
      win.webContents.openDevTools();
    }
  });
}

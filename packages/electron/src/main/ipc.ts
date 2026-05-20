/**
 * IPC handler registry.
 *
 * Handlers are registered here and called by the main process after the
 * BrowserWindow is created.
 *
 * OUT OF SCOPE for L2:
 *   - Real projects.list / projects.create API calls (L3)
 *   - First-run wizard handlers (L6)
 */
import { ipcMain, app, shell, dialog, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
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

  // ── MCP handlers ────────────────────────────────────────────────────────────

  const MCP_URL = `http://localhost:3000/mcp`;

  handle('mcp.getConnectionInfo', async () => {
    const base = { url: MCP_URL, transport: 'http', port: 3000 };
    try {
      const res = await fetch(`http://localhost:3000/mcp/health`);
      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        return { ...base, ...data };
      }
    } catch {
      // Server not ready yet — return basic info
    }
    return base;
  });

  handle('mcp.setDefaultProject', async (_event, projectId) => {
    if (typeof projectId !== 'string' && projectId !== null) {
      throw new Error('projectId must be a string or null');
    }
    const configPath = join(app.getPath('userData'), 'squadboard-mcp-config.json');
    mkdirSync(join(app.getPath('userData')), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ defaultProjectId: projectId ?? null }, null, 2), 'utf8');
    return { ok: true };
  });

  handle('mcp.getDefaultProject', async () => {
    try {
      const configPath = join(app.getPath('userData'), 'squadboard-mcp-config.json');
      const raw = readFileSync(configPath, 'utf8');
      const config = JSON.parse(raw) as { defaultProjectId?: string | null };
      return config.defaultProjectId ?? null;
    } catch {
      return null;
    }
  });
}

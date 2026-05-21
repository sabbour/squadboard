/**
 * Electron main process entry point.
 *
 * Responsibilities:
 *   - Enforce single-instance lock
 *   - Start the embedded squadboard server (out-of-process)
 *   - Create the BrowserWindow and load the client UI
 *   - Register IPC handlers
 *   - Build the native menu
 *   - Handle crash-safe quit (stop server before exit)
 *
 * OUT OF SCOPE for L2:
 *   - Dock/tray icon (L11)
 *   - Auto-update (L8)
 *   - Deep-link protocol handlers (L13)
 *   - First-run UX (L6)
 *   - MCP child process management (L5)
 */
import { app, BrowserWindow, shell, screen } from 'electron';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer } from './server-launcher.js';
import { registerIpcHandlers } from './ipc.js';
import { buildMenu } from './menu.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isDev = !app.isPackaged;

const iconPath = isDev
  ? resolve(__dirname, '../../resources/icon.png')
  : join(process.resourcesPath, 'icon.png');

// ── Single-instance lock ──────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.log('[main] another instance is running — quitting');
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;

app.on('second-instance', () => {
  // Focus the existing window when the user tries to open a second instance.
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// ── Window factory ────────────────────────────────────────────────────────────
async function createWindow(): Promise<BrowserWindow> {
  // Match the OS device-pixel-ratio so fonts render at the correct size on
  // high-DPI displays (e.g. 4K monitors, Retina screens, HiDPI on Linux).
  const scaleFactor = screen.getPrimaryDisplay().scaleFactor;

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Squadboard',
    icon: iconPath,
    show: false, // show after ready-to-show to avoid flash
    webPreferences: {
      // electron-vite with "type":"module" outputs preload as .mjs
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,  // required
      nodeIntegration: false,  // never enable in renderer
      sandbox: true,
      // Apply the display scale factor so content isn't rendered too small
      // on high-DPI screens where the OS doesn't inject the scale automatically.
      zoomFactor: scaleFactor,
    },
  });

  // Open external links in the OS browser, not in Electron.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.on('ready-to-show', () => win.show());

  return win;
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  await app.whenReady();

  // Start the server before showing the window so the client has an API to
  // talk to. startServer() resolves when the server emits its ready banner.
  await startServer();

  const win = await createWindow();
  mainWindow = win;

  registerIpcHandlers(win);
  buildMenu(win);

  if (isDev) {
    // In dev, electron-vite serves the renderer on a localhost port.
    // ELECTRON_RENDERER_URL is injected by electron-vite during `dev`.
    const devUrl =
      process.env['ELECTRON_RENDERER_URL'] ?? `http://localhost:5173`;
    await win.loadURL(devUrl);
    // DevTools can be opened manually via View → Toggle Developer Tools
  } else {
    // In production, load the pre-built client from the renderer dist.
    await win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// ── macOS: re-create window when dock icon is clicked ────────────────────────
app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const win = await createWindow();
    mainWindow = win;
    registerIpcHandlers(win);
    if (isDev) {
      const devUrl = process.env['ELECTRON_RENDERER_URL'] ?? 'http://localhost:5173';
      await win.loadURL(devUrl);
    } else {
      await win.loadFile(join(__dirname, '../renderer/index.html'));
    }
  }
});

// ── Crash-safe quit ───────────────────────────────────────────────────────────
// Stop the server before Electron exits so it can flush PGlite WAL cleanly.
let isQuitting = false;

app.on('before-quit', (event) => {
  if (isQuitting) return;
  isQuitting = true;
  event.preventDefault();

  console.log('[main] before-quit — stopping server...');

  // Safety valve: force-exit after 6 s in case stopServer hangs.
  // .unref() ensures this timer doesn't keep the process alive on its own.
  const quitTimeout = setTimeout(() => {
    console.warn('[main] quit timeout — forcing exit');
    app.exit(0);
  }, 6_000);
  quitTimeout.unref();

  stopServer()
    .then(() => {
      clearTimeout(quitTimeout);
      console.log('[main] server stopped — exiting');
      // Use app.exit() rather than app.quit() so we bypass the event loop
      // and any dev-server sockets that might keep the process alive.
      app.exit(0);
    })
    .catch((err) => {
      clearTimeout(quitTimeout);
      console.error('[main] error stopping server:', err);
      app.exit(1);
    });
});

app.on('window-all-closed', () => {
  // On non-macOS, quit when all windows are closed.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

main().catch((err) => {
  console.error('[main] fatal error:', err);
  app.quit();
});

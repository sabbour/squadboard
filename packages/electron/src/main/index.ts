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

// On Linux (including WSL2), Chromium doesn't auto-detect HiDPI from the X11
// server DPI setting. Enable the high-DPI support flag early — before
// app.whenReady() — so Chromium initialises with awareness of the scale.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('high-dpi-support', '1');
}

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
//
// Size and position the window as a percentage of the display work area rather
// than using fixed pixel dimensions. This is DPI-agnostic: regardless of
// whether Electron sees logical pixels (macOS/Windows) or physical pixels
// (WSLg/X11 with broken scale-factor reporting), the window is always
// comfortably sized and correctly centred relative to the available screen space.
//
// We deliberately avoid:
//   - Fixed 1440×900 — too small on HiDPI / 4K displays
//   - setZoomFactor() — zooms page content inside a fixed window, doesn't grow it
//   - win.center() in ready-to-show — unreliable on Linux/WSLg compositors and
//     can place the window off-screen or in a corner after the fact
//
async function createWindow(): Promise<BrowserWindow> {
  // Use the display nearest the cursor so multi-monitor users get the window
  // on the screen they're actively using.
  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  const { workArea } = display;

  // 85% of available work area, clamped to sensible minimums.
  const width  = Math.max(Math.round(workArea.width  * 0.85), 1024);
  const height = Math.max(Math.round(workArea.height * 0.85), 700);

  // Centre explicitly within the work area. workArea.x/y account for taskbars
  // and dock offsets, so this is always visually centred on the right monitor.
  const x = Math.round(workArea.x + (workArea.width  - width)  / 2);
  const y = Math.round(workArea.y + (workArea.height - height) / 2);

  // Honour a manual zoom override (e.g. SQUADBOARD_ZOOM=1.5) without the
  // side-effects of the old GDK_SCALE / QT_SCALE_FACTOR heuristics.
  const manualZoom = parseFloat(process.env['SQUADBOARD_ZOOM'] ?? '');
  const zoomFactor = !isNaN(manualZoom) && manualZoom > 0 ? manualZoom : 1;

  const win = new BrowserWindow({
    width,
    height,
    x,
    y,
    minWidth: 1024,
    minHeight: 700,
    title: 'Squadboard',
    icon: iconPath,
    show: false, // reveal in ready-to-show to avoid white flash
    webPreferences: {
      // electron-vite with "type":"module" outputs preload as .mjs
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,  // required
      nodeIntegration: false,  // never enable in renderer
      sandbox: true,
      zoomFactor,              // applied before first paint; no post-load flash
    },
  });

  // Open external links in the OS browser, not in Electron.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.on('ready-to-show', () => {
    win.show();
  });

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

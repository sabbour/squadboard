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

// ── HiDPI zoom detection ──────────────────────────────────────────────────────
// On Linux/WSL2, screen.getPrimaryDisplay().scaleFactor always returns 1
// because the X11 server under WSLg doesn't expose DPI to Chromium.
// We fall back to environment variables set by the desktop session and a
// manual override so users can tune it without recompiling.
function getEffectiveZoom(): number {
  const env = process.env;

  // 1. Manual override (highest priority) — e.g. SQUADBOARD_ZOOM=1.5
  const manual = parseFloat(env['SQUADBOARD_ZOOM'] ?? '');
  if (!isNaN(manual) && manual > 0) return manual;

  // 2. GNOME / GTK scale (integer, e.g. GDK_SCALE=2)
  const gdk = parseFloat(env['GDK_SCALE'] ?? '');
  if (!isNaN(gdk) && gdk > 1) return gdk;

  // 3. KDE / Qt fractional scale (e.g. QT_SCALE_FACTOR=1.5)
  const qt = parseFloat(env['QT_SCALE_FACTOR'] ?? '');
  if (!isNaN(qt) && qt > 1) return qt;

  // 4. Electron/Chromium scale factor (works correctly on macOS/Windows)
  const electronScale = screen.getPrimaryDisplay().scaleFactor;
  if (electronScale > 1) return electronScale;

  // 5. Linux HiDPI default — X11/WSLg doesn't expose DPI to Chromium so
  //    scaleFactor is always 1. Apply 1.25× so text is comfortably readable
  //    on modern 2K/4K displays. Override with SQUADBOARD_ZOOM if needed.
  if (process.platform === 'linux') return 1.25;

  return 1; // no scaling needed
}

// ── Window factory ────────────────────────────────────────────────────────────
async function createWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    center: true,  // open centered on the primary display
    title: 'Squadboard',
    icon: iconPath,
    show: false, // show after ready-to-show to avoid flash
    webPreferences: {
      // electron-vite with "type":"module" outputs preload as .mjs
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,  // required
      nodeIntegration: false,  // never enable in renderer
      sandbox: true,
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
    // Re-center explicitly — on Linux/WSL2, center:true in BrowserWindow
    // options isn't reliably respected by the X11/WSLg compositor.
    win.center();

    // Apply HiDPI zoom *after* the renderer is loaded so the factor is
    // respected. Setting it in webPreferences.zoomFactor doesn't work on
    // Linux/WSL2 because scaleFactor = 1 there.
    const zoom = getEffectiveZoom();
    if (zoom !== 1) {
      win.webContents.setZoomFactor(zoom);
    }
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

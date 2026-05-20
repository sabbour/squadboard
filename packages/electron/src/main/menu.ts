/**
 * Native application menu.
 *
 * Scaffold for L2. L3 will add deep-link handlers; L6 will add first-run
 * triggers; L11 will add tray integration.
 */
import { Menu, app, shell, clipboard, dialog, BrowserWindow, MenuItem } from 'electron';

const isMac = process.platform === 'darwin';
const isDev = !app.isPackaged;

export function buildMenu(win: BrowserWindow): void {
  const template: (Electron.MenuItemConstructorOptions | MenuItem)[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Project',
          accelerator: 'CmdOrCtrl+N',
          click: () => win.webContents.send('menu.newProject'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' as const },
              { role: 'delete' as const },
              { role: 'selectAll' as const },
            ]
          : [{ role: 'delete' as const }, { role: 'selectAll' as const }]),
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        ...(isDev
          ? [
              { type: 'separator' as const },
              {
                label: 'Toggle Developer Tools',
                accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
                click: () => win.webContents.toggleDevTools(),
              },
            ]
          : []),
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
            ]
          : [{ role: 'close' as const }]),
      ],
    },
    {
      role: 'help' as const,
      submenu: [
        {
          label: 'About Squadboard',
          click: () => win.webContents.send('menu.about'),
        },
        {
          label: 'View Documentation',
          click: () => shell.openExternal('https://github.com/sabbour/squadboard#readme'),
        },
        {
          label: 'Open Logs Folder',
          click: () => shell.openPath(app.getPath('logs')),
        },
        { type: 'separator' },
        {
          label: 'Copy MCP URL',
          click: () => {
            const mcpUrl = 'http://localhost:3000/mcp';
            clipboard.writeText(mcpUrl);
            dialog.showMessageBox(win, {
              type: 'info',
              title: 'MCP URL Copied',
              message: `MCP URL copied to clipboard:\n${mcpUrl}`,
              buttons: ['OK'],
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

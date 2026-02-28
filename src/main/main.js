const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const modules = require('./modules');
const { registerIpcHandlers } = require('./ipc-handlers');

let mainWindow;
let reloadTimer = null;

function setupDevHotReload() {
  if (app.isPackaged) return;

  const watchTargets = [
    path.join(__dirname, '..', 'renderer', 'index.html'),
    path.join(__dirname, '..', 'renderer', 'dist.css'),
    path.join(__dirname, '..', 'renderer', 'js'),
  ];

  const reloadRenderer = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.reloadIgnoringCache();
    }, 120);
  };

  for (const target of watchTargets) {
    try {
      fs.watch(target, { persistent: true }, reloadRenderer);
    } catch (err) {
      console.warn(`Hot reload watch failed for ${target}:`, err.message);
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Split Horizontal',
          accelerator: 'CmdOrCtrl+Shift+H',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('split-h');
            }
          },
        },
        {
          label: 'Split Vertical',
          accelerator: 'CmdOrCtrl+Shift+V',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('split-v');
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('open-settings');
            }
          },
        },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.on('show-verse-context-menu', (event, { hasSelection }) => {
  const menu = Menu.buildFromTemplate([
    {
      label: 'Copy',
      accelerator: 'CmdOrCtrl+C',
      enabled: hasSelection,
      click: () => event.sender.send('context-menu-copy'),
    },
  ]);
  menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
});

ipcMain.on('show-strongs-context-menu', (event, { strongsNumber, paneId, labels }) => {
  const menu = Menu.buildFromTemplate([
    {
      label: labels.search,
      click: () => event.sender.send('strongs-search', { strongsNumber, paneId }),
    },
    {
      label: labels.lookup,
      click: () => event.sender.send('strongs-lookup', { strongsNumber, paneId }),
    },
  ]);
  menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
});

app.whenReady().then(() => {
  modules.init();
  registerIpcHandlers();
  buildMenu();
  createWindow();
  setupDevHotReload();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

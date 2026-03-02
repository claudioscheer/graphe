const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const https = require('https');
const path = require('path');
const fs = require('fs');
const modules = require('./modules');
const { registerIpcHandlers } = require('./ipc-handlers');

let mainWindow;
let reloadTimer = null;
const windowIconPath = path.join(__dirname, '..', '..', 'assets', 'graphe.png');
const macDockIconPath = path.join(__dirname, '..', '..', 'assets', 'graphe.icns');

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
    icon: windowIconPath,
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Block all navigation away from the app (defense-in-depth)
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  // Deny all new window creation
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
    setTimeout(() => checkForUpdates(), 3000);
  });
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

function checkForUpdates() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!require('electron').net.isOnline()) return;

  const options = {
    hostname: 'api.github.com',
    path: '/repos/claudioscheer/graphe/releases/latest',
    headers: { 'User-Agent': `Graphe/${app.getVersion()}` },
  };

  https
    .get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const release = JSON.parse(data);
          const tag = (release.tag_name || '').replace(/^v/, '');
          if (tag && compareVersions(app.getVersion(), tag) < 0) {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('update-available', {
                version: tag,
                url: release.html_url,
              });
            }
          }
        } catch (_) {
          /* ignore */
        }
      });
    })
    .on('error', () => {
      /* ignore */
    });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const settingsMenuItem = {
    label: 'Settings',
    accelerator: 'CmdOrCtrl+,',
    click: () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('open-settings');
      }
    },
  };
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        settingsMenuItem,
        { type: 'separator' },
        ...(isMac ? [{ role: 'close' }] : [{ role: 'quit' }]),
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Split Horizontal',
          submenu: [
            {
              label: 'Bible View',
              accelerator: 'CmdOrCtrl+Shift+H',
              click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('split-h');
                }
              },
            },
            {
              label: 'Commentary View',
              click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('split-h-commentary');
                }
              },
            },
          ],
        },
        {
          label: 'Split Vertical',
          submenu: [
            {
              label: 'Bible View',
              accelerator: 'CmdOrCtrl+Shift+V',
              click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('split-v');
                }
              },
            },
            {
              label: 'Commentary View',
              click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('split-v-commentary');
                }
              },
            },
          ],
        },
      ],
    },
    { role: 'windowMenu' },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Graphe',
          click: () => {
            if (isMac) {
              app.showAboutPanel();
            } else if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('open-about');
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Report Issue',
          click: () => {
            shell.openExternal('https://github.com/claudioscheer/graphe/issues');
          },
        },
      ],
    },
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

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('open-external', (_event, url) => {
  const allowed = [
    'https://github.com/claudioscheer/graphe',
    'https://github.com/claudioscheer/graphe/issues',
    'https://github.com/claudioscheer/graphe/releases',
  ];
  if (allowed.some((prefix) => url === prefix || url.startsWith(prefix + '/'))) {
    return shell.openExternal(url);
  }
});

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.setAboutPanelOptions({
      applicationName: 'Graphe',
      applicationVersion: app.getVersion(),
      copyright: 'Claudio Scheer',
      iconPath: windowIconPath,
    });
  }

  if (process.platform === 'darwin' && app.dock && typeof app.dock.setIcon === 'function') {
    const dockIconPath = fs.existsSync(macDockIconPath) ? macDockIconPath : windowIconPath;
    if (fs.existsSync(dockIconPath)) {
      try {
        app.dock.setIcon(dockIconPath);
      } catch (err) {
        console.warn('Failed to set macOS dock icon:', err.message || err);
      }
    }
  }

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

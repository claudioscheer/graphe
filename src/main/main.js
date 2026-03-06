const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require('electron');
const https = require('https');
const path = require('path');
const fs = require('fs');
const os = require('os');
const modules = require('./modules');
const { registerIpcHandlers } = require('./ipc-handlers');
const stateStore = require('./state-store');

let mainWindow;
let xrayWindows = new Set();
let reloadTimer = null;
let updateCheckTimer = null;
let pendingUpdate = null;
let isCheckingForUpdates = false;
const windowIconPath = path.join(__dirname, '..', '..', 'assets', 'graphe.png');
const macDockIconPath = path.join(__dirname, '..', '..', 'assets', 'graphe.icns');
const UPDATE_CHECK_INITIAL_DELAY_MS = 3000;
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const UPDATE_CHECK_RETRY_MS = 5 * 60 * 1000;
const UPDATE_REQUEST_TIMEOUT_MS = 10000;
const PACKAGED_DEBUG_FLAG = '--graphe-debug';
const isPackagedDebugEnabled =
  process.env.GRAPHE_DEBUG_PACKAGED === '1' || process.argv.includes(PACKAGED_DEBUG_FLAG);

function logPackagedDebug(...args) {
  if (!isPackagedDebugEnabled) return;
  console.error('[packaged-debug]', ...args);
}

function setupDevHotReload() {
  if (app.isPackaged) return;

  const watchTargets = [
    path.join(__dirname, '..', 'renderer', 'index.html'),
    path.join(__dirname, '..', 'renderer', 'xray.html'),
    path.join(__dirname, '..', 'renderer', 'dist.css'),
    path.join(__dirname, '..', 'renderer', 'js'),
  ];

  const reloadRenderer = () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.reloadIgnoringCache();
      }
      for (const win of xrayWindows) {
        if (!win.isDestroyed()) win.webContents.reloadIgnoringCache();
      }
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
  const rendererHtml = app.isPackaged
    ? path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html')
    : path.join(__dirname, '..', 'renderer', 'index.html');

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

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('Main window failed to load:', {
      errorCode,
      errorDescription,
      validatedURL,
    });
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('Main window render process gone:', details);
  });
  mainWindow.on('unresponsive', () => {
    console.error('Main window became unresponsive.');
  });

  mainWindow.loadFile(rendererHtml);

  // Block all navigation away from the app (defense-in-depth)
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  // Deny all new window creation
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
    if (isPackagedDebugEnabled) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
    setTimeout(() => triggerUpdateCheck(), UPDATE_CHECK_INITIAL_DELAY_MS);
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

function sendUpdateAvailable(updateInfo) {
  pendingUpdate = updateInfo;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-available', updateInfo);
  }
}

function scheduleNextUpdateCheck(delayMs) {
  clearTimeout(updateCheckTimer);
  updateCheckTimer = setTimeout(() => {
    triggerUpdateCheck();
  }, delayMs);
}

function checkForUpdates() {
  if (isCheckingForUpdates) return Promise.resolve(false);
  if (!require('electron').net.isOnline()) return Promise.resolve(false);

  isCheckingForUpdates = true;
  const options = {
    hostname: 'api.github.com',
    path: '/repos/claudioscheer/graphe/releases/latest',
    method: 'GET',
    timeout: UPDATE_REQUEST_TIMEOUT_MS,
    headers: {
      'User-Agent': `Graphe/${app.getVersion()}`,
      Accept: 'application/vnd.github+json',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  };

  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            resolve(false);
            return;
          }
          const release = JSON.parse(data);
          const tag = (release.tag_name || '').replace(/^v/, '');
          if (tag && compareVersions(app.getVersion(), tag) < 0) {
            const updateInfo = {
              version: tag,
              url: release.html_url,
            };
            if (!pendingUpdate || pendingUpdate.version !== updateInfo.version) {
              sendUpdateAvailable(updateInfo);
            }
            resolve(true);
            return;
          }
          resolve(false);
        } catch (_) {
          resolve(false);
        } finally {
          isCheckingForUpdates = false;
        }
      });
    });
    req.on('error', () => {
      isCheckingForUpdates = false;
      resolve(false);
    });
    req.on('timeout', () => {
      req.destroy();
    });
    req.end();
  });
}

async function triggerUpdateCheck() {
  const hasUpdate = await checkForUpdates();
  scheduleNextUpdateCheck(hasUpdate ? UPDATE_CHECK_INTERVAL_MS : UPDATE_CHECK_RETRY_MS);
}

async function installModulesFromDialog() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Bible Modules', extensions: ['sqlite3'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return;
  const installed = modules.installFiles(result.filePaths);
  if (installed.skipped.length > 0) {
    dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      title: 'Install Modules',
      message: `Skipped ${installed.skipped.length} invalid file(s):\n${installed.skipped.join('\n')}`,
    });
  }
  if (installed.copied > 0 && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.reloadIgnoringCache();
  }
}

let convertTmpDir = null;

function openConvertModal() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('open-convert-modules');
  }
}

function reloadModulesAndRefresh(targetWindow = mainWindow) {
  try {
    modules.reload();
  } catch (err) {
    console.error('Failed to reload modules:', err);
  }
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.webContents.reloadIgnoringCache();
  }
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const openAboutDialog = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('open-about');
      return;
    }

    createWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.once('did-finish-load', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('open-about');
        }
      });
    }
  };
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
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { label: 'About Graphe', click: openAboutDialog },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Install Modules...',
          click: () => installModulesFromDialog(),
        },
        {
          label: 'Convert Modules...',
          click: () => openConvertModal(),
        },
        {
          label: 'Reload Modules',
          click: () => reloadModulesAndRefresh(),
        },
        { type: 'separator' },
        settingsMenuItem,
        { type: 'separator' },
        ...(isMac ? [{ role: 'close' }] : [{ role: 'quit' }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Edit Module Data...',
          accelerator: 'CmdOrCtrl+E',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('open-module-editor');
            }
          },
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        ...(!app.isPackaged || isPackagedDebugEnabled ? [{ role: 'toggleDevTools' }] : []),
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
        ...(isMac
          ? []
          : [
              {
                label: 'About Graphe',
                click: openAboutDialog,
              },
              { type: 'separator' },
            ]),
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

ipcMain.on('show-verse-context-menu', (event, { hasSelection, xrayParams, labels }) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender);
  const menuItems = [
    {
      label: 'Copy',
      accelerator: 'CmdOrCtrl+C',
      enabled: hasSelection,
      click: () => event.sender.send('context-menu-copy'),
    },
  ];
  if (xrayParams) {
    menuItems.push({
      label: (labels && labels.xray) || 'Verse X-Ray',
      click: () => createXrayWindow(xrayParams),
    });
  }
  menuItems.push({ type: 'separator' });
  menuItems.push({
    label: 'Reload Modules',
    click: () => reloadModulesAndRefresh(targetWindow),
  });
  const menu = Menu.buildFromTemplate(menuItems);
  menu.popup({ window: targetWindow });
});

ipcMain.on('show-strongs-context-menu', (event, { strongsNumber, paneId, labels }) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender);
  const menu = Menu.buildFromTemplate([
    {
      label: labels.search,
      click: () => event.sender.send('strongs-search', { strongsNumber, paneId }),
    },
    {
      label: labels.lookup,
      click: () => event.sender.send('strongs-lookup', { strongsNumber, paneId }),
    },
    { type: 'separator' },
    {
      label: 'Reload Modules',
      click: () => reloadModulesAndRefresh(targetWindow),
    },
  ]);
  menu.popup({ window: targetWindow });
});

ipcMain.on('install-modules', () => installModulesFromDialog());

ipcMain.handle('select-convert-files', async () => {
  const converter = require('./modules/converters');
  const extensions = converter.getSupportedExtensions().map((e) => e.slice(1));
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Convertible Modules', extensions }],
  });
  if (result.canceled || result.filePaths.length === 0) return { files: [] };
  return {
    files: result.filePaths.map((fp) => ({ path: fp, name: path.basename(fp) })),
  };
});

ipcMain.handle('select-convert-folder', async () => {
  const converter = require('./modules/converters');
  const extSet = new Set(converter.getSupportedExtensions());
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return { files: [] };

  const files = [];
  function scanDir(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(full);
      } else if (extSet.has(path.extname(entry.name).toLowerCase())) {
        files.push({ path: full, name: entry.name });
      }
    }
  }
  scanDir(result.filePaths[0]);
  return { files };
});

ipcMain.handle('convert-single-file', async (_event, filePath) => {
  const converter = require('./modules/converters');
  if (!convertTmpDir) {
    convertTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphe-convert-'));
  }
  try {
    const out = await converter.convertFile(filePath, convertTmpDir);
    return { ok: true, name: path.basename(out), tmpPath: out, sourceDir: path.dirname(filePath) };
  } catch (err) {
    return { ok: false, name: path.basename(filePath), error: err.message };
  }
});

ipcMain.handle('finish-convert', (_event, convertedFiles, mode) => {
  const successfulFiles = Array.isArray(convertedFiles)
    ? convertedFiles.filter((c) => c && c.ok !== false && typeof c.tmpPath === 'string')
    : [];
  if (mode === 'install') {
    modules.installFiles(successfulFiles.map((c) => c.tmpPath));
  } else {
    for (const c of successfulFiles) {
      fs.copyFileSync(c.tmpPath, path.join(c.sourceDir, c.name));
    }
  }
  // Clean up temp dir
  if (convertTmpDir) {
    fs.rmSync(convertTmpDir, { recursive: true, force: true });
    convertTmpDir = null;
  }
  if (mode === 'install' && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.reloadIgnoringCache();
  }
  return true;
});

ipcMain.handle('cleanup-convert', () => {
  if (convertTmpDir) {
    fs.rmSync(convertTmpDir, { recursive: true, force: true });
    convertTmpDir = null;
  }
  return true;
});

function createXrayWindow({ moduleId, bookNumber, chapter, verse }) {
  const xrayHtml = app.isPackaged
    ? path.join(__dirname, '..', '..', 'dist', 'renderer', 'xray.html')
    : path.join(__dirname, '..', 'renderer', 'xray.html');

  const win = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 500,
    minHeight: 400,
    maximizable: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: windowIconPath,
    show: false,
  });

  win.setMenuBarVisibility(false);

  win.loadFile(xrayHtml, {
    query: {
      moduleId,
      bookNumber: String(bookNumber),
      chapter: String(chapter),
      verse: String(verse),
    },
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => xrayWindows.delete(win));

  // Block navigation away
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  xrayWindows.add(win);
}

ipcMain.on('open-xray-window', (_event, opts) => {
  createXrayWindow(opts);
});

ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('get-pending-update', () => pendingUpdate);

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
  if (isPackagedDebugEnabled) {
    logPackagedDebug('argv:', process.argv);
    logPackagedDebug('app.isPackaged:', app.isPackaged);
  }

  // In development, Electron launched by Forge does not need a dock icon override.
  // Skipping this avoids noisy warnings and keeps startup on the safest code path.
  if (
    app.isPackaged &&
    process.platform === 'darwin' &&
    app.dock &&
    typeof app.dock.setIcon === 'function'
  ) {
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

app.on('before-quit', () => {
  clearTimeout(updateCheckTimer);
  stateStore.saveStateSync();
});

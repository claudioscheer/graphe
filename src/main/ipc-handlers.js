const { ipcMain } = require('electron');
const modules = require('./modules');
const stateStore = require('./state-store');

function registerIpcHandlers() {
  ipcMain.handle('get-modules', () => modules.getModules());

  ipcMain.handle('get-books', (_event, moduleId) => modules.getBooks(moduleId));

  ipcMain.handle('get-chapter-count', (_event, moduleId, bookNumber) =>
    modules.getChapterCount(moduleId, bookNumber)
  );

  ipcMain.handle('get-chapter', (_event, moduleId, bookNumber, chapter) =>
    modules.getChapter(moduleId, bookNumber, chapter)
  );

  ipcMain.handle('search-verses', (_event, moduleId, query) =>
    modules.searchVerses(moduleId, query)
  );

  ipcMain.handle('get-app-state', () => stateStore.loadState());

  ipcMain.handle('save-app-state', (_event, state) => stateStore.saveState(state));
}

module.exports = { registerIpcHandlers };

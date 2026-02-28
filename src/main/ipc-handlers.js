const { ipcMain } = require('electron');
const modules = require('./modules');

function registerIpcHandlers() {
  ipcMain.handle('get-modules', () => modules.getModules());

  ipcMain.handle('get-books', (_event, moduleId) => modules.getBooks(moduleId));

  ipcMain.handle('get-chapter-count', (_event, moduleId, bookNumber) =>
    modules.getChapterCount(moduleId, bookNumber)
  );

  ipcMain.handle('get-chapter', (_event, moduleId, bookNumber, chapter) =>
    modules.getChapter(moduleId, bookNumber, chapter)
  );
}

module.exports = { registerIpcHandlers };

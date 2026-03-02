const { ipcMain } = require('electron');
const modules = require('./modules');
const stateStore = require('./state-store');

function registerIpcHandlers() {
  ipcMain.handle('get-modules', () => modules.getModules());

  ipcMain.handle('get-books', (_event, moduleId) => modules.getBooks(moduleId));

  ipcMain.handle('get-all-books', () => modules.getAllBooks());

  ipcMain.handle('get-chapter-count', (_event, moduleId, bookNumber) =>
    modules.getChapterCount(moduleId, bookNumber)
  );

  ipcMain.handle('get-chapter', (_event, moduleId, bookNumber, chapter) =>
    modules.getChapter(moduleId, bookNumber, chapter)
  );

  ipcMain.handle('search-verses', (_event, moduleId, query) =>
    modules.searchVerses(moduleId, query)
  );

  ipcMain.handle('get-dictionary-entry', (_event, moduleId, topic) =>
    modules.getDictionaryEntry(moduleId, topic)
  );

  ipcMain.handle('lookup-all-strong-dicts', (_event, topic, allowedModuleIds) =>
    modules.lookupAllStrongDicts(topic, allowedModuleIds)
  );

  ipcMain.handle('search-dictionary-topics', (_event, moduleId, prefix, limit) =>
    modules.searchDictionaryTopics(moduleId, prefix, limit)
  );

  ipcMain.handle('get-dictionary-cognates', (_event, moduleId, strongsNumber) =>
    modules.getDictionaryCognates(moduleId, strongsNumber)
  );

  ipcMain.handle('get-cross-references', (_event, book, chapter, allowedModuleIds) =>
    modules.lookupAllCrossRefModules(book, chapter, allowedModuleIds)
  );

  ipcMain.handle('get-commentary', (_event, moduleId, bookNumber, chapter) =>
    modules.getCommentary(moduleId, bookNumber, chapter)
  );

  ipcMain.handle('get-commentary-books', (_event, moduleId) =>
    modules.getCommentaryBooks(moduleId)
  );

  ipcMain.handle('get-app-state', () => stateStore.loadState());

  ipcMain.handle('save-app-state', (_event, state) => stateStore.saveState(state));
}

module.exports = { registerIpcHandlers };

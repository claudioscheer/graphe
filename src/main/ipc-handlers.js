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

  ipcMain.handle('search-verses-semantic', (_event, moduleId, query, opts) =>
    modules.searchVersesSemantic(moduleId, query, opts)
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

  ipcMain.handle('search-verses-hybrid', (_event, moduleId, query, opts) =>
    modules.searchVersesHybrid(moduleId, query, opts)
  );

  ipcMain.handle('semantic-index-status', (_event, moduleId) =>
    modules.getSemanticIndexStatus(moduleId)
  );

  ipcMain.handle('semantic-index-build', (_event, moduleId) =>
    modules.buildSemanticIndex(moduleId)
  );

  ipcMain.handle('semantic-index-progress', (_event, jobId) =>
    modules.getSemanticIndexProgress(jobId)
  );

  ipcMain.handle('semantic-index-cancel', (_event, jobId) =>
    modules.cancelSemanticIndexBuild(jobId)
  );

  ipcMain.handle('get-cross-references', (_event, book, chapter, allowedModuleIds) =>
    modules.lookupAllCrossRefModules(book, chapter, allowedModuleIds)
  );

  ipcMain.handle('get-app-state', () => stateStore.loadState());

  ipcMain.handle('save-app-state', (_event, state) => stateStore.saveState(state));
}

module.exports = { registerIpcHandlers };

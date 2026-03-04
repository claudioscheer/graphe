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

  ipcMain.handle('search-verses-limited', (_event, moduleId, query, limit) =>
    modules.searchVerses(moduleId, query, { limit: Number(limit) || 20 })
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

  ipcMain.handle('get-dictionary-meta', (_event, moduleId) => modules.getDictionaryMeta(moduleId));

  ipcMain.handle('get-dictionary-topic-count', (_event, moduleId) =>
    modules.getDictionaryTopicCount(moduleId)
  );

  ipcMain.handle('get-dictionary-topics-by-prefix', (_event, moduleId, prefix, limit, offset) =>
    modules.getDictionaryTopicsByPrefix(moduleId, prefix, limit, offset)
  );

  ipcMain.handle('get-dictionary-random-topics', (_event, moduleId, limit) =>
    modules.getDictionaryRandomTopics(moduleId, limit)
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

  ipcMain.handle('get-commentary-coverage', (_event, moduleId) =>
    modules.getCommentaryCoverage(moduleId)
  );

  ipcMain.handle('get-module-path', (_event, moduleId) => modules.getModulePath(moduleId));
  ipcMain.handle('get-editable-module-state', (_event, moduleId) =>
    modules.getEditableModuleState(moduleId)
  );
  ipcMain.handle('save-info-value', (_event, moduleId, name, value) =>
    modules.saveInfoValue(moduleId, name, value)
  );
  ipcMain.handle('delete-info-value', (_event, moduleId, name) =>
    modules.deleteInfoValue(moduleId, name)
  );
  ipcMain.handle('save-book-names', (_event, moduleId, bookNumber, fields) =>
    modules.saveBookNames(moduleId, bookNumber, fields)
  );
  ipcMain.handle('get-verse-record', (_event, moduleId, bookNumber, chapter, verse) =>
    modules.getVerseRecord(moduleId, bookNumber, chapter, verse)
  );
  ipcMain.handle('save-verse-text', (_event, moduleId, bookNumber, chapter, verse, text) =>
    modules.saveVerseText(moduleId, bookNumber, chapter, verse, text)
  );
  ipcMain.handle('get-commentary-entry', (_event, moduleId, bookNumber, chapter, verseFrom) =>
    modules.getCommentaryEntry(moduleId, bookNumber, chapter, verseFrom)
  );
  ipcMain.handle(
    'save-commentary-text',
    (_event, moduleId, bookNumber, chapter, verseFrom, text) =>
      modules.saveCommentaryText(moduleId, bookNumber, chapter, verseFrom, text)
  );

  ipcMain.handle('get-app-state', () => stateStore.loadState());

  ipcMain.handle('save-app-state', (_event, state) => stateStore.saveState(state));
}

module.exports = { registerIpcHandlers };

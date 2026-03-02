const { contextBridge, ipcRenderer } = require('electron');

const listenerRegistry = new Map();

function setSingleListener(channel, callback) {
  const prev = listenerRegistry.get(channel);
  if (prev) {
    ipcRenderer.removeListener(channel, prev);
    listenerRegistry.delete(channel);
  }
  if (typeof callback !== 'function') return;
  ipcRenderer.on(channel, callback);
  listenerRegistry.set(channel, callback);
}

contextBridge.exposeInMainWorld('api', {
  getModules: () => ipcRenderer.invoke('get-modules'),
  getBooks: (moduleId) => ipcRenderer.invoke('get-books', moduleId),
  getAllBooks: () => ipcRenderer.invoke('get-all-books'),
  getChapterCount: (moduleId, bookNumber) =>
    ipcRenderer.invoke('get-chapter-count', moduleId, bookNumber),
  getChapter: (moduleId, bookNumber, chapter) =>
    ipcRenderer.invoke('get-chapter', moduleId, bookNumber, chapter),
  searchVerses: (moduleId, query) => ipcRenderer.invoke('search-verses', moduleId, query),
  searchVersesSemantic: (moduleId, query, opts) =>
    ipcRenderer.invoke('search-verses-semantic', moduleId, query, opts),
  getDictionaryEntry: (moduleId, topic) =>
    ipcRenderer.invoke('get-dictionary-entry', moduleId, topic),
  lookupAllStrongDicts: (topic, allowedModuleIds) =>
    ipcRenderer.invoke('lookup-all-strong-dicts', topic, allowedModuleIds),
  searchDictionaryTopics: (moduleId, prefix, limit) =>
    ipcRenderer.invoke('search-dictionary-topics', moduleId, prefix, limit),
  getDictionaryCognates: (moduleId, strongsNumber) =>
    ipcRenderer.invoke('get-dictionary-cognates', moduleId, strongsNumber),
  searchVersesHybrid: (moduleId, query, opts) =>
    ipcRenderer.invoke('search-verses-hybrid', moduleId, query, opts),
  getSemanticIndexStatus: (moduleId) => ipcRenderer.invoke('semantic-index-status', moduleId),
  buildSemanticIndex: (moduleId) => ipcRenderer.invoke('semantic-index-build', moduleId),
  getSemanticIndexProgress: (jobId) => ipcRenderer.invoke('semantic-index-progress', jobId),
  cancelSemanticIndexBuild: (jobId) => ipcRenderer.invoke('semantic-index-cancel', jobId),
  getCrossReferences: (book, chapter, allowedModuleIds) =>
    ipcRenderer.invoke('get-cross-references', book, chapter, allowedModuleIds),
  getCommentary: (moduleId, bookNumber, chapter) =>
    ipcRenderer.invoke('get-commentary', moduleId, bookNumber, chapter),
  getCommentaryBooks: (moduleId) => ipcRenderer.invoke('get-commentary-books', moduleId),
  getAppState: () => ipcRenderer.invoke('get-app-state'),
  saveAppState: (state) => ipcRenderer.invoke('save-app-state', state),
  onOpenSettings: (callback) => setSingleListener('open-settings', callback),
  onSplitH: (callback) => setSingleListener('split-h', callback),
  onSplitV: (callback) => setSingleListener('split-v', callback),
  onSplitHCommentary: (callback) => setSingleListener('split-h-commentary', callback),
  onSplitVCommentary: (callback) => setSingleListener('split-v-commentary', callback),
  showVerseContextMenu: (opts) => ipcRenderer.send('show-verse-context-menu', opts),
  onContextMenuCopy: (callback) => setSingleListener('context-menu-copy', callback),
  onContextMenuCrossRefs: (callback) => setSingleListener('context-menu-crossrefs', callback),
  showStrongsContextMenu: (opts) => ipcRenderer.send('show-strongs-context-menu', opts),
  onStrongsSearch: (callback) => setSingleListener('strongs-search', callback),
  onStrongsLookup: (callback) => setSingleListener('strongs-lookup', callback),
  onOpenAbout: (callback) => setSingleListener('open-about', callback),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});

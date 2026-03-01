const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getModules: () => ipcRenderer.invoke('get-modules'),
  getBooks: (moduleId) => ipcRenderer.invoke('get-books', moduleId),
  getChapterCount: (moduleId, bookNumber) =>
    ipcRenderer.invoke('get-chapter-count', moduleId, bookNumber),
  getChapter: (moduleId, bookNumber, chapter) =>
    ipcRenderer.invoke('get-chapter', moduleId, bookNumber, chapter),
  searchVerses: (moduleId, query) =>
    ipcRenderer.invoke('search-verses', moduleId, query),
  getDictionaryEntry: (moduleId, topic) =>
    ipcRenderer.invoke('get-dictionary-entry', moduleId, topic),
  lookupAllStrongDicts: (topic, allowedModuleIds) =>
    ipcRenderer.invoke('lookup-all-strong-dicts', topic, allowedModuleIds),
  searchDictionaryTopics: (moduleId, prefix, limit) =>
    ipcRenderer.invoke('search-dictionary-topics', moduleId, prefix, limit),
  getDictionaryCognates: (moduleId, strongsNumber) =>
    ipcRenderer.invoke('get-dictionary-cognates', moduleId, strongsNumber),
  getAppState: () => ipcRenderer.invoke('get-app-state'),
  saveAppState: (state) => ipcRenderer.invoke('save-app-state', state),
  onOpenSettings: (callback) => ipcRenderer.on('open-settings', callback),
  onSplitH: (callback) => ipcRenderer.on('split-h', callback),
  onSplitV: (callback) => ipcRenderer.on('split-v', callback),
  showVerseContextMenu: (opts) => ipcRenderer.send('show-verse-context-menu', opts),
  onContextMenuCopy: (callback) => ipcRenderer.on('context-menu-copy', callback),
  showStrongsContextMenu: (opts) => ipcRenderer.send('show-strongs-context-menu', opts),
  onStrongsSearch: (callback) => ipcRenderer.on('strongs-search', callback),
  onStrongsLookup: (callback) => ipcRenderer.on('strongs-lookup', callback),
});

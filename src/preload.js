const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getModules: () => ipcRenderer.invoke('get-modules'),
  getBooks: (moduleId) => ipcRenderer.invoke('get-books', moduleId),
  getChapterCount: (moduleId, bookNumber) =>
    ipcRenderer.invoke('get-chapter-count', moduleId, bookNumber),
  getChapter: (moduleId, bookNumber, chapter) =>
    ipcRenderer.invoke('get-chapter', moduleId, bookNumber, chapter),
  onOpenSettings: (callback) => ipcRenderer.on('open-settings', callback),
});

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

type PreloadListenerArg =
  | string
  | number
  | boolean
  | null
  | UpdateInfo
  | StrongsActionPayload
  | JsonObject
  | JsonValue[];
type PreloadListener<Args extends PreloadListenerArg[] = PreloadListenerArg[]> = (
  ...args: Args
) => void;
type IpcListener = (event: IpcRendererEvent, ...args: PreloadListenerArg[]) => void;

const listenerRegistry = new Map<string, IpcListener>();

function setSingleListener<Args extends PreloadListenerArg[]>(
  channel: string,
  callback: PreloadListener<Args> | null | undefined
): void {
  const prev = listenerRegistry.get(channel);
  if (prev) {
    ipcRenderer.removeListener(channel, prev);
    listenerRegistry.delete(channel);
  }
  if (typeof callback !== 'function') return;
  const wrapper = (_event: IpcRendererEvent, ...args: Args): void => callback(...args);
  ipcRenderer.on(channel, wrapper);
  listenerRegistry.set(channel, wrapper as IpcListener);
}

const api: WindowApi = {
  getModules: () => ipcRenderer.invoke('get-modules'),
  getBooks: (moduleId) => ipcRenderer.invoke('get-books', moduleId),
  getAllBooks: () => ipcRenderer.invoke('get-all-books'),
  getChapterCount: (moduleId, bookNumber) =>
    ipcRenderer.invoke('get-chapter-count', moduleId, bookNumber),
  getChapter: (moduleId, bookNumber, chapter) =>
    ipcRenderer.invoke('get-chapter', moduleId, bookNumber, chapter),
  searchVerses: (moduleId, query) => ipcRenderer.invoke('search-verses', moduleId, query),
  searchVersesLimited: (moduleId, query, limit) =>
    ipcRenderer.invoke('search-verses-limited', moduleId, query, limit),
  getDictionaryEntry: (moduleId, topic) =>
    ipcRenderer.invoke('get-dictionary-entry', moduleId, topic),
  lookupAllStrongDicts: (topic, allowedModuleIds) =>
    ipcRenderer.invoke('lookup-all-strong-dicts', topic, allowedModuleIds),
  searchDictionaryTopics: (moduleId, prefix, limit) =>
    ipcRenderer.invoke('search-dictionary-topics', moduleId, prefix, limit),
  getDictionaryCognates: (moduleId, strongsNumber) =>
    ipcRenderer.invoke('get-dictionary-cognates', moduleId, strongsNumber),
  getDictionaryMeta: (moduleId) => ipcRenderer.invoke('get-dictionary-meta', moduleId),
  resolveMorphology: (params) => ipcRenderer.invoke('resolve-morphology', params),
  getDictionaryTopicCount: (moduleId) => ipcRenderer.invoke('get-dictionary-topic-count', moduleId),
  getDictionaryTopicsByPrefix: (moduleId, prefix, limit, offset) =>
    ipcRenderer.invoke('get-dictionary-topics-by-prefix', moduleId, prefix, limit, offset),
  getDictionaryRandomTopics: (moduleId, limit) =>
    ipcRenderer.invoke('get-dictionary-random-topics', moduleId, limit),
  getCrossReferences: (book, chapter, allowedModuleIds) =>
    ipcRenderer.invoke('get-cross-references', book, chapter, allowedModuleIds),
  getCommentary: (moduleId, bookNumber, chapter) =>
    ipcRenderer.invoke('get-commentary', moduleId, bookNumber, chapter),
  getCommentaryBooks: (moduleId) => ipcRenderer.invoke('get-commentary-books', moduleId),
  getCommentaryCoverage: (moduleId) => ipcRenderer.invoke('get-commentary-coverage', moduleId),
  getModulePath: (moduleId) => ipcRenderer.invoke('get-module-path', moduleId),
  getEditableModuleState: (moduleId) => ipcRenderer.invoke('get-editable-module-state', moduleId),
  deleteModule: (moduleId) => ipcRenderer.invoke('delete-module', moduleId),
  saveInfoValue: (moduleId, name, value) =>
    ipcRenderer.invoke('save-info-value', moduleId, name, value),
  deleteInfoValue: (moduleId, name) => ipcRenderer.invoke('delete-info-value', moduleId, name),
  saveBookNames: (moduleId, bookNumber, fields) =>
    ipcRenderer.invoke('save-book-names', moduleId, bookNumber, fields),
  getVerseRecord: (moduleId, bookNumber, chapter, verse) =>
    ipcRenderer.invoke('get-verse-record', moduleId, bookNumber, chapter, verse),
  saveVerseText: (moduleId, bookNumber, chapter, verse, text) =>
    ipcRenderer.invoke('save-verse-text', moduleId, bookNumber, chapter, verse, text),
  getCommentaryEntry: (moduleId, bookNumber, chapter, verseFrom) =>
    ipcRenderer.invoke('get-commentary-entry', moduleId, bookNumber, chapter, verseFrom),
  saveCommentaryText: (moduleId, bookNumber, chapter, verseFrom, text) =>
    ipcRenderer.invoke('save-commentary-text', moduleId, bookNumber, chapter, verseFrom, text),
  getAppState: () => ipcRenderer.invoke('get-app-state'),
  saveAppState: (state) => ipcRenderer.invoke('save-app-state', state),
  onOpenSettings: (callback) => setSingleListener('open-settings', callback),
  onSplitH: (callback) => setSingleListener('split-h', callback),
  onSplitV: (callback) => setSingleListener('split-v', callback),
  onSplitHCommentary: (callback) => setSingleListener('split-h-commentary', callback),
  onSplitVCommentary: (callback) => setSingleListener('split-v-commentary', callback),
  showVerseContextMenu: (opts) => ipcRenderer.send('show-verse-context-menu', opts),
  onContextMenuCopy: (callback) => setSingleListener('context-menu-copy', callback),
  showStrongsContextMenu: (opts) => ipcRenderer.send('show-strongs-context-menu', opts),
  onStrongsSearch: (callback) => setSingleListener('strongs-search', callback),
  onStrongsLookup: (callback) => setSingleListener('strongs-lookup', callback),
  onOpenAbout: (callback) => setSingleListener('open-about', callback),
  onOpenModuleEditor: (callback) => setSingleListener('open-module-editor', callback),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  onUpdateAvailable: (callback) => setSingleListener('update-available', callback),
  getPendingUpdate: () => ipcRenderer.invoke('get-pending-update'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  installModules: () => ipcRenderer.send('install-modules'),
  onOpenConvertModules: (callback) => setSingleListener('open-convert-modules', callback),
  selectConvertFiles: () => ipcRenderer.invoke('select-convert-files'),
  selectConvertFolder: () => ipcRenderer.invoke('select-convert-folder'),
  convertSingleFile: (filePath) => ipcRenderer.invoke('convert-single-file', filePath),
  finishConvert: (convertedFiles, mode) =>
    ipcRenderer.invoke('finish-convert', convertedFiles, mode),
  cleanupConvert: () => ipcRenderer.invoke('cleanup-convert'),
};

contextBridge.exposeInMainWorld('api', api);

export { api, setSingleListener };

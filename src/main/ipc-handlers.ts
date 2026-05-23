import type { IpcMainInvokeEvent } from 'electron';

import { ipcMain } from 'electron';
import * as modules from './modules.ts';
import * as stateStore from './state-store.ts';

function registerIpcHandlers(): void {
  ipcMain.handle('get-modules', () => modules.getModules());

  ipcMain.handle('get-books', (_event: IpcMainInvokeEvent, moduleId: string) =>
    modules.getBooks(moduleId)
  );

  ipcMain.handle('get-all-books', () => modules.getAllBooks());

  ipcMain.handle('get-chapter-count', (_event: IpcMainInvokeEvent, moduleId: string, bookNumber: number) =>
    modules.getChapterCount(moduleId, bookNumber)
  );

  ipcMain.handle('get-chapter', (_event: IpcMainInvokeEvent, moduleId: string, bookNumber: number, chapter: number) =>
    modules.getChapter(moduleId, bookNumber, chapter)
  );

  ipcMain.handle('search-verses', (_event: IpcMainInvokeEvent, moduleId: string, query: string) =>
    modules.searchVerses(moduleId, query)
  );

  ipcMain.handle('search-verses-limited', (_event: IpcMainInvokeEvent, moduleId: string, query: string, limit: number) =>
    modules.searchVerses(moduleId, query, { limit: Number(limit) || 20 })
  );

  ipcMain.handle('get-dictionary-entry', (_event: IpcMainInvokeEvent, moduleId: string, topic: string) =>
    modules.getDictionaryEntry(moduleId, topic)
  );

  ipcMain.handle('lookup-all-strong-dicts', (_event: IpcMainInvokeEvent, topic: string, allowedModuleIds?: string[]) =>
    modules.lookupAllStrongDicts(topic, allowedModuleIds)
  );

  ipcMain.handle('search-dictionary-topics', (_event: IpcMainInvokeEvent, moduleId: string, prefix: string, limit: number) =>
    modules.searchDictionaryTopics(moduleId, prefix, limit)
  );

  ipcMain.handle('get-dictionary-cognates', (_event: IpcMainInvokeEvent, moduleId: string, strongsNumber: string) =>
    modules.getDictionaryCognates(moduleId, strongsNumber)
  );

  ipcMain.handle('get-dictionary-meta', (_event: IpcMainInvokeEvent, moduleId: string) =>
    modules.getDictionaryMeta(moduleId)
  );

  ipcMain.handle('resolve-morphology', (_event: IpcMainInvokeEvent, params: MorphologyRequest) =>
    modules.resolveMorphology(params)
  );

  ipcMain.handle('get-dictionary-topic-count', (_event: IpcMainInvokeEvent, moduleId: string) =>
    modules.getDictionaryTopicCount(moduleId)
  );

  ipcMain.handle('get-dictionary-topics-by-prefix', (_event: IpcMainInvokeEvent, moduleId: string, prefix: string, limit: number, offset: number) =>
    modules.getDictionaryTopicsByPrefix(moduleId, prefix, limit, offset)
  );

  ipcMain.handle('get-dictionary-random-topics', (_event: IpcMainInvokeEvent, moduleId: string, limit: number) =>
    modules.getDictionaryRandomTopics(moduleId, limit)
  );

  ipcMain.handle('get-cross-references', (_event: IpcMainInvokeEvent, book: number, chapter: number, allowedModuleIds?: string[]) =>
    modules.lookupAllCrossRefModules(book, chapter, allowedModuleIds)
  );

  ipcMain.handle('get-commentary', (_event: IpcMainInvokeEvent, moduleId: string, bookNumber: number, chapter: number) =>
    modules.getCommentary(moduleId, bookNumber, chapter)
  );

  ipcMain.handle('get-commentary-books', (_event: IpcMainInvokeEvent, moduleId: string) =>
    modules.getCommentaryBooks(moduleId)
  );

  ipcMain.handle('get-commentary-coverage', (_event: IpcMainInvokeEvent, moduleId: string) =>
    modules.getCommentaryCoverage(moduleId)
  );

  ipcMain.handle('get-module-path', (_event: IpcMainInvokeEvent, moduleId: string) =>
    modules.getModulePath(moduleId)
  );
  ipcMain.handle('get-editable-module-state', (_event: IpcMainInvokeEvent, moduleId: string) =>
    modules.getEditableModuleState(moduleId)
  );
  ipcMain.handle('delete-module', (_event: IpcMainInvokeEvent, moduleId: string) =>
    modules.deleteModule(moduleId)
  );
  ipcMain.handle('save-info-value', (_event: IpcMainInvokeEvent, moduleId: string, name: string, value: string) =>
    modules.saveInfoValue(moduleId, name, value)
  );
  ipcMain.handle('delete-info-value', (_event: IpcMainInvokeEvent, moduleId: string, name: string) =>
    modules.deleteInfoValue(moduleId, name)
  );
  ipcMain.handle('save-book-names', (_event: IpcMainInvokeEvent, moduleId: string, bookNumber: number, fields: BookNameFields) =>
    modules.saveBookNames(moduleId, bookNumber, fields)
  );
  ipcMain.handle('get-verse-record', (_event: IpcMainInvokeEvent, moduleId: string, bookNumber: number, chapter: number, verse: number) =>
    modules.getVerseRecord(moduleId, bookNumber, chapter, verse)
  );
  ipcMain.handle('save-verse-text', (_event: IpcMainInvokeEvent, moduleId: string, bookNumber: number, chapter: number, verse: number, text: string) =>
    modules.saveVerseText(moduleId, bookNumber, chapter, verse, text)
  );
  ipcMain.handle('get-commentary-entry', (_event: IpcMainInvokeEvent, moduleId: string, bookNumber: number, chapter: number, verseFrom: number) =>
    modules.getCommentaryEntry(moduleId, bookNumber, chapter, verseFrom)
  );
  ipcMain.handle('save-commentary-text', (_event: IpcMainInvokeEvent, moduleId: string, bookNumber: number, chapter: number, verseFrom: number, text: string) =>
    modules.saveCommentaryText(moduleId, bookNumber, chapter, verseFrom, text)
  );

  ipcMain.handle('get-app-state', () => stateStore.loadState());

  ipcMain.handle('save-app-state', (_event: IpcMainInvokeEvent, state: AppPersistedState) =>
    stateStore.saveState(state)
  );
}

export { registerIpcHandlers };

if (typeof module !== 'undefined') module.exports = { registerIpcHandlers };

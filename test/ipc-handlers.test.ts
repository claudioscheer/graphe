import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';

type IpcArg = string | number | boolean | null | object;
type IpcResult = IpcArg | IpcArg[] | Promise<IpcArg | IpcArg[]>;
type IpcHandler = (event: IpcMainInvokeEvent, ...args: IpcArg[]) => IpcResult;

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, IpcHandler>();
  const handle = vi.fn((channel: string, handler: IpcHandler) => {
    handlers.set(channel, handler);
  });
  return { handlers, handle };
});

const moduleMocks = vi.hoisted(() => ({
  getModules: vi.fn(() => [{ id: 'kjv', type: 'bible', displayName: 'KJV' }]),
  getBooks: vi.fn(() => [{ bookNumber: 10, shortName: 'Gen' }]),
  getAllBooks: vi.fn(() => [{ bookNumber: 10, shortName: 'Gen' }]),
  getChapterCount: vi.fn(() => 31),
  getChapter: vi.fn(() => [{ verse: 1, text: 'text' }]),
  searchVerses: vi.fn(() => [{ verse: 1, text: 'text' }]),
  getDictionaryEntry: vi.fn(() => ({ topic: 'G3056', definition: 'word' })),
  lookupAllStrongDicts: vi.fn(() => [{ topic: 'G3056', definition: 'word' }]),
  searchDictionaryTopics: vi.fn(() => ['G3056']),
  getDictionaryCognates: vi.fn(() => ['G3056']),
  getDictionaryMeta: vi.fn(() => ({ title: 'Strong' })),
  resolveMorphology: vi.fn(() => ({ displayText: 'Noun', topicRef: null })),
  getDictionaryTopicCount: vi.fn(() => 1),
  getDictionaryTopicsByPrefix: vi.fn(() => ['G3056']),
  getDictionaryRandomTopics: vi.fn(() => ['G3056']),
  lookupAllCrossRefModules: vi.fn(() => [{ book: 10, chapter: 1, verse: 1 }]),
  getCommentary: vi.fn(() => [{ text: 'comment' }]),
  getCommentaryBooks: vi.fn(() => [10]),
  getCommentaryCoverage: vi.fn(() => ({ 10: [1] })),
  getModulePath: vi.fn(() => '/tmp/kjv.sqlite3'),
  getEditableModuleState: vi.fn(() => ({ moduleId: 'kjv', modulePath: '/tmp/kjv.sqlite3' })),
  deleteModule: vi.fn(() => true),
  saveInfoValue: vi.fn(() => true),
  deleteInfoValue: vi.fn(() => true),
  saveBookNames: vi.fn(() => true),
  getVerseRecord: vi.fn(() => ({ verse: 1, text: 'text' })),
  saveVerseText: vi.fn(() => true),
  getCommentaryEntry: vi.fn(() => ({ text: 'comment' })),
  saveCommentaryText: vi.fn(() => true),
}));

const stateStoreMocks = vi.hoisted(() => ({
  loadState: vi.fn(() => ({ settings: { language: 'en' } })),
  saveState: vi.fn((state: AppPersistedState) => Promise.resolve(state)),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: electronMock.handle,
  },
}));

vi.mock('../src/main/modules.ts', () => moduleMocks);
vi.mock('../src/main/state-store.ts', () => stateStoreMocks);

describe('IPC handler registration', () => {
  beforeEach(() => {
    vi.resetModules();
    electronMock.handlers.clear();
    electronMock.handle.mockClear();
    for (const mock of Object.values(moduleMocks)) mock.mockClear();
    stateStoreMocks.loadState.mockClear();
    stateStoreMocks.saveState.mockClear();
  });

  it('registers handlers and delegates to modules/state services', async () => {
    const { registerIpcHandlers } = await import('../src/main/ipc-handlers.ts');
    const event = {} as IpcMainInvokeEvent;
    const call = (channel: string, ...args: IpcArg[]): IpcResult => {
      const handler = electronMock.handlers.get(channel);
      if (!handler) throw new Error(`Missing handler: ${channel}`);
      return handler(event, ...args);
    };
    registerIpcHandlers();

    expect(electronMock.handle).toHaveBeenCalledTimes(32);
    expect(call('get-modules')).toEqual([{ id: 'kjv', type: 'bible', displayName: 'KJV' }]);
    expect(call('get-books', 'kjv')).toEqual([{ bookNumber: 10, shortName: 'Gen' }]);
    expect(call('get-all-books')).toEqual([{ bookNumber: 10, shortName: 'Gen' }]);
    expect(call('get-chapter-count', 'kjv', 10)).toBe(31);
    expect(call('get-chapter', 'kjv', 10, 1)).toEqual([{ verse: 1, text: 'text' }]);
    expect(call('search-verses', 'kjv', 'faith')).toEqual([{ verse: 1, text: 'text' }]);
    expect(call('search-verses-limited', 'kjv', 'faith', 0)).toEqual([{ verse: 1, text: 'text' }]);
    expect(moduleMocks.searchVerses).toHaveBeenLastCalledWith('kjv', 'faith', { limit: 20 });
    expect(call('get-dictionary-entry', 'strong', 'G3056')).toEqual({
      topic: 'G3056',
      definition: 'word',
    });
    expect(call('lookup-all-strong-dicts', 'G3056', ['strong'])).toEqual([
      { topic: 'G3056', definition: 'word' },
    ]);
    expect(call('search-dictionary-topics', 'strong', 'G', 10)).toEqual(['G3056']);
    expect(call('get-dictionary-cognates', 'strong', 'G3056')).toEqual(['G3056']);
    expect(call('get-dictionary-meta', 'strong')).toEqual({ title: 'Strong' });
    expect(call('resolve-morphology', { morphCode: 'N-NSF' })).toEqual({
      displayText: 'Noun',
      topicRef: null,
    });
    expect(call('get-dictionary-topic-count', 'strong')).toBe(1);
    expect(call('get-dictionary-topics-by-prefix', 'strong', 'G', 10, 0)).toEqual(['G3056']);
    expect(call('get-dictionary-random-topics', 'strong', 1)).toEqual(['G3056']);
    expect(call('get-cross-references', 10, 1, ['cross'])).toEqual([
      { book: 10, chapter: 1, verse: 1 },
    ]);
    expect(call('get-commentary', 'comm', 10, 1)).toEqual([{ text: 'comment' }]);
    expect(call('get-commentary-books', 'comm')).toEqual([10]);
    expect(call('get-commentary-coverage', 'comm')).toEqual({ 10: [1] });
    expect(call('get-module-path', 'kjv')).toBe('/tmp/kjv.sqlite3');
    expect(call('get-editable-module-state', 'kjv')).toEqual({
      moduleId: 'kjv',
      modulePath: '/tmp/kjv.sqlite3',
    });
    expect(call('delete-module', 'kjv')).toBe(true);
    expect(call('save-info-value', 'kjv', 'name', 'value')).toBe(true);
    expect(call('delete-info-value', 'kjv', 'name')).toBe(true);
    expect(call('save-book-names', 'kjv', 10, { shortName: 'Gen' })).toBe(true);
    expect(call('get-verse-record', 'kjv', 10, 1, 1)).toEqual({ verse: 1, text: 'text' });
    expect(call('save-verse-text', 'kjv', 10, 1, 1, 'text')).toBe(true);
    expect(call('get-commentary-entry', 'comm', 10, 1, 1)).toEqual({ text: 'comment' });
    expect(call('save-commentary-text', 'comm', 10, 1, 1, 'text')).toBe(true);
    expect(call('get-app-state')).toEqual({ settings: { language: 'en' } });
    await expect(call('save-app-state', { settings: { language: 'pt' } })).resolves.toEqual({
      settings: { language: 'pt' },
    });

    expect(stateStoreMocks.saveState).toHaveBeenCalledWith({ settings: { language: 'pt' } });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MockDb {
  filePath: string;
  opts?: { readonly?: boolean };
  closed: boolean;
  close: ReturnType<typeof vi.fn>;
}

type ModuleExports = typeof import('../src/main/modules.ts');

const fsMock = vi.hoisted(() => {
  const state = {
    files: [] as string[],
    invalidOpen: new Set<string>(),
    unlinked: [] as string[],
    copied: [] as Array<{ src: string; dest: string }>,
  };
  const mkdirSync = vi.fn();
  const readdirSync = vi.fn(() => state.files);
  const unlinkSync = vi.fn((filePath: string) => {
    state.unlinked.push(filePath);
  });
  const copyFileSync = vi.fn((src: string, dest: string) => {
    state.copied.push({ src, dest });
  });
  return { state, mkdirSync, readdirSync, unlinkSync, copyFileSync };
});

const dbMock = vi.hoisted(() => {
  const instances: MockDb[] = [];
  const Database = vi.fn(function Database(filePath: string, opts?: { readonly?: boolean }) {
    if (filePath.includes('broken')) throw new Error('cannot open');
    const db: MockDb = {
      filePath,
      opts,
      closed: false,
      close: vi.fn(() => {
        db.closed = true;
      }),
    };
    instances.push(db);
    return db;
  });
  return { Database, instances };
});

const providerMock = vi.hoisted(() => {
  const infoById: Record<string, Record<string, string>> = {
    alpha: {
      'short.title': 'Shared',
      description: 'Alpha Bible',
      strong_numbers: 'true',
      strong_numbers_prefix: 'G',
    },
    beta: {
      short_title: 'Shared',
      description: 'Beta Bible',
    },
    dict: {
      description: 'Lexicon',
      is_strong: 'true',
      language: 'en',
    },
    cross: {
      description: 'Crossrefs',
    },
    comment: {
      description: 'Notes',
    },
    unsupported: {
      description: 'Unsupported',
    },
  };
  const typeById: Record<string, ModuleType | 'crossreference' | 'other'> = {
    alpha: 'bible',
    beta: 'bible',
    dict: 'dictionary',
    cross: 'crossreference',
    comment: 'commentary',
    unsupported: 'other',
  };
  const idFromDb = (db: MockDb) => db.filePath.split('/').pop()?.replace(/\.sqlite3$/i, '') || '';
  const getInfo = vi.fn((db: MockDb) => ({ ...(infoById[idFromDb(db)] || {}) }));
  const getMorphologyTableInfo = vi.fn((db: MockDb) => ({ id: idFromDb(db) }));
  const detectType = vi.fn((db: MockDb) => typeById[idFromDb(db)] || 'bible');
  const getBooks = vi.fn((db: MockDb) => {
    const id = idFromDb(db);
    if (id === 'beta') throw new Error('bad books');
    return [{ bookNumber: id === 'dict' ? 20 : 10, shortName: id || 'Gen' }];
  });
  const getChapterCount = vi.fn(() => 31);
  const getChapter = vi.fn(() => [{ verse: 1, text: 'text' }]);
  const lexicalSearch = vi.fn(() => [{ moduleId: 'alpha', bookNumber: 10, chapter: 1, verse: 1 }]);
  const getDictColumns = vi.fn(() => ['topic', 'definition']);
  const getDictionaryEntry = vi.fn((_db: MockDb, _columns: string[], topic: string) =>
    topic === 'missing' ? null : { topic, definition: 'definition' }
  );
  const hasDictionaryTable = vi.fn((db: MockDb) => idFromDb(db) === 'dict');
  const searchDictionaryTopics = vi.fn(() => ['G3056']);
  const getDictionaryCognates = vi.fn(() => [{ topic: 'G3056' }]);
  const getDictionaryTopicCount = vi.fn(() => 7);
  const getDictionaryTopicsByPrefix = vi.fn(() => ['G1', 'G2']);
  const getDictionaryRandomTopics = vi.fn(() => ['G3']);
  const getCrossReferences = vi.fn((_db: MockDb, _book: number, _chapter: number) => [
    { verse: 1, votes: 5 },
    { verse: 1, votes: 1 },
    { verse: 2, votes: 1 },
  ]);
  const getReverseCrossReferences = vi.fn(() => [{ verse: 3, votes: 2 }]);
  const hasCrossRefTable = vi.fn((db: MockDb) => idFromDb(db) === 'cross');
  const getCommentary = vi.fn(() => [{ text: 'comment' }]);
  const getCommentaryBooks = vi.fn(() => [10]);
  const getCommentaryCoverage = vi.fn(() => ({ 10: [1, 2] }));
  const getEditableTableAvailability = vi.fn(() => ({ bible: true }));
  const getInfoRows = vi.fn(() => [{ name: 'description', value: 'Alpha Bible' }]);
  const getEditableBooks = vi.fn(() => [{ bookNumber: 10, shortName: 'Gen' }]);
  const upsertInfoValue = vi.fn(() => ({ updated: true, inserted: false }));
  const deleteInfoKey = vi.fn(() => true);
  const updateBookNames = vi.fn(() => true);
  const getVerseRecord = vi.fn(() => ({ verse: 1, text: 'text' }));
  const updateVerseText = vi.fn(() => true);
  const getCommentaryEntry = vi.fn(() => ({ verseFrom: 1, text: 'comment' }));
  const updateCommentaryText = vi.fn(() => true);
  const isValidModule = vi.fn((filePath: string) => filePath.endsWith('.sqlite3'));

  return {
    infoById,
    typeById,
    idFromDb,
    getInfo,
    getMorphologyTableInfo,
    detectType,
    getBooks,
    getChapterCount,
    getChapter,
    lexicalSearch,
    getDictColumns,
    getDictionaryEntry,
    hasDictionaryTable,
    searchDictionaryTopics,
    getDictionaryCognates,
    getDictionaryTopicCount,
    getDictionaryTopicsByPrefix,
    getDictionaryRandomTopics,
    getCrossReferences,
    getReverseCrossReferences,
    hasCrossRefTable,
    getCommentary,
    getCommentaryBooks,
    getCommentaryCoverage,
    getEditableTableAvailability,
    getInfoRows,
    getEditableBooks,
    upsertInfoValue,
    deleteInfoKey,
    updateBookNames,
    getVerseRecord,
    updateVerseText,
    getCommentaryEntry,
    updateCommentaryText,
    isValidModule,
  };
});

const morphologyMock = vi.hoisted(() => ({
  resolveMorphology: vi.fn(() => ({ displayText: 'noun', topicRef: null })),
}));

vi.mock('os', () => ({
  default: { homedir: () => '/home/tester' },
  homedir: () => '/home/tester',
}));

vi.mock('fs', () => ({
  default: {
    mkdirSync: fsMock.mkdirSync,
    readdirSync: fsMock.readdirSync,
    unlinkSync: fsMock.unlinkSync,
    copyFileSync: fsMock.copyFileSync,
  },
  mkdirSync: fsMock.mkdirSync,
  readdirSync: fsMock.readdirSync,
  unlinkSync: fsMock.unlinkSync,
  copyFileSync: fsMock.copyFileSync,
}));

vi.mock('better-sqlite3', () => ({
  default: dbMock.Database,
}));

vi.mock('../src/main/modules/sqlite-provider.ts', () => providerMock);
vi.mock('../src/main/modules/morphology-resolver.ts', () => morphologyMock);

async function loadModules(files = ['alpha.sqlite3', 'beta.SQLITE3', 'ignore.txt']): Promise<ModuleExports> {
  vi.resetModules();
  fsMock.state.files = [...files];
  fsMock.state.unlinked = [];
  fsMock.state.copied = [];
  dbMock.instances.length = 0;
  for (const mock of [
    fsMock.mkdirSync,
    fsMock.readdirSync,
    fsMock.unlinkSync,
    fsMock.copyFileSync,
    dbMock.Database,
    ...Object.values(providerMock).filter(
      (value) => typeof value === 'function' && 'mockClear' in value
    ),
    morphologyMock.resolveMorphology,
  ] as Array<ReturnType<typeof vi.fn>>) {
    mock.mockClear();
  }
  return import('../src/main/modules.ts');
}

describe('main module registry', () => {
  beforeEach(() => {
    providerMock.typeById.alpha = 'bible';
    providerMock.typeById.beta = 'bible';
    providerMock.typeById.dict = 'dictionary';
  });

  it('loads sqlite modules, skips unsupported extensions, closes handles on reload, and reports duplicate labels', async () => {
    const modules = await loadModules([
      'alpha.sqlite3',
      'beta.SQLITE3',
      'dict.sqlite3',
      'unsupported.sqlite3',
      'broken.sqlite3',
      'notes.txt',
    ]);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    modules.init();

    expect(fsMock.mkdirSync).toHaveBeenCalledWith('/home/tester/.graphe/modules', {
      recursive: true,
    });
    expect(dbMock.Database).toHaveBeenCalledWith('/home/tester/.graphe/modules/alpha.sqlite3', {
      readonly: true,
    });
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to open module broken.sqlite3:',
      'cannot open'
    );

    expect(modules.getModules()).toEqual([
      expect.objectContaining({
        id: 'dict',
        type: 'dictionary',
        displayName: 'Lexicon',
        isStrongDict: true,
        language: 'en',
        listLabel: 'Lexicon',
      }),
      expect.objectContaining({
        id: 'alpha',
        type: 'bible',
        displayName: 'Shared',
        shortTitle: 'Shared',
        description: 'Alpha Bible',
        hasStrongs: true,
        strongsPrefix: 'G',
        listLabel: 'Shared (alpha)',
      }),
      expect.objectContaining({
        id: 'beta',
        type: 'bible',
        displayName: 'Shared',
        listLabel: 'Shared (beta)',
      }),
    ]);

    const firstAlphaDb = dbMock.instances.find((db) => db.filePath.endsWith('alpha.sqlite3'));
    modules.reload();
    expect(firstAlphaDb?.close).toHaveBeenCalled();
    expect(providerMock.getMorphologyTableInfo).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('delegates read APIs, caches dictionary columns, and handles missing/invalid modules', async () => {
    const modules = await loadModules(['alpha.sqlite3', 'dict.sqlite3', 'cross.sqlite3', 'comment.sqlite3']);
    modules.init();

    expect(modules.getBooks('alpha')).toEqual([{ bookNumber: 10, shortName: 'alpha' }]);
    expect(modules.getAllBooks()).toEqual([
      { bookNumber: 10, shortName: 'alpha' },
      { bookNumber: 20, shortName: 'dict' },
    ]);
    expect(modules.getChapterCount('alpha', 10)).toBe(31);
    expect(modules.getChapter('alpha', 10, 1)).toEqual([{ verse: 1, text: 'text' }]);
    expect(modules.searchVerses('alpha', 'faith', { limit: 2 })).toEqual([
      { moduleId: 'alpha', bookNumber: 10, chapter: 1, verse: 1 },
    ]);

    expect(modules.getDictionaryEntry('dict', 'G3056')).toEqual({
      topic: 'G3056',
      definition: 'definition',
    });
    expect(modules.getDictionaryEntry('dict', 'missing')).toBeNull();
    expect(providerMock.getDictColumns).toHaveBeenCalledTimes(1);
    expect(modules.lookupAllStrongDicts('G3056')).toEqual([]);
    expect(modules.lookupAllStrongDicts('G3056', ['missing', 'alpha', 'dict'])).toEqual([
      {
        moduleId: 'dict',
        entry: { topic: 'G3056', definition: 'definition' },
      },
    ]);
    expect(modules.searchDictionaryTopics('dict', 'G', 10)).toEqual(['G3056']);
    expect(modules.getDictionaryCognates('dict', 'G3056')).toEqual([{ topic: 'G3056' }]);
    expect(modules.getDictionaryMeta('dict')).toEqual(
      expect.objectContaining({
        id: 'dict',
        type: 'dictionary',
        displayName: 'Lexicon',
        shortTitle: null,
        description: 'Lexicon',
        language: 'en',
        isStrongDict: true,
      })
    );
    expect(() => modules.getDictionaryMeta('alpha')).toThrow('Module is not a dictionary: alpha');
    expect(modules.getDictionaryTopicCount('dict')).toBe(7);
    expect(modules.getDictionaryTopicsByPrefix('dict', 'G', 2, 1)).toEqual(['G1', 'G2']);
    expect(modules.getDictionaryRandomTopics('dict', 1)).toEqual(['G3']);

    expect(modules.resolveMorphology({ sourceModuleId: 'alpha', strongDictModuleId: 'dict' })).toEqual({
      displayText: 'noun',
      topicRef: null,
    });
    expect(morphologyMock.resolveMorphology).toHaveBeenCalledWith(
      expect.objectContaining({
        bibleHandle: expect.objectContaining({ filePath: expect.stringContaining('alpha.sqlite3') }),
        dictHandle: expect.objectContaining({ filePath: expect.stringContaining('dict.sqlite3') }),
      })
    );
    providerMock.typeById.alpha = 'dictionary';
    expect(() => modules.resolveMorphology({ sourceModuleId: 'alpha' })).toThrow(
      'Module is not a Bible: alpha'
    );
    providerMock.typeById.alpha = 'bible';
    providerMock.typeById.dict = 'bible';
    expect(() => modules.resolveMorphology({ strongDictModuleId: 'dict' })).toThrow(
      'Module is not a dictionary: dict'
    );
    providerMock.typeById.dict = 'dictionary';

    expect(modules.getCrossReferences('cross', 10, 1)).toEqual([
      { verse: 1, votes: 5 },
      { verse: 1, votes: 1 },
      { verse: 2, votes: 1 },
    ]);
    expect(modules.lookupAllCrossRefModules(10, 1)).toEqual([]);
    expect(modules.lookupAllCrossRefModules(10, 1, ['alpha', 'cross'])).toEqual([
      { verse: 1, votes: 5 },
      { verse: 1, votes: 1 },
      { verse: 2, votes: 1 },
    ]);
    expect(modules.lookupAllReverseCrossRefs(10, 1, 1)).toEqual([]);
    expect(modules.lookupAllReverseCrossRefs(10, 1, 1, ['cross'])).toEqual([{ verse: 3, votes: 2 }]);
    expect(modules.getCommentary('comment', 10, 1)).toEqual([{ text: 'comment' }]);
    expect(modules.getCommentaryBooks('comment')).toEqual([10]);
    expect(modules.getCommentaryCoverage('comment')).toEqual({ 10: [1, 2] });
    expect(modules.getModulePath('alpha')).toBe('/home/tester/.graphe/modules/alpha.sqlite3');
    expect(modules.getEditableModuleState('alpha')).toEqual({
      moduleId: 'alpha',
      modulePath: '/home/tester/.graphe/modules/alpha.sqlite3',
      type: 'bible',
      info: providerMock.infoById.alpha,
      tables: { bible: true },
      infoRows: [{ name: 'description', value: 'Alpha Bible' }],
      books: [{ bookNumber: 10, shortName: 'Gen' }],
    });
    expect(() => modules.getBooks('missing')).toThrow('Module not found: missing');
  });

  it('opens writable handles for edits, reloads after mutations, deletes modules, and installs valid files', async () => {
    const modules = await loadModules(['alpha.sqlite3', 'comment.sqlite3']);
    modules.init();

    expect(modules.saveInfoValue('alpha', 'description', 'Updated')).toBe(true);
    expect(modules.deleteInfoValue('alpha', 'obsolete')).toBe(true);
    expect(modules.saveBookNames('alpha', 10, null)).toBe(true);
    expect(modules.getVerseRecord('alpha', 10, 1, 1)).toEqual({ verse: 1, text: 'text' });
    expect(modules.saveVerseText('alpha', 10, 1, 1, 'updated')).toBe(true);
    expect(modules.getCommentaryEntry('comment', 10, 1, 1)).toEqual({
      verseFrom: 1,
      text: 'comment',
    });
    expect(modules.saveCommentaryText('comment', 10, 1, 1, 'updated')).toBe(true);
    expect(providerMock.updateBookNames).toHaveBeenCalledWith(
      expect.objectContaining({ opts: undefined }),
      10,
      {}
    );
    expect(dbMock.instances.some((db) => db.opts === undefined && db.closed)).toBe(true);

    const deleted = modules.deleteModule('alpha');
    expect(deleted).toEqual({ deleted: true, moduleId: 'alpha' });
    expect(fsMock.unlinkSync).toHaveBeenCalledWith('/home/tester/.graphe/modules/alpha.sqlite3');

    const installed = modules.installFiles(['/tmp/readme.txt', '/tmp/new.sqlite3']);
    expect(installed).toEqual({ copied: 1, skipped: ['readme.txt'] });
    expect(fsMock.copyFileSync).toHaveBeenCalledWith(
      '/tmp/new.sqlite3',
      '/home/tester/.graphe/modules/new.sqlite3'
    );
  });
});

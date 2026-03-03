import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const provider = require('../src/main/modules/theword-twm-provider');

const MODULES_DIR = path.join(os.homedir(), '.graphe', 'modules');

function findModule(pattern) {
  try {
    const files = fs.readdirSync(MODULES_DIR);
    const found = files.find((f) => pattern.test(f));
    return found ? path.join(MODULES_DIR, found) : null;
  } catch (_) {
    return null;
  }
}

// Find test modules
const type2File = findModule(/\.cmt\.twm$/i);
const type3File = findModule(/Adventista\.cmt\.twm$/i) || findModule(/Calvino.*\.cmt\.twm$/i);
const type1File = findModule(/\.dct\.twm$/i);
const strongPtFile = path.join(
  MODULES_DIR,
  'The Word',
  'Books',
  'Dicionário STRONG Léxico Completo.dct.twm'
);

describe('TWM type=2 (verse-indexed commentary)', () => {
  let handle;

  beforeAll(() => {
    if (!type2File) return;
    handle = provider.load(type2File);
  });

  afterAll(() => {
    if (handle) provider.close(handle);
  });

  it.skipIf(!type2File)('loads with topicBased=false', () => {
    expect(handle).toBeTruthy();
    expect(handle.format).toBe('theword-twm');
    expect(handle.topicBased).toBe(false);
    expect(handle.db).toBeDefined();
    expect(handle.config).toBeDefined();
  });

  it.skipIf(!type2File)('getModuleInfo returns commentary type', () => {
    const info = provider.getModuleInfo(handle);
    expect(info.type).toBe('commentary');
    expect(info.description).toBeTruthy();
  });

  it.skipIf(!type2File)('getCommentaryBooks returns book numbers', () => {
    const books = provider.getCommentaryBooks(handle);
    expect(books).toBeInstanceOf(Array);
    expect(books.length).toBeGreaterThan(0);
    for (const bn of books) {
      expect(typeof bn).toBe('number');
    }
  });

  it.skipIf(!type2File)('getCommentary returns entries with correct shape', async () => {
    const books = provider.getCommentaryBooks(handle);
    if (books.length === 0) return;
    const entries = await provider.getCommentary(handle, books[0], 1);
    expect(entries).toBeInstanceOf(Array);
    if (entries.length > 0) {
      const entry = entries[0];
      expect(entry).toHaveProperty('verseFrom');
      expect(entry).toHaveProperty('verseTo');
      expect(entry).toHaveProperty('chapterTo');
      expect(entry).toHaveProperty('text');
      expect(typeof entry.verseFrom).toBe('number');
      expect(typeof entry.text).toBe('string');
      expect(entry.text.length).toBeGreaterThan(0);
    }
  });
});

describe('TWM type=3 (topic-based commentary)', () => {
  let handle;

  beforeAll(() => {
    if (!type3File) return;
    handle = provider.load(type3File);
  });

  afterAll(() => {
    if (handle) provider.close(handle);
  });

  it.skipIf(!type3File)('loads with topicBased=true and topicBookMap', () => {
    expect(handle).toBeTruthy();
    expect(handle.format).toBe('theword-twm');
    expect(handle.topicBased).toBe(true);
    expect(handle.topicBookMap).toBeInstanceOf(Map);
    expect(handle.topicBookMap.size).toBeGreaterThan(0);
  });

  it.skipIf(!type3File)('getModuleInfo returns commentary type', () => {
    const info = provider.getModuleInfo(handle);
    expect(info.type).toBe('commentary');
  });

  it.skipIf(!type3File)('getCommentaryBooks returns mapped book numbers', () => {
    const books = provider.getCommentaryBooks(handle);
    expect(books).toBeInstanceOf(Array);
    expect(books.length).toBeGreaterThan(0);
    for (const bn of books) {
      expect(typeof bn).toBe('number');
    }
  });

  it.skipIf(!type3File)('getCommentary returns content with verseFrom=1', async () => {
    const books = provider.getCommentaryBooks(handle);
    if (books.length === 0) return;
    const entries = await provider.getCommentary(handle, books[0], 1);
    expect(entries).toBeInstanceOf(Array);
    if (entries.length > 0) {
      expect(entries[0].verseFrom).toBe(1);
      expect(entries[0].verseTo).toBeNull();
      expect(entries[0].chapterTo).toBeNull();
      expect(entries[0].text.length).toBeGreaterThan(0);
    }
  });
});

describe('TWM type=1 (dictionary)', () => {
  let handle;

  beforeAll(() => {
    if (!type1File) return;
    handle = provider.load(type1File);
  });

  afterAll(() => {
    if (handle) provider.close(handle);
  });

  it.skipIf(!type1File)('loads as dictionary module', () => {
    expect(handle).toBeTruthy();
    expect(handle.format).toBe('theword-twm');
    expect(handle.isDictionary).toBe(true);
  });

  it.skipIf(!type1File)('getModuleInfo returns dictionary type', () => {
    const info = provider.getModuleInfo(handle);
    expect(info.type).toBe('dictionary');
    expect(info.description).toBeTruthy();
    expect(typeof info.isStrongDict).toBe('boolean');
  });

  it.skipIf(!type1File)('hasDictionaryTable returns true', () => {
    expect(provider.hasDictionaryTable(handle)).toBe(true);
  });

  it.skipIf(!type1File)('searchDictionaryTopics returns matching topics', () => {
    // Use empty prefix to match any topic in the dictionary
    const topics = provider.searchDictionaryTopics(handle, '', 10);
    expect(topics).toBeInstanceOf(Array);
    expect(topics.length).toBeGreaterThan(0);
    for (const t of topics) {
      expect(typeof t).toBe('string');
    }
  });

  it.skipIf(!type1File)('getDictionaryEntry returns entry with definition', () => {
    const topics = provider.searchDictionaryTopics(handle, '', 1);
    if (topics.length === 0) return;
    const entry = provider.getDictionaryEntry(handle, topics[0]);
    expect(entry).toBeTruthy();
    expect(entry.topic).toBe(topics[0]);
    expect(entry.definition).toBeTruthy();
    expect(typeof entry.definition).toBe('string');
    expect(entry.definition.length).toBeGreaterThan(0);
  });

  it.skipIf(!type1File)('getDictionaryEntry returns null for missing topic', () => {
    const entry = provider.getDictionaryEntry(handle, 'NONEXISTENT_TOPIC_XYZ');
    expect(entry).toBeNull();
  });

  it.skipIf(!fs.existsSync(strongPtFile))('decodes compressed content_search blobs for Strong topics', () => {
    const strongHandle = provider.load(strongPtFile);
    try {
      expect(strongHandle).toBeTruthy();
      const entry = provider.getDictionaryEntry(strongHandle, 'G3588');
      expect(entry).toBeTruthy();
      expect(entry.topic).toBe('G3588');
      expect(entry.definition).toContain('artigo definido');
      expect(entry.definition).toContain('<p>');
    } finally {
      if (strongHandle) provider.close(strongHandle);
    }
  });
});

describe('isValidFile', () => {
  it.skipIf(!type2File)('accepts type=2 .twm files', () => {
    expect(provider.isValidFile(type2File)).toBe(true);
  });

  it.skipIf(!type3File)('accepts type=3 .twm files', () => {
    expect(provider.isValidFile(type3File)).toBe(true);
  });

  it.skipIf(!type1File)('accepts type=1 .twm files', () => {
    expect(provider.isValidFile(type1File)).toBe(true);
  });

  it('rejects non-existent files', () => {
    expect(provider.isValidFile('/nonexistent/file.twm')).toBe(false);
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const provider = require('../src/main/modules/sqlite-provider');

const SQLITE_DIR = path.join(os.homedir(), '.graphe', 'modules', 'SQLite3');

function findSqliteFile(pattern) {
  try {
    const files = fs.readdirSync(SQLITE_DIR);
    const found = files.find((f) => pattern.test(f));
    return found ? path.join(SQLITE_DIR, found) : null;
  } catch (_) {
    return null;
  }
}

const commentaryFile = findSqliteFile(/\.commentaries\.SQLite3$/i);
const dictionaryFile = findSqliteFile(/\.dictionary\.SQLite3$/i);
const bibleFile = findSqliteFile(/^(?!.*(?:commentaries|dictionary)).*\.SQLite3$/i);

describe('SQLite commentary', () => {
  let db;

  beforeAll(() => {
    if (!commentaryFile) return;
    db = new Database(commentaryFile, { readonly: true });
  });

  afterAll(() => {
    if (db) db.close();
  });

  it.skipIf(!commentaryFile)('getCommentary returns entries with correct shape', () => {
    const books = provider.getCommentaryBooks(db);
    expect(books.length).toBeGreaterThan(0);

    const entries = provider.getCommentary(db, books[0], 1);
    expect(entries).toBeInstanceOf(Array);
    if (entries.length > 0) {
      const entry = entries[0];
      expect(entry).toHaveProperty('verseFrom');
      expect(entry).toHaveProperty('verseTo');
      expect(entry).toHaveProperty('chapterTo');
      expect(entry).toHaveProperty('text');
      expect(typeof entry.text).toBe('string');
    }
  });

  it.skipIf(!commentaryFile)('getCommentaryBooks returns array of numbers', () => {
    const books = provider.getCommentaryBooks(db);
    expect(books).toBeInstanceOf(Array);
    for (const bn of books) {
      expect(typeof bn).toBe('number');
    }
  });
});

describe('SQLite dictionary', () => {
  let db;

  beforeAll(() => {
    if (!dictionaryFile) return;
    db = new Database(dictionaryFile, { readonly: true });
  });

  afterAll(() => {
    if (db) db.close();
  });

  it.skipIf(!dictionaryFile)('hasDictionaryTable returns true', () => {
    expect(provider.hasDictionaryTable(db)).toBe(true);
  });

  it.skipIf(!dictionaryFile)('getDictionaryEntry returns entry with topic', () => {
    const cols = provider.getDictColumns(db);
    const topics = provider.searchDictionaryTopics(db, '', 1);
    if (topics.length === 0) return;

    const entry = provider.getDictionaryEntry(db, cols, topics[0]);
    expect(entry).toBeTruthy();
    expect(entry).toHaveProperty('topic');
    expect(entry.topic).toBe(topics[0]);
  });

  it.skipIf(!dictionaryFile)('searchDictionaryTopics returns matching strings', () => {
    const topics = provider.searchDictionaryTopics(db, 'A', 10);
    expect(topics).toBeInstanceOf(Array);
    for (const t of topics) {
      expect(typeof t).toBe('string');
    }
  });

  it.skipIf(!dictionaryFile)('getDictionaryEntry returns null for missing topic', () => {
    const cols = provider.getDictColumns(db);
    const entry = provider.getDictionaryEntry(db, cols, 'NONEXISTENT_TOPIC_XYZ_999');
    expect(entry).toBeNull();
  });
});

describe('SQLite bible', () => {
  let db;

  beforeAll(() => {
    if (!bibleFile) return;
    db = new Database(bibleFile, { readonly: true });
  });

  afterAll(() => {
    if (db) db.close();
  });

  it.skipIf(!bibleFile)('getChapter returns verses with {verse, text}', () => {
    const books = provider.getBooks(db);
    expect(books.length).toBeGreaterThan(0);

    const firstBook = books[0].bookNumber;
    const verses = provider.getChapter(db, firstBook, 1);
    expect(verses.length).toBeGreaterThan(0);
    expect(verses[0]).toHaveProperty('verse');
    expect(verses[0]).toHaveProperty('text');
    expect(typeof verses[0].text).toBe('string');
  });

  it.skipIf(!bibleFile)('getBooks returns array with bookNumber, shortName, longName', () => {
    const books = provider.getBooks(db);
    expect(books.length).toBeGreaterThan(0);
    expect(books[0]).toHaveProperty('bookNumber');
    expect(books[0]).toHaveProperty('shortName');
    expect(books[0]).toHaveProperty('longName');
  });
});

describe('parseSearchQuery', () => {
  it('parses Strong numbers', () => {
    const result = provider.parseSearchQuery('strong:H1234');
    expect(result.strongs).toEqual([{ prefix: 'H', number: '1234' }]);
    expect(result.textTerms).toEqual([]);
  });

  it('parses Greek Strong numbers', () => {
    const result = provider.parseSearchQuery('strong:G5678');
    expect(result.strongs).toEqual([{ prefix: 'G', number: '5678' }]);
  });

  it('parses mixed query', () => {
    const result = provider.parseSearchQuery('strong:H1234 love');
    expect(result.strongs.length).toBe(1);
    expect(result.textTerms).toEqual(['love']);
  });

  it('handles empty query', () => {
    const result = provider.parseSearchQuery('');
    expect(result.strongs).toEqual([]);
    expect(result.textTerms).toEqual([]);
  });
});

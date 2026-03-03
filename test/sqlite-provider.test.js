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

describe('editable operations', () => {
  let tmpDir;
  let dbPath;
  let db;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphe-sqlite-edit-'));
    dbPath = path.join(tmpDir, 'module.sqlite3');
    db = new Database(dbPath);
    db.exec(`
      CREATE TABLE info (name TEXT, value TEXT);
      CREATE TABLE books (book_number NUMERIC, short_name TEXT, long_name TEXT);
      CREATE TABLE verses (book_number NUMERIC, chapter NUMERIC, verse NUMERIC, text TEXT);
      CREATE TABLE commentaries (
        book_number NUMERIC,
        chapter_number_from NUMERIC,
        verse_number_from NUMERIC,
        chapter_number_to NUMERIC,
        verse_number_to NUMERIC,
        text TEXT
      );
    `);
    db.prepare('INSERT INTO info (name, value) VALUES (?, ?)').run('description', 'Demo');
    db.prepare('INSERT INTO books (book_number, short_name, long_name) VALUES (?, ?, ?)').run(
      10,
      'Gn',
      'Genesis'
    );
    db.prepare('INSERT INTO verses (book_number, chapter, verse, text) VALUES (?, ?, ?, ?)').run(
      10,
      1,
      1,
      'In the beginning'
    );
    db.prepare(
      'INSERT INTO commentaries (book_number, chapter_number_from, verse_number_from, chapter_number_to, verse_number_to, text) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(10, 1, 1, 1, 1, 'Commentary text');
  });

  afterAll(() => {
    if (db) db.close();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('upsertInfoValue updates and inserts', () => {
    const updated = provider.upsertInfoValue(db, 'description', 'Demo 2');
    expect(updated.updated).toBe(true);
    const inserted = provider.upsertInfoValue(db, 'short.title', 'D');
    expect(inserted.inserted).toBe(true);

    const rows = provider.getInfoRows(db);
    const map = Object.fromEntries(rows.map((r) => [r.name, r.value]));
    expect(map.description).toBe('Demo 2');
    expect(map['short.title']).toBe('D');
  });

  it('updateBookNames edits allowed columns', () => {
    provider.updateBookNames(db, 10, { shortName: 'Gen', longName: 'Genesis Book' });
    const row = provider.getEditableBooks(db).find((b) => b.bookNumber === 10);
    expect(row.shortName).toBe('Gen');
    expect(row.longName).toBe('Genesis Book');
  });

  it('get/update verse record works', () => {
    const before = provider.getVerseRecord(db, 10, 1, 1);
    expect(before.text).toBe('In the beginning');
    provider.updateVerseText(db, 10, 1, 1, 'Edited verse');
    const after = provider.getVerseRecord(db, 10, 1, 1);
    expect(after.text).toBe('Edited verse');
  });

  it('get/update commentary entry works', () => {
    const before = provider.getCommentaryEntry(db, 10, 1, 1);
    expect(before.text).toBe('Commentary text');
    provider.updateCommentaryText(db, 10, 1, 1, 'Edited commentary');
    const after = provider.getCommentaryEntry(db, 10, 1, 1);
    expect(after.text).toBe('Edited commentary');
  });

  it('table availability reports editable tables', () => {
    const available = provider.getEditableTableAvailability(db);
    expect(available.info).toBe(true);
    expect(available.books).toBe(true);
    expect(available.verses).toBe(true);
    expect(available.commentaries).toBe(true);
  });

  it('getEditableBooks falls back to commentaries when books tables are missing', () => {
    const fallbackDbPath = path.join(tmpDir, 'commentaries-only.sqlite3');
    const fallbackDb = new Database(fallbackDbPath);
    try {
      fallbackDb.exec(`
        CREATE TABLE commentaries (
          book_number NUMERIC,
          chapter_number_from NUMERIC,
          verse_number_from NUMERIC,
          chapter_number_to NUMERIC,
          verse_number_to NUMERIC,
          text TEXT
        );
      `);
      fallbackDb
        .prepare(
          'INSERT INTO commentaries (book_number, chapter_number_from, verse_number_from, chapter_number_to, verse_number_to, text) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(10, 1, 1, null, null, 'A');
      fallbackDb
        .prepare(
          'INSERT INTO commentaries (book_number, chapter_number_from, verse_number_from, chapter_number_to, verse_number_to, text) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(470, 1, 1, null, null, 'B');

      const books = provider.getEditableBooks(fallbackDb);
      expect(books.map((b) => b.bookNumber)).toEqual([10, 470]);
      expect(books[0].sourceTable).toBe('commentaries');
    } finally {
      fallbackDb.close();
    }
  });
});

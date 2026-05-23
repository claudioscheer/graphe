import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import * as sqliteProvider from '../src/main/modules/sqlite-provider.ts';

const MODULES_DIR = path.join(os.homedir(), '.graphe', 'modules');

function findFile(dir, pattern) {
  try {
    const files = fs.readdirSync(dir);
    const found = files.find((f) => pattern.test(f));
    return found ? path.join(dir, found) : null;
  } catch (_) {
    return null;
  }
}

const sqliteCommentaryFile = findFile(MODULES_DIR, /\.commentaries\.SQLite3$/i);
const sqliteBibleFile = findFile(MODULES_DIR, /^(?!.*(?:commentaries|dictionary)).*\.SQLite3$/i);
const sqliteDictFile = findFile(MODULES_DIR, /\.dictionary\.SQLite3$/i);

describe('Commentary output shape', () => {
  let sqlDb;

  beforeAll(() => {
    if (sqliteCommentaryFile) sqlDb = new Database(sqliteCommentaryFile, { readonly: true });
  });

  afterAll(() => {
    if (sqlDb) sqlDb.close();
  });

  it.skipIf(!sqliteCommentaryFile)(
    'SQLite commentary returns {verseFrom, verseTo, chapterTo, text}',
    () => {
      const sqlBooks = sqliteProvider.getCommentaryBooks(sqlDb);
      const sqlEntries = sqliteProvider.getCommentary(sqlDb, sqlBooks[0], 1);

      const requiredKeys = ['verseFrom', 'verseTo', 'chapterTo', 'text'];

      if (sqlEntries.length > 0) {
        for (const key of requiredKeys) {
          expect(sqlEntries[0]).toHaveProperty(key);
        }
      }
    }
  );
});

describe('Bible verse output shape', () => {
  let sqlDb;

  beforeAll(() => {
    if (sqliteBibleFile) sqlDb = new Database(sqliteBibleFile, { readonly: true });
  });

  afterAll(() => {
    if (sqlDb) sqlDb.close();
  });

  it.skipIf(!sqliteBibleFile)('SQLite bible returns {verse, text}', () => {
    const sqlBooks = sqliteProvider.getBooks(sqlDb);
    const sqlVerses = sqliteProvider.getChapter(sqlDb, sqlBooks[0].bookNumber, 1);

    expect(sqlVerses.length).toBeGreaterThan(0);
    expect(sqlVerses[0]).toHaveProperty('verse');
    expect(sqlVerses[0]).toHaveProperty('text');
  });

  it.skipIf(!sqliteBibleFile)('Strong tags use <S> format', () => {
    const strongFile = findFile(MODULES_DIR, /\+\.SQLite3$/i);
    if (!strongFile) return;

    const sqlStrongDb = new Database(strongFile, { readonly: true });
    try {
      const sqlBooks = sqliteProvider.getBooks(sqlStrongDb);
      if (sqlBooks.length === 0) return;
      const sqlVerses = sqliteProvider.getChapter(sqlStrongDb, sqlBooks[0].bookNumber, 1);
      const hasSqlStrong = sqlVerses.some((v) => /<S[ >]/.test(v.text));
      expect(hasSqlStrong).toBe(true);
    } finally {
      sqlStrongDb.close();
    }
  });
});

describe('Dictionary output shape', () => {
  let sqlDb;

  beforeAll(() => {
    if (sqliteDictFile) sqlDb = new Database(sqliteDictFile, { readonly: true });
  });

  afterAll(() => {
    if (sqlDb) sqlDb.close();
  });

  it.skipIf(!sqliteDictFile)('SQLite dictionary returns entries with topic', () => {
    const sqlCols = sqliteProvider.getDictColumns(sqlDb);
    const sqlTopics = sqliteProvider.searchDictionaryTopics(sqlDb, '', 1);
    const sqlEntry =
      sqlTopics.length > 0 ? sqliteProvider.getDictionaryEntry(sqlDb, sqlCols, sqlTopics[0]) : null;

    if (sqlEntry) {
      expect(sqlEntry).toHaveProperty('topic');
    }
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import * as sqliteProvider from '../src/main/modules/sqlite-provider.ts';
import {
  writeSqliteBibleFixture,
  writeSqliteCommentaryFixture,
  writeSqliteDictionaryFixture,
} from './support/module-fixtures.ts';

let tmpDir: string;
let sqliteCommentaryFile: string;
let sqliteBibleFile: string;
let sqliteDictFile: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphe-output-format-'));
  sqliteCommentaryFile = writeSqliteCommentaryFixture(tmpDir);
  sqliteBibleFile = writeSqliteBibleFixture(tmpDir);
  sqliteDictFile = writeSqliteDictionaryFixture(tmpDir);
});

afterAll(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Commentary output shape', () => {
  let sqlDb: DatabaseInstance;

  beforeAll(() => {
    if (sqliteCommentaryFile) sqlDb = new Database(sqliteCommentaryFile, { readonly: true });
  });

  afterAll(() => {
    if (sqlDb) sqlDb.close();
  });

  it('SQLite commentary returns {verseFrom, verseTo, chapterTo, text}', () => {
    const sqlBooks = sqliteProvider.getCommentaryBooks(sqlDb);
    const sqlEntries = sqliteProvider.getCommentary(sqlDb, sqlBooks[0], 1);

    const requiredKeys = ['verseFrom', 'verseTo', 'chapterTo', 'text'];

    if (sqlEntries.length > 0) {
      for (const key of requiredKeys) {
        expect(sqlEntries[0]).toHaveProperty(key);
      }
    }
  });
});

describe('Bible verse output shape', () => {
  let sqlDb: DatabaseInstance;

  beforeAll(() => {
    if (sqliteBibleFile) sqlDb = new Database(sqliteBibleFile, { readonly: true });
  });

  afterAll(() => {
    if (sqlDb) sqlDb.close();
  });

  it('SQLite bible returns {verse, text}', () => {
    const sqlBooks = sqliteProvider.getBooks(sqlDb);
    const sqlVerses = sqliteProvider.getChapter(sqlDb, sqlBooks[0].bookNumber, 1);

    expect(sqlVerses.length).toBeGreaterThan(0);
    expect(sqlVerses[0]).toHaveProperty('verse');
    expect(sqlVerses[0]).toHaveProperty('text');
  });

  it('Strong tags use <S> format', () => {
    const sqlBooks = sqliteProvider.getBooks(sqlDb);
    const sqlVerses = sqliteProvider.getChapter(sqlDb, sqlBooks[0].bookNumber, 1);
    const hasSqlStrong = sqlVerses.some((v) => /<S[ >]/.test(v.text));
    expect(hasSqlStrong).toBe(true);
  });
});

describe('Dictionary output shape', () => {
  let sqlDb: DatabaseInstance;

  beforeAll(() => {
    if (sqliteDictFile) sqlDb = new Database(sqliteDictFile, { readonly: true });
  });

  afterAll(() => {
    if (sqlDb) sqlDb.close();
  });

  it('SQLite dictionary returns entries with topic', () => {
    const sqlCols = sqliteProvider.getDictColumns(sqlDb);
    const sqlTopics = sqliteProvider.searchDictionaryTopics(sqlDb, '', 1);
    const sqlEntry =
      sqlTopics.length > 0 ? sqliteProvider.getDictionaryEntry(sqlDb, sqlCols, sqlTopics[0]) : null;

    if (sqlEntry) {
      expect(sqlEntry).toHaveProperty('topic');
    }
  });
});

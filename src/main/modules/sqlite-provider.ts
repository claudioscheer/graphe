/**
 * SQLite provider — handles .sqlite3 module files (Bibles, commentaries, dictionaries, cross-references).
 * All functions take a better-sqlite3 db instance as the first argument.
 */
import Database, { type Database as DatabaseInstance } from 'better-sqlite3';

interface InfoRow {
  name: string;
  value: string;
}

interface CountRow {
  count: number | null;
}

interface TopicRow {
  topic: string;
}

interface ColumnInfoRow {
  name?: string;
  1?: string;
}

interface GroupIdRow {
  group_id: string | number;
}

interface StrongNumberRow {
  strong_number: string;
}

interface RawBookRow {
  bookNumber: number;
  shortName?: string | null;
  longName?: string | null;
  title?: string | null;
  isPresent?: number | boolean;
}

interface EditableBookRecord extends BookRecord {
  shortName: string | null;
  longName: string | null;
  title: string | null;
  isPresent: number | boolean;
  sourceTable: 'books_all' | 'books' | 'commentaries';
}

interface MorphologyTableInfo {
  hasIndications: boolean;
  hasTopics: boolean;
  hasLanguageColumn: boolean;
}

interface SearchStrongTerm {
  prefix: string;
  number: string;
}

interface ParsedSearchQuery {
  strongs: SearchStrongTerm[];
  textTerms: string[];
  textPart: string;
}

interface BookNameUpdateFields extends BookNameFields {
  title?: string | null;
  isPresent?: boolean | number | null;
}

interface InfoUpdateResult {
  updated: boolean;
  inserted: boolean;
}

function hasDictionaryTable(db: DatabaseInstance): boolean {
  try {
    db.prepare('SELECT 1 FROM dictionary LIMIT 1').get();
    return true;
  } catch (_) {
    return false;
  }
}

function hasCrossRefTable(db: DatabaseInstance): boolean {
  try {
    db.prepare('SELECT 1 FROM cross_references LIMIT 1').get();
    return true;
  } catch (_) {
    return false;
  }
}

function hasCommentaryTable(db: DatabaseInstance): boolean {
  try {
    db.prepare('SELECT 1 FROM commentaries LIMIT 1').get();
    return true;
  } catch (_) {
    return false;
  }
}

function hasMorphologyIndicationsTable(db: DatabaseInstance): boolean {
  return tableExists(db, 'morphology_indications');
}

function hasMorphologyTopicsTable(db: DatabaseInstance): boolean {
  return tableExists(db, 'morphology_topics');
}

function detectType(db: DatabaseInstance): ModuleType {
  if (hasCommentaryTable(db)) return 'commentary';
  if (hasDictionaryTable(db)) return 'dictionary';
  if (hasCrossRefTable(db)) return 'crossreference';
  return 'bible';
}

function getInfo(db: DatabaseInstance): Record<string, string> {
  const info: Record<string, string> = {};
  try {
    const rows = db.prepare('SELECT name, value FROM info').all() as InfoRow[];
    for (const row of rows) info[row.name] = row.value;
  } catch (_) {}
  return info;
}

function getBooks(db: DatabaseInstance): BookRecord[] {
  // Spec: BOOKS_ALL takes priority over BOOKS
  try {
    const rows = db
      .prepare(
        'SELECT book_number AS bookNumber, short_name AS shortName, long_name AS longName FROM books_all WHERE is_present = 1 ORDER BY book_number'
      )
      .all() as BookRecord[];
    if (rows.length > 0) return rows;
  } catch (_) {}

  try {
    const rows = db
      .prepare(
        'SELECT book_number AS bookNumber, short_name AS shortName, long_name AS longName FROM books ORDER BY book_number'
      )
      .all() as BookRecord[];
    if (rows.length > 0) return rows;
  } catch (_) {}

  // Fallback for commentary modules that do not include BOOKS/BOOKS_ALL.
  // This keeps navigation/editor usable by deriving available books from commentaries rows.
  // short_name/long_name can be resolved in renderer via I18n.bookName(bookNumber).
  try {
    return (db
      .prepare('SELECT DISTINCT book_number AS bookNumber FROM commentaries ORDER BY book_number')
      .all() as Pick<BookRecord, 'bookNumber'>[])
      .map((row): BookRecord => ({
        bookNumber: row.bookNumber,
        shortName: null,
        longName: null,
      }));
  } catch (_) {
    return [];
  }
}

function getChapterCount(db: DatabaseInstance, bookNumber: number): number {
  const row = db
    .prepare('SELECT MAX(chapter) AS count FROM verses WHERE book_number = ?')
    .get(bookNumber) as CountRow | undefined;
  return row ? row.count : 0;
}

function getChapter(db: DatabaseInstance, bookNumber: number, chapter: number): VerseRecord[] {
  return db
    .prepare('SELECT verse, text FROM verses WHERE book_number = ? AND chapter = ? ORDER BY verse')
    .bind(bookNumber, chapter)
    .all() as VerseRecord[];
}

function parseSearchQuery(query: string | null | undefined): ParsedSearchQuery {
  const input = String(query || '').trim();
  if (!input) return { strongs: [], textTerms: [], textPart: '' };

  const strongRegex = /strong:([HhGg]?)(\d+\w*)/g;
  const strongs: SearchStrongTerm[] = [];
  let match: RegExpExecArray | null;
  while ((match = strongRegex.exec(input)) !== null) {
    strongs.push({
      prefix: (match[1] || '').toUpperCase(),
      number: match[2],
    });
  }

  const textPart = input
    .replace(/strong:[HhGg]?\d+\w*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const textTerms = textPart ? textPart.split(/\s+/).filter((term) => term.length >= 2) : [];

  return { strongs, textTerms, textPart };
}

function lexicalSearch(
  db: DatabaseInstance,
  query: string,
  opts: { limit?: number } = {}
): SearchResult[] {
  const { strongs, textTerms } = parseSearchQuery(query);
  if (strongs.length === 0 && textTerms.length === 0) return [];

  const limit = Number.isFinite(opts.limit) ? opts.limit : null;

  const conditions: string[] = [];
  const params: string[] = [];

  for (const { prefix, number } of strongs) {
    conditions.push("text LIKE '%<S>' || ? || '</S>%' ");
    params.push(number);

    if (prefix === 'H') {
      conditions.push('book_number < 470');
    } else if (prefix === 'G') {
      conditions.push('book_number >= 470');
    }
  }

  for (const term of textTerms) {
    conditions.push("text LIKE '%' || ? || '%' ");
    params.push(term);
  }

  let sql = `SELECT book_number AS bookNumber, chapter, verse, text FROM verses WHERE ${conditions.join(' AND ')} ORDER BY book_number, chapter, verse`;
  if (limit && limit > 0) sql += ` LIMIT ${Math.floor(limit)}`;

  return db
    .prepare(sql)
    .bind(...params)
    .all() as SearchResult[];
}

function getDictColumns(db: DatabaseInstance): string[] {
  const rows = db.prepare('PRAGMA table_info(dictionary)').all() as ColumnInfoRow[];
  return rows.map((r) => r.name);
}

function getDictionaryEntry(
  db: DatabaseInstance,
  cols: string[],
  topic: string
): DictionaryEntry | null {
  const select = cols.join(', ');
  return (db.prepare(`SELECT ${select} FROM dictionary WHERE topic = ?`).get(topic) as DictionaryEntry | undefined) || null;
}

function searchDictionaryTopics(db: DatabaseInstance, prefix: string, limit: number): string[] {
  return (db
    .prepare('SELECT topic FROM dictionary WHERE topic LIKE ? ORDER BY topic LIMIT ?')
    .all(prefix + '%', limit || 20) as TopicRow[])
    .map((r: TopicRow) => r.topic);
}

function getDictionaryCognates(db: DatabaseInstance, strongsNumber: string): string[] {
  try {
    const row = db
      .prepare('SELECT group_id FROM cognate_strong_numbers WHERE strong_number = ? LIMIT 1')
      .get(strongsNumber) as GroupIdRow | undefined;
    if (!row) return [];
    return (db
      .prepare(
        'SELECT strong_number FROM cognate_strong_numbers WHERE group_id = ? AND strong_number != ?'
      )
      .all(row.group_id, strongsNumber) as StrongNumberRow[])
      .map((r: StrongNumberRow) => r.strong_number);
  } catch (_) {
    return [];
  }
}

function getDictionaryTopicCount(db: DatabaseInstance): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM dictionary').get() as CountRow | undefined;
  return Number(row?.count || 0);
}

function getDictionaryTopicsByPrefix(
  db: DatabaseInstance,
  prefix: string,
  limit: number,
  offset: number
): string[] {
  const normalizedPrefix = String(prefix || '').trim();
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 50));
  const safeOffset = Math.max(0, Number(offset) || 0);

  if (!normalizedPrefix) {
    return (db
      .prepare('SELECT topic FROM dictionary ORDER BY topic LIMIT ? OFFSET ?')
      .all(safeLimit, safeOffset) as TopicRow[])
      .map((r: TopicRow) => r.topic);
  }

  return (db
    .prepare('SELECT topic FROM dictionary WHERE topic LIKE ? ORDER BY topic LIMIT ? OFFSET ?')
    .all(normalizedPrefix + '%', safeLimit, safeOffset) as TopicRow[])
    .map((r: TopicRow) => r.topic);
}

function getDictionaryRandomTopics(db: DatabaseInstance, limit: number): string[] {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 20));
  return (db
    .prepare('SELECT topic FROM dictionary ORDER BY RANDOM() LIMIT ?')
    .all(safeLimit) as TopicRow[])
    .map((r: TopicRow) => r.topic);
}

function getMorphologyTableInfo(db: DatabaseInstance): MorphologyTableInfo {
  if (!hasMorphologyIndicationsTable(db)) {
    return {
      hasIndications: false,
      hasTopics: hasMorphologyTopicsTable(db),
      hasLanguageColumn: false,
    };
  }

  const cols = db.prepare('PRAGMA table_info(morphology_indications)').all() as ColumnInfoRow[];
  const hasLanguageColumn = cols.some(
    (row) => String(row.name || row[1] || '').toLowerCase() === 'language'
  );

  return {
    hasIndications: true,
    hasTopics: hasMorphologyTopicsTable(db),
    hasLanguageColumn,
  };
}

function getCrossReferences(db: DatabaseInstance, book: number, chapter: number): CrossReference[] {
  return db
    .prepare(
      'SELECT verse, verse_end AS verseEnd, book_to AS bookTo, chapter_to AS chapterTo, verse_to_start AS verseToStart, verse_to_end AS verseToEnd, votes FROM cross_references WHERE book = ? AND chapter = ? ORDER BY verse, votes DESC'
    )
    .bind(book, chapter)
    .all() as CrossReference[];
}

function getReverseCrossReferences(
  db: DatabaseInstance,
  bookTo: number,
  chapterTo: number,
  verseTo: number
): CrossReference[] {
  return db
    .prepare(
      'SELECT book, chapter, verse, votes FROM cross_references ' +
        'WHERE book_to = ? AND chapter_to = ? AND verse_to_start <= ? ' +
        'AND (verse_to_end >= ? OR verse_to_end IS NULL OR verse_to_start = ?) ' +
        'ORDER BY book, chapter, verse'
    )
    .bind(bookTo, chapterTo, verseTo, verseTo, verseTo)
    .all() as CrossReference[];
}

function getCommentary(
  db: DatabaseInstance,
  bookNumber: number,
  chapter: number
): CommentaryEntry[] {
  return db
    .prepare(
      'SELECT verse_number_from AS verseFrom, verse_number_to AS verseTo, chapter_number_to AS chapterTo, text FROM commentaries WHERE book_number = ? AND chapter_number_from = ? ORDER BY verse_number_from'
    )
    .bind(bookNumber, chapter)
    .all() as CommentaryEntry[];
}

function getCommentaryBooks(db: DatabaseInstance): number[] {
  return (db
    .prepare('SELECT DISTINCT book_number AS bookNumber FROM commentaries ORDER BY book_number')
    .all() as Pick<BookRecord, 'bookNumber'>[])
    .map((r: Pick<BookRecord, 'bookNumber'>) => r.bookNumber);
}

function getCommentaryCoverage(db: DatabaseInstance): Record<number, number[]> {
  const rows = db
    .prepare(
      'SELECT book_number AS bookNumber, chapter_number_from AS chapter FROM commentaries GROUP BY book_number, chapter_number_from ORDER BY book_number, chapter_number_from'
    )
    .all() as Array<{ bookNumber: number; chapter: number }>;
  const map: Record<number, number[]> = {};
  for (const row of rows) {
    if (!map[row.bookNumber]) map[row.bookNumber] = [];
    map[row.bookNumber].push(row.chapter);
  }
  return map;
}

function isValidModule(filePath: string): boolean {
  try {
    const db = new Database(filePath, { readonly: true });
    try {
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('verses','dictionary','commentaries','cross_references')"
        )
        .all();
      return tables.length > 0;
    } finally {
      db.close();
    }
  } catch (_) {
    return false;
  }
}

function tableExists(db: DatabaseInstance, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(tableName);
  return !!row;
}

function getEditableTableAvailability(db: DatabaseInstance): Record<string, boolean> {
  return {
    info: tableExists(db, 'info'),
    books: tableExists(db, 'books'),
    booksAll: tableExists(db, 'books_all'),
    verses: tableExists(db, 'verses'),
    commentaries: tableExists(db, 'commentaries'),
  };
}

function getInfoRows(db: DatabaseInstance): InfoRow[] {
  if (!tableExists(db, 'info')) return [];
  return db.prepare('SELECT name, value FROM info ORDER BY name').all() as InfoRow[];
}

function upsertInfoValue(
  db: DatabaseInstance,
  name: string,
  value: string | number | boolean | null | undefined
): InfoUpdateResult {
  if (!tableExists(db, 'info')) throw new Error('Module does not have info table');
  const key = String(name || '').trim();
  if (!key) throw new Error('Info key is required');
  const val = String(value ?? '');
  const update = db.prepare('UPDATE info SET value = ? WHERE name = ?').run(val, key);
  if (update.changes > 0) return { updated: true, inserted: false };
  db.prepare('INSERT INTO info (name, value) VALUES (?, ?)').run(key, val);
  return { updated: false, inserted: true };
}

function deleteInfoKey(db: DatabaseInstance, name: string): boolean {
  if (!tableExists(db, 'info')) throw new Error('Module does not have info table');
  const key = String(name || '').trim();
  if (!key) throw new Error('Info key is required');
  const result = db.prepare('DELETE FROM info WHERE name = ?').run(key);
  return result.changes > 0;
}

function getEditableBooks(db: DatabaseInstance): EditableBookRecord[] {
  if (tableExists(db, 'books_all')) {
    return (db
      .prepare(
        'SELECT book_number AS bookNumber, short_name AS shortName, long_name AS longName, title, is_present AS isPresent FROM books_all ORDER BY book_number'
      )
      .all() as RawBookRow[])
      .map((row): EditableBookRecord => ({
        bookNumber: row.bookNumber,
        shortName: row.shortName ?? null,
        longName: row.longName ?? null,
        title: row.title ?? null,
        isPresent: row.isPresent ?? 1,
        sourceTable: 'books_all',
      }));
  }
  if (tableExists(db, 'books')) {
    return (db
      .prepare(
        'SELECT book_number AS bookNumber, short_name AS shortName, long_name AS longName FROM books ORDER BY book_number'
      )
      .all() as RawBookRow[])
      .map((row): EditableBookRecord => ({
        bookNumber: row.bookNumber,
        shortName: row.shortName ?? null,
        longName: row.longName ?? null,
        title: null,
        isPresent: 1,
        sourceTable: 'books',
      }));
  }
  if (tableExists(db, 'commentaries')) {
    return (db
      .prepare('SELECT DISTINCT book_number AS bookNumber FROM commentaries ORDER BY book_number')
      .all() as Pick<BookRecord, 'bookNumber'>[])
      .map((row): EditableBookRecord => ({
        bookNumber: row.bookNumber,
        shortName: null,
        longName: null,
        title: null,
        isPresent: 1,
        sourceTable: 'commentaries',
      }));
  }
  return [];
}

function updateBookNames(
  db: DatabaseInstance,
  bookNumber: number,
  fields: BookNameUpdateFields = {}
): boolean {
  const hasBooksAll = tableExists(db, 'books_all');
  const hasBooks = tableExists(db, 'books');
  const targetTable = hasBooksAll ? 'books_all' : hasBooks ? 'books' : null;
  if (!targetTable) throw new Error('Module does not have books table');
  if (!Number.isInteger(bookNumber)) throw new Error('Invalid book number');

  const updates: string[] = [];
  const params: Array<string | number> = [];

  if (Object.prototype.hasOwnProperty.call(fields, 'shortName')) {
    updates.push('short_name = ?');
    params.push(String(fields.shortName ?? ''));
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'longName')) {
    updates.push('long_name = ?');
    params.push(String(fields.longName ?? ''));
  }
  if (targetTable === 'books_all' && Object.prototype.hasOwnProperty.call(fields, 'title')) {
    updates.push('title = ?');
    params.push(String(fields.title ?? ''));
  }
  if (targetTable === 'books_all' && Object.prototype.hasOwnProperty.call(fields, 'isPresent')) {
    updates.push('is_present = ?');
    params.push(fields.isPresent ? 1 : 0);
  }
  if (updates.length === 0) throw new Error('No allowed fields provided');

  const stmt = db.prepare(`UPDATE ${targetTable} SET ${updates.join(', ')} WHERE book_number = ?`);
  const res = stmt.run(...params, bookNumber);
  if (res.changes === 0) throw new Error('Book row not found');
  return true;
}

function getVerseRecord(
  db: DatabaseInstance,
  bookNumber: number,
  chapter: number,
  verse: number
): VerseRecord | null {
  if (!tableExists(db, 'verses')) throw new Error('Module does not have verses table');
  const row = db
    .prepare(
      'SELECT book_number AS bookNumber, chapter, verse, text FROM verses WHERE book_number = ? AND chapter = ? AND verse = ? LIMIT 1'
    )
    .get(bookNumber, chapter, verse) as VerseRecord | undefined;
  return row || null;
}

function updateVerseText(
  db: DatabaseInstance,
  bookNumber: number,
  chapter: number,
  verse: number,
  text: string
): boolean {
  if (!tableExists(db, 'verses')) throw new Error('Module does not have verses table');
  const res = db
    .prepare('UPDATE verses SET text = ? WHERE book_number = ? AND chapter = ? AND verse = ?')
    .run(String(text ?? ''), bookNumber, chapter, verse);
  if (res.changes === 0) throw new Error('Verse row not found');
  return true;
}

function getCommentaryEntry(
  db: DatabaseInstance,
  bookNumber: number,
  chapter: number,
  verseFrom: number
): CommentaryEntry | null {
  if (!tableExists(db, 'commentaries')) throw new Error('Module does not have commentaries table');
  const row = db
    .prepare(
      'SELECT book_number AS bookNumber, chapter_number_from AS chapterFrom, verse_number_from AS verseFrom, chapter_number_to AS chapterTo, verse_number_to AS verseTo, text FROM commentaries WHERE book_number = ? AND chapter_number_from = ? AND verse_number_from = ? LIMIT 1'
    )
    .get(bookNumber, chapter, verseFrom) as CommentaryEntry | undefined;
  return row || null;
}

function updateCommentaryText(
  db: DatabaseInstance,
  bookNumber: number,
  chapter: number,
  verseFrom: number,
  text: string
): boolean {
  if (!tableExists(db, 'commentaries')) throw new Error('Module does not have commentaries table');
  const res = db
    .prepare(
      'UPDATE commentaries SET text = ? WHERE book_number = ? AND chapter_number_from = ? AND verse_number_from = ?'
    )
    .run(String(text ?? ''), bookNumber, chapter, verseFrom);
  if (res.changes === 0) throw new Error('Commentary row not found');
  return true;
}

export {
  detectType,
  getInfo,
  getInfoRows,
  upsertInfoValue,
  deleteInfoKey,
  getBooks,
  getEditableBooks,
  updateBookNames,
  getChapterCount,
  getChapter,
  getVerseRecord,
  updateVerseText,
  parseSearchQuery,
  lexicalSearch,
  getDictColumns,
  getDictionaryEntry,
  searchDictionaryTopics,
  getDictionaryCognates,
  getDictionaryTopicCount,
  getDictionaryTopicsByPrefix,
  getDictionaryRandomTopics,
  getCrossReferences,
  getReverseCrossReferences,
  getCommentary,
  getCommentaryBooks,
  getCommentaryCoverage,
  getCommentaryEntry,
  updateCommentaryText,
  getMorphologyTableInfo,
  getEditableTableAvailability,
  isValidModule,
  hasDictionaryTable,
  hasCrossRefTable,
};

if (typeof module !== 'undefined') module.exports = {
  detectType,
  getInfo,
  getInfoRows,
  upsertInfoValue,
  deleteInfoKey,
  getBooks,
  getEditableBooks,
  updateBookNames,
  getChapterCount,
  getChapter,
  getVerseRecord,
  updateVerseText,
  parseSearchQuery,
  lexicalSearch,
  getDictColumns,
  getDictionaryEntry,
  searchDictionaryTopics,
  getDictionaryCognates,
  getDictionaryTopicCount,
  getDictionaryTopicsByPrefix,
  getDictionaryRandomTopics,
  getCrossReferences,
  getReverseCrossReferences,
  getCommentary,
  getCommentaryBooks,
  getCommentaryCoverage,
  getCommentaryEntry,
  updateCommentaryText,
  getMorphologyTableInfo,
  getEditableTableAvailability,
  isValidModule,
  hasDictionaryTable,
  hasCrossRefTable,
};

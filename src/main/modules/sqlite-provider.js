/**
 * SQLite provider — handles .sqlite3 module files (Bibles, commentaries, dictionaries, cross-references).
 * All functions take a better-sqlite3 db instance as the first argument.
 */

function hasDictionaryTable(db) {
  try {
    db.prepare('SELECT 1 FROM dictionary LIMIT 1').get();
    return true;
  } catch (_) {
    return false;
  }
}

function hasCrossRefTable(db) {
  try {
    db.prepare('SELECT 1 FROM cross_references LIMIT 1').get();
    return true;
  } catch (_) {
    return false;
  }
}

function hasCommentaryTable(db) {
  try {
    db.prepare('SELECT 1 FROM commentaries LIMIT 1').get();
    return true;
  } catch (_) {
    return false;
  }
}

function detectType(db) {
  if (hasCommentaryTable(db)) return 'commentary';
  if (hasDictionaryTable(db)) return 'dictionary';
  if (hasCrossRefTable(db)) return 'crossreference';
  return 'bible';
}

function getInfo(db) {
  const info = {};
  try {
    const rows = db.prepare('SELECT name, value FROM info').all();
    for (const row of rows) info[row.name] = row.value;
  } catch (_) {}
  return info;
}

function getBooks(db) {
  // Spec: BOOKS_ALL takes priority over BOOKS
  try {
    const rows = db
      .prepare(
        'SELECT book_number AS bookNumber, short_name AS shortName, long_name AS longName FROM books_all WHERE is_present = 1 ORDER BY book_number'
      )
      .all();
    if (rows.length > 0) return rows;
  } catch (_) {}

  try {
    const rows = db
      .prepare(
        'SELECT book_number AS bookNumber, short_name AS shortName, long_name AS longName FROM books ORDER BY book_number'
      )
      .all();
    if (rows.length > 0) return rows;
  } catch (_) {}

  // Fallback for commentary modules that do not include BOOKS/BOOKS_ALL.
  // This keeps navigation/editor usable by deriving available books from commentaries rows.
  // short_name/long_name can be resolved in renderer via I18n.bookName(bookNumber).
  try {
    return db
      .prepare('SELECT DISTINCT book_number AS bookNumber FROM commentaries ORDER BY book_number')
      .all()
      .map((row) => ({
        bookNumber: row.bookNumber,
        shortName: null,
        longName: null,
      }));
  } catch (_) {
    return [];
  }
}

function getChapterCount(db, bookNumber) {
  const row = db
    .prepare('SELECT MAX(chapter) AS count FROM verses WHERE book_number = ?')
    .get(bookNumber);
  return row ? row.count : 0;
}

function getChapter(db, bookNumber, chapter) {
  return db
    .prepare('SELECT verse, text FROM verses WHERE book_number = ? AND chapter = ? ORDER BY verse')
    .bind(bookNumber, chapter)
    .all();
}

function parseSearchQuery(query) {
  const input = String(query || '').trim();
  if (!input) return { strongs: [], textTerms: [], textPart: '' };

  const strongRegex = /strong:([HhGg]?)(\d+\w*)/g;
  const strongs = [];
  let match;
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

function lexicalSearch(db, query, opts = {}) {
  const { strongs, textTerms } = parseSearchQuery(query);
  if (strongs.length === 0 && textTerms.length === 0) return [];

  const limit = Number.isFinite(opts.limit) ? opts.limit : null;

  const conditions = [];
  const params = [];

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
    .all();
}

function getDictColumns(db) {
  const rows = db.prepare('PRAGMA table_info(dictionary)').all();
  return rows.map((r) => r.name);
}

function getDictionaryEntry(db, cols, topic) {
  const select = cols.join(', ');
  return db.prepare(`SELECT ${select} FROM dictionary WHERE topic = ?`).get(topic) || null;
}

function searchDictionaryTopics(db, prefix, limit) {
  return db
    .prepare('SELECT topic FROM dictionary WHERE topic LIKE ? ORDER BY topic LIMIT ?')
    .all(prefix + '%', limit || 20)
    .map((r) => r.topic);
}

function getDictionaryCognates(db, strongsNumber) {
  try {
    const row = db
      .prepare('SELECT group_id FROM cognate_strong_numbers WHERE strong_number = ? LIMIT 1')
      .get(strongsNumber);
    if (!row) return [];
    return db
      .prepare(
        'SELECT strong_number FROM cognate_strong_numbers WHERE group_id = ? AND strong_number != ?'
      )
      .all(row.group_id, strongsNumber)
      .map((r) => r.strong_number);
  } catch (_) {
    return [];
  }
}

function getCrossReferences(db, book, chapter) {
  return db
    .prepare(
      'SELECT verse, verse_end AS verseEnd, book_to AS bookTo, chapter_to AS chapterTo, verse_to_start AS verseToStart, verse_to_end AS verseToEnd, votes FROM cross_references WHERE book = ? AND chapter = ? ORDER BY verse, votes DESC'
    )
    .bind(book, chapter)
    .all();
}

function getCommentary(db, bookNumber, chapter) {
  return db
    .prepare(
      'SELECT verse_number_from AS verseFrom, verse_number_to AS verseTo, chapter_number_to AS chapterTo, text FROM commentaries WHERE book_number = ? AND chapter_number_from = ? ORDER BY verse_number_from'
    )
    .bind(bookNumber, chapter)
    .all();
}

function getCommentaryBooks(db) {
  return db
    .prepare('SELECT DISTINCT book_number AS bookNumber FROM commentaries ORDER BY book_number')
    .all()
    .map((r) => r.bookNumber);
}

function getCommentaryCoverage(db) {
  const rows = db
    .prepare(
      'SELECT book_number AS bookNumber, chapter_number_from AS chapter FROM commentaries GROUP BY book_number, chapter_number_from ORDER BY book_number, chapter_number_from'
    )
    .all();
  const map = {};
  for (const row of rows) {
    if (!map[row.bookNumber]) map[row.bookNumber] = [];
    map[row.bookNumber].push(row.chapter);
  }
  return map;
}

function isValidModule(filePath) {
  const Database = require('better-sqlite3');
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

function tableExists(db, tableName) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(tableName);
  return !!row;
}

function getEditableTableAvailability(db) {
  return {
    info: tableExists(db, 'info'),
    books: tableExists(db, 'books'),
    booksAll: tableExists(db, 'books_all'),
    verses: tableExists(db, 'verses'),
    commentaries: tableExists(db, 'commentaries'),
  };
}

function getInfoRows(db) {
  if (!tableExists(db, 'info')) return [];
  return db.prepare('SELECT name, value FROM info ORDER BY name').all();
}

function upsertInfoValue(db, name, value) {
  if (!tableExists(db, 'info')) throw new Error('Module does not have info table');
  const key = String(name || '').trim();
  if (!key) throw new Error('Info key is required');
  const val = String(value ?? '');
  const update = db.prepare('UPDATE info SET value = ? WHERE name = ?').run(val, key);
  if (update.changes > 0) return { updated: true, inserted: false };
  db.prepare('INSERT INTO info (name, value) VALUES (?, ?)').run(key, val);
  return { updated: false, inserted: true };
}

function deleteInfoKey(db, name) {
  if (!tableExists(db, 'info')) throw new Error('Module does not have info table');
  const key = String(name || '').trim();
  if (!key) throw new Error('Info key is required');
  const result = db.prepare('DELETE FROM info WHERE name = ?').run(key);
  return result.changes > 0;
}

function getEditableBooks(db) {
  if (tableExists(db, 'books_all')) {
    return db
      .prepare(
        'SELECT book_number AS bookNumber, short_name AS shortName, long_name AS longName, title, is_present AS isPresent FROM books_all ORDER BY book_number'
      )
      .all()
      .map((row) => ({ ...row, sourceTable: 'books_all' }));
  }
  if (tableExists(db, 'books')) {
    return db
      .prepare(
        'SELECT book_number AS bookNumber, short_name AS shortName, long_name AS longName FROM books ORDER BY book_number'
      )
      .all()
      .map((row) => ({ ...row, title: null, isPresent: 1, sourceTable: 'books' }));
  }
  if (tableExists(db, 'commentaries')) {
    return db
      .prepare('SELECT DISTINCT book_number AS bookNumber FROM commentaries ORDER BY book_number')
      .all()
      .map((row) => ({
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

function updateBookNames(db, bookNumber, fields = {}) {
  const hasBooksAll = tableExists(db, 'books_all');
  const hasBooks = tableExists(db, 'books');
  const targetTable = hasBooksAll ? 'books_all' : hasBooks ? 'books' : null;
  if (!targetTable) throw new Error('Module does not have books table');
  if (!Number.isInteger(bookNumber)) throw new Error('Invalid book number');

  const updates = [];
  const params = [];

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

  const stmt = db.prepare(
    `UPDATE ${targetTable} SET ${updates.join(', ')} WHERE book_number = ?`
  );
  const res = stmt.run(...params, bookNumber);
  if (res.changes === 0) throw new Error('Book row not found');
  return true;
}

function getVerseRecord(db, bookNumber, chapter, verse) {
  if (!tableExists(db, 'verses')) throw new Error('Module does not have verses table');
  const row = db
    .prepare(
      'SELECT book_number AS bookNumber, chapter, verse, text FROM verses WHERE book_number = ? AND chapter = ? AND verse = ? LIMIT 1'
    )
    .get(bookNumber, chapter, verse);
  return row || null;
}

function updateVerseText(db, bookNumber, chapter, verse, text) {
  if (!tableExists(db, 'verses')) throw new Error('Module does not have verses table');
  const res = db
    .prepare('UPDATE verses SET text = ? WHERE book_number = ? AND chapter = ? AND verse = ?')
    .run(String(text ?? ''), bookNumber, chapter, verse);
  if (res.changes === 0) throw new Error('Verse row not found');
  return true;
}

function getCommentaryEntry(db, bookNumber, chapter, verseFrom) {
  if (!tableExists(db, 'commentaries')) throw new Error('Module does not have commentaries table');
  const row = db
    .prepare(
      'SELECT book_number AS bookNumber, chapter_number_from AS chapterFrom, verse_number_from AS verseFrom, chapter_number_to AS chapterTo, verse_number_to AS verseTo, text FROM commentaries WHERE book_number = ? AND chapter_number_from = ? AND verse_number_from = ? LIMIT 1'
    )
    .get(bookNumber, chapter, verseFrom);
  return row || null;
}

function updateCommentaryText(db, bookNumber, chapter, verseFrom, text) {
  if (!tableExists(db, 'commentaries')) throw new Error('Module does not have commentaries table');
  const res = db
    .prepare(
      'UPDATE commentaries SET text = ? WHERE book_number = ? AND chapter_number_from = ? AND verse_number_from = ?'
    )
    .run(String(text ?? ''), bookNumber, chapter, verseFrom);
  if (res.changes === 0) throw new Error('Commentary row not found');
  return true;
}

module.exports = {
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
  getCrossReferences,
  getCommentary,
  getCommentaryBooks,
  getCommentaryCoverage,
  getCommentaryEntry,
  updateCommentaryText,
  getEditableTableAvailability,
  isValidModule,
  hasDictionaryTable,
  hasCrossRefTable,
  hasCommentaryTable,
};

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

  return db
    .prepare(
      'SELECT book_number AS bookNumber, short_name AS shortName, long_name AS longName FROM books ORDER BY book_number'
    )
    .all();
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

module.exports = {
  detectType,
  getInfo,
  getBooks,
  getChapterCount,
  getChapter,
  parseSearchQuery,
  lexicalSearch,
  getDictColumns,
  getDictionaryEntry,
  searchDictionaryTopics,
  getDictionaryCognates,
  getCrossReferences,
  getCommentary,
  getCommentaryBooks,
  isValidModule,
  hasDictionaryTable,
  hasCrossRefTable,
  hasCommentaryTable,
};

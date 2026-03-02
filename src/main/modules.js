const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');

const MODULES_DIR = path.join(os.homedir(), '.graphe', 'modules');
const dbs = new Map();
const dictColumnCache = new Map();

function init() {
  // Only load modules explicitly installed in ~/.graphe/modules/
  fs.mkdirSync(MODULES_DIR, { recursive: true });

  // Scan and open all modules
  loadAll();
}

function loadAll() {
  for (const db of dbs.values()) {
    try {
      db.close();
    } catch (_) {}
  }
  dbs.clear();
  dictColumnCache.clear();

  for (const file of fs.readdirSync(MODULES_DIR)) {
    if (file.toLowerCase().endsWith('.sqlite3')) {
      const filePath = path.join(MODULES_DIR, file);
      try {
        const db = new Database(filePath, { readonly: true });
        const id = path.basename(file, path.extname(file));
        dbs.set(id, db);
      } catch (err) {
        console.error(`Failed to open module ${file}:`, err.message);
      }
    }
  }
}

function getDb(moduleId) {
  const db = dbs.get(moduleId);
  if (!db) throw new Error(`Module not found: ${moduleId}`);
  return db;
}

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

function parseSearchQuery(query) {
  const input = String(query || '').trim();
  if (!input) return { strongs: [], textTerms: [], textPart: '' };

  // strong:H1234 or strong:G3056 or strong:3056
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

function lexicalSearch(moduleId, query, opts = {}) {
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

  const db = getDb(moduleId);
  return db
    .prepare(sql)
    .bind(...params)
    .all();
}

const SUPPORTED_TYPES = new Set(['bible', 'dictionary', 'commentary', 'crossreference']);

function getModules() {
  const result = [];
  for (const [id, db] of dbs) {
    const info = {};
    try {
      const rows = db.prepare('SELECT name, value FROM info').all();
      for (const row of rows) info[row.name] = row.value;
    } catch (_) {}

    const type = hasCommentaryTable(db)
      ? 'commentary'
      : hasDictionaryTable(db)
        ? 'dictionary'
        : hasCrossRefTable(db)
          ? 'crossreference'
          : 'bible';

    if (!SUPPORTED_TYPES.has(type)) continue;

    const mod = {
      id,
      type,
      description: info.description || id,
      hasStrongs: (info.strong_numbers || '').toLowerCase() === 'true',
    };

    if (type === 'dictionary') {
      mod.isStrongDict = (info.is_strong || '').toLowerCase() === 'true';
      mod.language = info.language || null;
    }

    result.push(mod);
  }
  // Sort alphabetically by description
  result.sort((a, b) => a.description.localeCompare(b.description));
  return result;
}

function getDictColumns(moduleId) {
  if (dictColumnCache.has(moduleId)) return dictColumnCache.get(moduleId);
  const db = getDb(moduleId);
  const rows = db.prepare('PRAGMA table_info(dictionary)').all();
  const cols = rows.map((r) => r.name);
  dictColumnCache.set(moduleId, cols);
  return cols;
}

function getDictionaryEntry(moduleId, topic) {
  const db = getDb(moduleId);
  const cols = getDictColumns(moduleId);
  const select = cols.join(', ');
  return db.prepare(`SELECT ${select} FROM dictionary WHERE topic = ?`).get(topic) || null;
}

function lookupAllStrongDicts(topic, allowedModuleIds) {
  if (!allowedModuleIds || allowedModuleIds.length === 0) return [];
  const results = [];
  for (const id of allowedModuleIds) {
    const db = dbs.get(id);
    if (!db || !hasDictionaryTable(db)) continue;
    try {
      const entry = getDictionaryEntry(id, topic);
      if (entry) results.push({ moduleId: id, entry });
    } catch (_) {}
  }
  return results;
}

function searchDictionaryTopics(moduleId, prefix, limit) {
  const db = getDb(moduleId);
  return db
    .prepare('SELECT topic FROM dictionary WHERE topic LIKE ? ORDER BY topic LIMIT ?')
    .all(prefix + '%', limit || 20)
    .map((r) => r.topic);
}

function getDictionaryCognates(moduleId, strongsNumber) {
  const db = getDb(moduleId);
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

function getBooks(moduleId) {
  const db = getDb(moduleId);
  return db
    .prepare(
      'SELECT book_number AS bookNumber, short_name AS shortName, long_name AS longName FROM books ORDER BY book_number'
    )
    .all();
}

function getAllBooks() {
  const merged = new Map();
  for (const db of dbs.values()) {
    try {
      const rows = db
        .prepare(
          'SELECT book_number AS bookNumber, short_name AS shortName, long_name AS longName FROM books ORDER BY book_number'
        )
        .all();
      for (const row of rows) {
        if (!merged.has(row.bookNumber)) merged.set(row.bookNumber, row);
      }
    } catch (_) {}
  }
  return Array.from(merged.values()).sort((a, b) => a.bookNumber - b.bookNumber);
}

function getChapterCount(moduleId, bookNumber) {
  const db = getDb(moduleId);
  const row = db
    .prepare('SELECT MAX(chapter) AS count FROM verses WHERE book_number = ?')
    .get(bookNumber);
  return row ? row.count : 0;
}

function getChapter(moduleId, bookNumber, chapter) {
  const db = getDb(moduleId);
  return db
    .prepare('SELECT verse, text FROM verses WHERE book_number = ? AND chapter = ? ORDER BY verse')
    .bind(bookNumber, chapter)
    .all();
}

function searchVerses(moduleId, query) {
  return lexicalSearch(moduleId, query);
}

function getCrossReferences(moduleId, book, chapter) {
  const db = getDb(moduleId);
  return db
    .prepare(
      'SELECT verse, verse_end AS verseEnd, book_to AS bookTo, chapter_to AS chapterTo, verse_to_start AS verseToStart, verse_to_end AS verseToEnd, votes FROM cross_references WHERE book = ? AND chapter = ? ORDER BY verse, votes DESC'
    )
    .bind(book, chapter)
    .all();
}

function lookupAllCrossRefModules(book, chapter, allowedModuleIds) {
  if (!allowedModuleIds || allowedModuleIds.length === 0) return [];
  const results = [];
  for (const id of allowedModuleIds) {
    const db = dbs.get(id);
    if (!db || !hasCrossRefTable(db)) continue;
    try {
      const refs = getCrossReferences(id, book, chapter);
      for (const ref of refs) {
        results.push(ref);
      }
    } catch (_) {}
  }
  // Re-sort merged results by verse then votes descending
  results.sort((a, b) => {
    if (a.verse !== b.verse) return a.verse - b.verse;
    return b.votes - a.votes;
  });
  return results;
}

function getCommentary(moduleId, bookNumber, chapter) {
  const db = getDb(moduleId);
  return db
    .prepare(
      'SELECT verse_number_from AS verseFrom, verse_number_to AS verseTo, chapter_number_to AS chapterTo, text FROM commentaries WHERE book_number = ? AND chapter_number_from = ? ORDER BY verse_number_from'
    )
    .bind(bookNumber, chapter)
    .all();
}

function getCommentaryBooks(moduleId) {
  const db = getDb(moduleId);
  return db
    .prepare('SELECT DISTINCT book_number AS bookNumber FROM commentaries ORDER BY book_number')
    .all()
    .map((r) => r.bookNumber);
}

module.exports = {
  init,
  getModules,
  getBooks,
  getAllBooks,
  getChapterCount,
  getChapter,
  searchVerses,
  getDictionaryEntry,
  lookupAllStrongDicts,
  searchDictionaryTopics,
  getDictionaryCognates,
  getCrossReferences,
  lookupAllCrossRefModules,
  getCommentary,
  getCommentaryBooks,
};

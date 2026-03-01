const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');
const semanticIndex = require('./semantic-index');

const MODULES_DIR = path.join(os.homedir(), '.graphe', 'modules');
const dbs = new Map();
const modulePaths = new Map();
const dictColumnCache = new Map();

function init() {
  // Only load modules explicitly installed in ~/.graphe/modules/
  fs.mkdirSync(MODULES_DIR, { recursive: true });

  semanticIndex.init();

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
  modulePaths.clear();
  dictColumnCache.clear();

  for (const file of fs.readdirSync(MODULES_DIR)) {
    if (file.toLowerCase().endsWith('.sqlite3')) {
      const filePath = path.join(MODULES_DIR, file);
      try {
        const db = new Database(filePath, { readonly: true });
        const id = path.basename(file, path.extname(file));
        dbs.set(id, db);
        modulePaths.set(id, filePath);
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

function getModulePath(moduleId) {
  const modulePath = modulePaths.get(moduleId);
  if (!modulePath) throw new Error(`Module not found: ${moduleId}`);
  return modulePath;
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

function cleanVerseText(text) {
  if (!text) return '';
  return String(text)
    .replace(/<n>[\s\S]*?<\/n>/gi, '')
    .replace(/<pb\s*\/?>/gi, ' ')
    .replace(/<S>[\s\S]*?<\/S>/gi, ' ')
    .replace(/<f>[\s\S]*?<\/f>/gi, ' ')
    .replace(/<i>([\s\S]*?)<\/i>/gi, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function scoreLexical(row, parsed) {
  const verseText = cleanVerseText(row.text).toLowerCase();
  let matched = 0;
  let total = 0;

  for (const { number } of parsed.strongs) {
    total += 1;
    const pattern = `<S>${String(number)}</S>`;
    if (String(row.text).includes(pattern)) matched += 1;
  }

  for (const term of parsed.textTerms) {
    total += 1;
    if (verseText.includes(String(term).toLowerCase())) matched += 1;
  }

  if (total === 0) return 0;
  return matched / total;
}

function getModules() {
  const result = [];
  for (const [id, db] of dbs) {
    const info = {};
    try {
      const rows = db.prepare('SELECT name, value FROM info').all();
      for (const row of rows) info[row.name] = row.value;
    } catch (_) {}

    const type = hasDictionaryTable(db)
      ? 'dictionary'
      : hasCrossRefTable(db)
        ? 'crossreference'
        : 'bible';

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

async function searchVersesSemantic(moduleId, query, opts = {}) {
  const parsed = parseSearchQuery(query);
  if (parsed.textTerms.length === 0) {
    return { ready: true, mode: 'empty', results: [] };
  }

  const modulePath = getModulePath(moduleId);
  const semanticLimit = Number.isFinite(opts.limit) ? opts.limit : 5;
  const semanticResponse = await semanticIndex.search(moduleId, parsed.textPart, {
    modulePath,
    limit: Math.max(1, semanticLimit),
  });

  if (!semanticResponse.ready) {
    return { ready: false, mode: 'unavailable', reason: semanticResponse.reason, results: [] };
  }

  const sorted = [...semanticResponse.results].sort((a, b) => {
    if (a.bookNumber !== b.bookNumber) return a.bookNumber - b.bookNumber;
    if (a.chapter !== b.chapter) return a.chapter - b.chapter;
    return a.verse - b.verse;
  });

  return { ready: true, mode: 'semantic', results: sorted.slice(0, Math.max(1, semanticLimit)) };
}

async function searchVersesHybrid(moduleId, query, opts = {}) {
  const parsed = parseSearchQuery(query);
  if (parsed.strongs.length === 0 && parsed.textTerms.length === 0) {
    return { mode: 'empty', results: [] };
  }

  const lexicalLimit = Number.isFinite(opts.lexicalLimit) ? opts.lexicalLimit : 300;
  const semanticLimit = Number.isFinite(opts.semanticLimit) ? opts.semanticLimit : 300;
  const finalLimit = Number.isFinite(opts.limit) ? opts.limit : 200;

  const lexicalResults = lexicalSearch(moduleId, query, { limit: lexicalLimit });

  if (parsed.textTerms.length === 0) {
    return {
      mode: 'lexical-only',
      results: lexicalResults.slice(0, finalLimit).map((row) => ({
        ...row,
        source: 'lexical',
        score: 1,
      })),
    };
  }

  const modulePath = getModulePath(moduleId);
  const semanticResponse = await semanticIndex.search(moduleId, parsed.textPart, {
    modulePath,
    limit: semanticLimit,
  });

  if (!semanticResponse.ready) {
    return {
      mode: 'lexical-fallback',
      reason: semanticResponse.reason,
      results: lexicalResults.slice(0, finalLimit).map((row) => ({
        ...row,
        source: 'lexical',
        score: scoreLexical(row, parsed),
      })),
    };
  }

  const map = new Map();

  for (const row of lexicalResults) {
    const key = `${row.bookNumber}:${row.chapter}:${row.verse}`;
    map.set(key, {
      bookNumber: row.bookNumber,
      chapter: row.chapter,
      verse: row.verse,
      text: row.text,
      lexicalScore: scoreLexical(row, parsed),
      semanticScore: 0,
    });
  }

  for (const row of semanticResponse.results) {
    const key = `${row.bookNumber}:${row.chapter}:${row.verse}`;
    const existing = map.get(key);
    if (existing) {
      existing.semanticScore = Math.max(existing.semanticScore, row.semanticScore || 0);
    } else {
      map.set(key, {
        bookNumber: row.bookNumber,
        chapter: row.chapter,
        verse: row.verse,
        text: row.text,
        lexicalScore: 0,
        semanticScore: row.semanticScore || 0,
      });
    }
  }

  const ranked = Array.from(map.values())
    .map((row) => {
      const finalScore = 0.55 * row.lexicalScore + 0.45 * row.semanticScore;
      let source = 'hybrid';
      if (row.lexicalScore > 0 && row.semanticScore === 0) source = 'lexical';
      if (row.lexicalScore === 0 && row.semanticScore > 0) source = 'semantic';

      return {
        bookNumber: row.bookNumber,
        chapter: row.chapter,
        verse: row.verse,
        text: row.text,
        source,
        score: finalScore,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.bookNumber !== b.bookNumber) return a.bookNumber - b.bookNumber;
      if (a.chapter !== b.chapter) return a.chapter - b.chapter;
      return a.verse - b.verse;
    })
    .slice(0, finalLimit);

  let mode = 'hybrid';
  if (ranked.length > 0 && ranked.every((r) => r.source === 'semantic')) mode = 'semantic-only';
  else if (ranked.length > 0 && ranked.every((r) => r.source === 'lexical')) mode = 'lexical-only';

  return { mode, results: ranked };
}

function getSemanticIndexStatus(moduleId) {
  if (moduleId) {
    return semanticIndex.getStatus(moduleId, getModulePath(moduleId));
  }
  return semanticIndex.getStatus();
}

function buildSemanticIndex(moduleId) {
  return semanticIndex.startBuild(moduleId, getModulePath(moduleId));
}

function getSemanticIndexProgress(jobId) {
  return semanticIndex.getProgress(String(jobId));
}

function cancelSemanticIndexBuild(jobId) {
  return semanticIndex.cancelBuild(String(jobId));
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

module.exports = {
  init,
  getModules,
  getBooks,
  getAllBooks,
  getChapterCount,
  getChapter,
  searchVerses,
  searchVersesSemantic,
  searchVersesHybrid,
  getDictionaryEntry,
  lookupAllStrongDicts,
  searchDictionaryTopics,
  getDictionaryCognates,
  getSemanticIndexStatus,
  buildSemanticIndex,
  getSemanticIndexProgress,
  cancelSemanticIndexBuild,
  getCrossReferences,
  lookupAllCrossRefModules,
};

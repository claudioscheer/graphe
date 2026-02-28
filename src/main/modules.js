const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');

const MODULES_DIR = path.join(os.homedir(), '.graphe', 'modules');
const dbs = new Map();
const dictColumnCache = new Map();

function getBundledDataDir() {
  // In packaged app, extraResource puts 'data' alongside the asar
  if (process.resourcesPath) {
    const resourcePath = path.join(process.resourcesPath, 'data');
    if (fs.existsSync(resourcePath)) return resourcePath;
  }
  // In development, data is in project root
  return path.join(__dirname, '..', '..', 'data');
}

function init() {
  // Ensure ~/.graphe/modules/ exists
  fs.mkdirSync(MODULES_DIR, { recursive: true });

  // Copy bundled modules if not already present
  const bundledDir = getBundledDataDir();
  if (fs.existsSync(bundledDir)) {
    for (const file of fs.readdirSync(bundledDir)) {
      if (file.toLowerCase().endsWith('.sqlite3')) {
        const dest = path.join(MODULES_DIR, file);
        if (!fs.existsSync(dest)) {
          fs.copyFileSync(path.join(bundledDir, file), dest);
        }
      }
    }
  }

  // Scan and open all modules
  loadAll();
}

function loadAll() {
  for (const db of dbs.values()) {
    try { db.close(); } catch (_) {}
  }
  dbs.clear();

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

function getModules() {
  const result = [];
  for (const [id, db] of dbs) {
    const info = {};
    try {
      const rows = db.prepare('SELECT name, value FROM info').all();
      for (const row of rows) info[row.name] = row.value;
    } catch (_) {}

    const type = hasDictionaryTable(db) ? 'dictionary' : 'bible';

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
  const cols = rows.map(r => r.name);
  dictColumnCache.set(moduleId, cols);
  return cols;
}

function getDictionaryEntry(moduleId, topic) {
  const db = getDb(moduleId);
  const cols = getDictColumns(moduleId);
  const select = cols.join(', ');
  return db.prepare(`SELECT ${select} FROM dictionary WHERE topic = ?`).get(topic) || null;
}

function lookupAllStrongDicts(topic) {
  const results = [];
  for (const [id, db] of dbs) {
    if (!hasDictionaryTable(db)) continue;
    let isStrong = false;
    try {
      const row = db.prepare("SELECT value FROM info WHERE name = 'is_strong'").get();
      isStrong = row && row.value.toLowerCase() === 'true';
    } catch (_) {}
    if (!isStrong) continue;
    try {
      const entry = getDictionaryEntry(id, topic);
      if (entry) results.push({ moduleId: id, entry });
    } catch (_) {}
  }
  return results;
}

function searchDictionaryTopics(moduleId, prefix, limit) {
  const db = getDb(moduleId);
  return db.prepare(
    'SELECT topic FROM dictionary WHERE topic LIKE ? ORDER BY topic LIMIT ?'
  ).all(prefix + '%', limit || 20).map(r => r.topic);
}

function getDictionaryCognates(moduleId, strongsNumber) {
  const db = getDb(moduleId);
  try {
    const row = db.prepare(
      'SELECT group_id FROM cognate_strong_numbers WHERE strong_number = ? LIMIT 1'
    ).get(strongsNumber);
    if (!row) return [];
    return db.prepare(
      'SELECT strong_number FROM cognate_strong_numbers WHERE group_id = ? AND strong_number != ?'
    ).all(row.group_id, strongsNumber).map(r => r.strong_number);
  } catch (_) {
    return [];
  }
}

function getBooks(moduleId) {
  const db = getDb(moduleId);
  return db
    .prepare('SELECT book_number AS bookNumber, short_name AS shortName, long_name AS longName FROM books ORDER BY book_number')
    .all();
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
  if (!query) return [];

  // Extract strong:NUMBER tokens (with optional H/G prefix)
  const strongRegex = /strong:([HhGg]?)(\d+\w*)/gi;
  const strongs = [];
  let match;
  while ((match = strongRegex.exec(query)) !== null) {
    strongs.push({ prefix: match[1].toUpperCase(), number: match[2] });
  }

  // Extract remaining text terms
  const textPart = query.replace(/strong:[HhGg]?\d+\w*/gi, '').trim();
  const textTerms = textPart ? textPart.split(/\s+/).filter(t => t.length >= 2) : [];

  if (strongs.length === 0 && textTerms.length === 0) return [];

  // Build WHERE clause with AND conditions
  const conditions = [];
  const params = [];

  for (const { prefix, number } of strongs) {
    conditions.push("text LIKE '%<S>' || ? || '</S>%'");
    params.push(number);
    if (prefix === 'H') {
      conditions.push('book_number < 470');
    } else if (prefix === 'G') {
      conditions.push('book_number >= 470');
    }
  }

  for (const term of textTerms) {
    conditions.push("text LIKE '%' || ? || '%'");
    params.push(term);
  }

  const sql = `SELECT book_number AS bookNumber, chapter, verse, text FROM verses WHERE ${conditions.join(' AND ')} ORDER BY book_number, chapter, verse`;
  const db = getDb(moduleId);
  return db.prepare(sql).bind(...params).all();
}

module.exports = { init, getModules, getBooks, getChapterCount, getChapter, searchVerses, getDictionaryEntry, lookupAllStrongDicts, searchDictionaryTopics, getDictionaryCognates };

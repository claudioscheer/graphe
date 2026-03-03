const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');
const sqliteProvider = require('./modules/sqlite-provider');

const MODULES_DIR = path.join(os.homedir(), '.graphe', 'modules');
const handles = new Map();
const dictColumnCache = new Map();

function init() {
  fs.mkdirSync(MODULES_DIR, { recursive: true });
  loadAll();
}

function loadAll() {
  // Close existing handles
  for (const handle of handles.values()) {
    try {
      handle.db.close();
    } catch (_) {}
  }
  handles.clear();
  dictColumnCache.clear();

  for (const file of fs.readdirSync(MODULES_DIR)) {
    const filePath = path.join(MODULES_DIR, file);
    const rawExt = path.extname(file);
    const ext = rawExt.toLowerCase();
    const id = path.basename(file, rawExt);

    if (ext !== '.sqlite3') continue;

    try {
      const db = new Database(filePath, { readonly: true });
      handles.set(id, { format: 'sqlite3', db });
    } catch (err) {
      console.error(`Failed to open module ${file}:`, err.message);
    }
  }
}

function getHandle(moduleId) {
  const handle = handles.get(moduleId);
  if (!handle) throw new Error(`Module not found: ${moduleId}`);
  return handle;
}

const SUPPORTED_TYPES = new Set(['bible', 'dictionary', 'commentary', 'crossreference']);

function getModules() {
  const result = [];

  for (const [id, handle] of handles) {
    const info = sqliteProvider.getInfo(handle.db);
    const type = sqliteProvider.detectType(handle.db);
    if (!SUPPORTED_TYPES.has(type)) continue;

    const mod = {
      id,
      type,
      description: info.description || id,
      hasStrongs: (info.strong_numbers || '').toLowerCase() === 'true',
    };

    if (type === 'bible' && mod.hasStrongs) {
      mod.strongsPrefix = info.strong_numbers_prefix || null;
    }

    if (type === 'dictionary') {
      mod.isStrongDict = (info.is_strong || '').toLowerCase() === 'true';
      mod.language = info.language || null;
    }

    result.push(mod);
  }

  result.sort((a, b) => a.description.localeCompare(b.description));
  return result;
}

function getBooks(moduleId) {
  const handle = getHandle(moduleId);
  return sqliteProvider.getBooks(handle.db);
}

function getAllBooks() {
  const merged = new Map();

  for (const handle of handles.values()) {
    try {
      const rows = sqliteProvider.getBooks(handle.db);
      for (const row of rows) {
        if (!merged.has(row.bookNumber)) merged.set(row.bookNumber, row);
      }
    } catch (_) {}
  }

  return Array.from(merged.values()).sort((a, b) => a.bookNumber - b.bookNumber);
}

function getChapterCount(moduleId, bookNumber) {
  const handle = getHandle(moduleId);
  return sqliteProvider.getChapterCount(handle.db, bookNumber);
}

function getChapter(moduleId, bookNumber, chapter) {
  const handle = getHandle(moduleId);
  return sqliteProvider.getChapter(handle.db, bookNumber, chapter);
}

function searchVerses(moduleId, query) {
  const handle = getHandle(moduleId);
  return sqliteProvider.lexicalSearch(handle.db, query);
}

function getDictionaryEntry(moduleId, topic) {
  const handle = getHandle(moduleId);
  if (!dictColumnCache.has(moduleId)) {
    dictColumnCache.set(moduleId, sqliteProvider.getDictColumns(handle.db));
  }
  const cols = dictColumnCache.get(moduleId);
  return sqliteProvider.getDictionaryEntry(handle.db, cols, topic);
}

function lookupAllStrongDicts(topic, allowedModuleIds) {
  if (!allowedModuleIds || allowedModuleIds.length === 0) return [];
  const results = [];
  for (const id of allowedModuleIds) {
    const handle = handles.get(id);
    if (!handle || !sqliteProvider.hasDictionaryTable(handle.db)) continue;
    try {
      const entry = getDictionaryEntry(id, topic);
      if (entry) results.push({ moduleId: id, entry });
    } catch (_) {}
  }
  return results;
}

function searchDictionaryTopics(moduleId, prefix, limit) {
  const handle = getHandle(moduleId);
  return sqliteProvider.searchDictionaryTopics(handle.db, prefix, limit);
}

function getDictionaryCognates(moduleId, strongsNumber) {
  const handle = getHandle(moduleId);
  return sqliteProvider.getDictionaryCognates(handle.db, strongsNumber);
}

function getCrossReferences(moduleId, book, chapter) {
  const handle = getHandle(moduleId);
  return sqliteProvider.getCrossReferences(handle.db, book, chapter);
}

function lookupAllCrossRefModules(book, chapter, allowedModuleIds) {
  if (!allowedModuleIds || allowedModuleIds.length === 0) return [];
  const results = [];
  for (const id of allowedModuleIds) {
    const handle = handles.get(id);
    if (!handle || !sqliteProvider.hasCrossRefTable(handle.db)) continue;
    try {
      const refs = sqliteProvider.getCrossReferences(handle.db, book, chapter);
      for (const ref of refs) {
        results.push(ref);
      }
    } catch (_) {}
  }
  results.sort((a, b) => {
    if (a.verse !== b.verse) return a.verse - b.verse;
    return b.votes - a.votes;
  });
  return results;
}

function getCommentary(moduleId, bookNumber, chapter) {
  const handle = getHandle(moduleId);
  return sqliteProvider.getCommentary(handle.db, bookNumber, chapter);
}

function getCommentaryBooks(moduleId) {
  const handle = getHandle(moduleId);
  return sqliteProvider.getCommentaryBooks(handle.db);
}

function isValidModule(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.sqlite3') return false;
  return sqliteProvider.isValidModule(filePath);
}

function installFiles(filePaths) {
  const skipped = [];
  let copied = 0;
  for (const src of filePaths) {
    if (!isValidModule(src)) {
      skipped.push(path.basename(src));
      continue;
    }
    const dest = path.join(MODULES_DIR, path.basename(src));
    fs.copyFileSync(src, dest);
    copied++;
  }
  if (copied > 0) loadAll();
  return { copied, skipped };
}

module.exports = {
  init,
  installFiles,
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

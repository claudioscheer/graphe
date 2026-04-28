const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');
const sqliteProvider = require('./modules/sqlite-provider');
const morphologyResolver = require('./modules/morphology-resolver');

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
      handles.set(id, {
        format: 'sqlite3',
        db,
        filePath,
        info: sqliteProvider.getInfo(db),
        morphology: sqliteProvider.getMorphologyTableInfo(db),
      });
    } catch (err) {
      console.error(`Failed to open module ${file}:`, err.message);
    }
  }
}

function reload() {
  loadAll();
}

function getHandle(moduleId) {
  const handle = handles.get(moduleId);
  if (!handle) throw new Error(`Module not found: ${moduleId}`);
  return handle;
}

function deleteModule(moduleId) {
  const handle = getHandle(moduleId);
  const filePath = handle.filePath;

  try {
    handle.db.close();
  } catch (_) {}

  handles.delete(moduleId);
  dictColumnCache.delete(moduleId);
  try {
    fs.unlinkSync(filePath);
    return { deleted: true, moduleId };
  } finally {
    loadAll();
  }
}

function withWritableDb(moduleId, callback) {
  const handle = getHandle(moduleId);
  const db = new Database(handle.filePath);
  try {
    const result = callback(db);
    loadAll();
    return result;
  } finally {
    try {
      db.close();
    } catch (_) {}
  }
}

const SUPPORTED_TYPES = new Set(['bible', 'dictionary', 'commentary', 'crossreference']);

function getModules() {
  const result = [];

  for (const [id, handle] of handles) {
    const info = handle.info || sqliteProvider.getInfo(handle.db);
    const type = sqliteProvider.detectType(handle.db);
    if (!SUPPORTED_TYPES.has(type)) continue;
    const shortTitle = (info['short.title'] || info.short_title || '').trim();
    const description = (info.description || '').trim();
    const displayName = shortTitle || description || id;

    const mod = {
      id,
      type,
      displayName,
      shortTitle: shortTitle || null,
      description: description || id,
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

  const displayNameCounts = new Map();
  for (const mod of result) {
    const key = mod.displayName.toLocaleLowerCase();
    displayNameCounts.set(key, (displayNameCounts.get(key) || 0) + 1);
  }

  for (const mod of result) {
    const key = mod.displayName.toLocaleLowerCase();
    const count = displayNameCounts.get(key) || 0;
    mod.listLabel = count > 1 ? `${mod.displayName} (${mod.id})` : mod.displayName;
  }

  result.sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, { numeric: true, sensitivity: 'base' })
  );
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

function searchVerses(moduleId, query, opts) {
  const handle = getHandle(moduleId);
  return sqliteProvider.lexicalSearch(handle.db, query, opts);
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

function getDictionaryMeta(moduleId) {
  const handle = getHandle(moduleId);
  const type = sqliteProvider.detectType(handle.db);
  if (type !== 'dictionary') throw new Error(`Module is not a dictionary: ${moduleId}`);
  const info = sqliteProvider.getInfo(handle.db);
  const shortTitle = (info['short.title'] || info.short_title || '').trim();
  const description = (info.description || '').trim();
  const displayName = shortTitle || description || moduleId;
  return {
    id: moduleId,
    type: 'dictionary',
    displayName,
    shortTitle: shortTitle || null,
    description: description || moduleId,
    language: info.language || null,
    isStrongDict: (info.is_strong || '').toLowerCase() === 'true',
    info,
  };
}

function resolveMorphology(params = {}) {
  const { sourceModuleId, strongDictModuleId, morphCode, uiLanguage } = params;

  const bibleHandle = sourceModuleId ? handles.get(sourceModuleId) || null : null;
  const dictHandle = strongDictModuleId ? handles.get(strongDictModuleId) || null : null;

  if (bibleHandle && sqliteProvider.detectType(bibleHandle.db) !== 'bible') {
    throw new Error(`Module is not a Bible: ${sourceModuleId}`);
  }
  if (dictHandle && sqliteProvider.detectType(dictHandle.db) !== 'dictionary') {
    throw new Error(`Module is not a dictionary: ${strongDictModuleId}`);
  }

  return morphologyResolver.resolveMorphology({
    bibleHandle,
    dictHandle,
    morphCode,
    uiLanguage,
  });
}

function getDictionaryTopicCount(moduleId) {
  const handle = getHandle(moduleId);
  return sqliteProvider.getDictionaryTopicCount(handle.db);
}

function getDictionaryTopicsByPrefix(moduleId, prefix, limit, offset) {
  const handle = getHandle(moduleId);
  return sqliteProvider.getDictionaryTopicsByPrefix(handle.db, prefix, limit, offset);
}

function getDictionaryRandomTopics(moduleId, limit) {
  const handle = getHandle(moduleId);
  return sqliteProvider.getDictionaryRandomTopics(handle.db, limit);
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

function lookupAllReverseCrossRefs(bookTo, chapterTo, verseTo, allowedModuleIds) {
  if (!allowedModuleIds || allowedModuleIds.length === 0) return [];
  const results = [];
  for (const id of allowedModuleIds) {
    const handle = handles.get(id);
    if (!handle || !sqliteProvider.hasCrossRefTable(handle.db)) continue;
    try {
      const refs = sqliteProvider.getReverseCrossReferences(handle.db, bookTo, chapterTo, verseTo);
      for (const ref of refs) {
        results.push(ref);
      }
    } catch (_) {}
  }
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

function getCommentaryCoverage(moduleId) {
  const handle = getHandle(moduleId);
  return sqliteProvider.getCommentaryCoverage(handle.db);
}

function getModulePath(moduleId) {
  const handle = getHandle(moduleId);
  return handle.filePath;
}

function getEditableModuleState(moduleId) {
  const handle = getHandle(moduleId);
  const info = sqliteProvider.getInfo(handle.db);
  const type = sqliteProvider.detectType(handle.db);
  const tables = sqliteProvider.getEditableTableAvailability(handle.db);
  const rows = sqliteProvider.getInfoRows(handle.db);
  const books = sqliteProvider.getEditableBooks(handle.db);
  return {
    moduleId,
    modulePath: handle.filePath,
    type,
    info,
    tables,
    infoRows: rows,
    books,
  };
}

function saveInfoValue(moduleId, name, value) {
  return withWritableDb(moduleId, (db) => sqliteProvider.upsertInfoValue(db, name, value));
}

function deleteInfoValue(moduleId, name) {
  return withWritableDb(moduleId, (db) => sqliteProvider.deleteInfoKey(db, name));
}

function saveBookNames(moduleId, bookNumber, fields) {
  return withWritableDb(moduleId, (db) =>
    sqliteProvider.updateBookNames(db, Number(bookNumber), fields || {})
  );
}

function getVerseRecord(moduleId, bookNumber, chapter, verse) {
  const handle = getHandle(moduleId);
  return sqliteProvider.getVerseRecord(
    handle.db,
    Number(bookNumber),
    Number(chapter),
    Number(verse)
  );
}

function saveVerseText(moduleId, bookNumber, chapter, verse, text) {
  return withWritableDb(moduleId, (db) =>
    sqliteProvider.updateVerseText(db, Number(bookNumber), Number(chapter), Number(verse), text)
  );
}

function getCommentaryEntry(moduleId, bookNumber, chapter, verseFrom) {
  const handle = getHandle(moduleId);
  return sqliteProvider.getCommentaryEntry(
    handle.db,
    Number(bookNumber),
    Number(chapter),
    Number(verseFrom)
  );
}

function saveCommentaryText(moduleId, bookNumber, chapter, verseFrom, text) {
  return withWritableDb(moduleId, (db) =>
    sqliteProvider.updateCommentaryText(
      db,
      Number(bookNumber),
      Number(chapter),
      Number(verseFrom),
      text
    )
  );
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
  reload,
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
  getDictionaryMeta,
  resolveMorphology,
  getDictionaryTopicCount,
  getDictionaryTopicsByPrefix,
  getDictionaryRandomTopics,
  getCrossReferences,
  lookupAllCrossRefModules,
  lookupAllReverseCrossRefs,
  getCommentary,
  getCommentaryBooks,
  getCommentaryCoverage,
  getModulePath,
  getEditableModuleState,
  deleteModule,
  saveInfoValue,
  deleteInfoValue,
  saveBookNames,
  getVerseRecord,
  saveVerseText,
  getCommentaryEntry,
  saveCommentaryText,
};

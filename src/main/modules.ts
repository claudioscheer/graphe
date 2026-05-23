import Database, { type Database as DatabaseInstance } from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as morphologyResolver from './modules/morphology-resolver';
import * as sqliteProvider from './modules/sqlite-provider';

interface ModuleHandle {
  format: 'sqlite3';
  db: DatabaseInstance;
  filePath: string;
  info: Record<string, string>;
  morphology: ModuleMorphologyInfo | null;
}

interface ModuleListRecord extends ModuleRecord {
  shortTitle: string | null;
  description: string;
  listLabel?: string;
}

interface DictionaryLookupResult {
  moduleId: string;
  entry: DictionaryEntry;
}

interface DeleteModuleResult {
  deleted: boolean;
  moduleId: string;
}

interface InstallFilesResult {
  copied: number;
  skipped: string[];
}

interface EditableModuleStateResult {
  moduleId: string;
  modulePath: string;
  type: ModuleType;
  info: Record<string, string>;
  tables: EditableModuleTables;
  infoRows: EditableInfoRow[];
  books: BookRecord[];
}

interface ModuleMorphologyInfo {
  hasIndications: boolean;
  hasTopics: boolean;
  hasLanguageColumn: boolean;
}

const MODULES_DIR = path.join(os.homedir(), '.graphe', 'modules');
const handles = new Map<string, ModuleHandle>();
const dictColumnCache = new Map<string, string[]>();

function init(): void {
  fs.mkdirSync(MODULES_DIR, { recursive: true });
  loadAll();
}

function loadAll(): void {
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

function reload(): void {
  loadAll();
}

function getHandle(moduleId: string): ModuleHandle {
  const handle = handles.get(moduleId);
  if (!handle) throw new Error(`Module not found: ${moduleId}`);
  return handle;
}

function deleteModule(moduleId: string): DeleteModuleResult {
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

function withWritableDb<T>(moduleId: string, callback: (db: DatabaseInstance) => T): T {
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

function getModules(): ModuleListRecord[] {
  const result: ModuleListRecord[] = [];

  for (const [id, handle] of handles) {
    const info = handle.info || sqliteProvider.getInfo(handle.db);
    const type = sqliteProvider.detectType(handle.db);
    if (!SUPPORTED_TYPES.has(type)) continue;
    const shortTitle = (info['short.title'] || info.short_title || '').trim();
    const description = (info.description || '').trim();
    const displayName = shortTitle || description || id;

    const mod: ModuleListRecord = {
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

function getBooks(moduleId: string): BookRecord[] {
  const handle = getHandle(moduleId);
  return sqliteProvider.getBooks(handle.db);
}

function getAllBooks(): BookRecord[] {
  const merged = new Map<number, BookRecord>();

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

function getChapterCount(moduleId: string, bookNumber: number): number {
  const handle = getHandle(moduleId);
  return sqliteProvider.getChapterCount(handle.db, bookNumber);
}

function getChapter(moduleId: string, bookNumber: number, chapter: number): VerseRecord[] {
  const handle = getHandle(moduleId);
  return sqliteProvider.getChapter(handle.db, bookNumber, chapter);
}

function searchVerses(
  moduleId: string,
  query: string,
  opts?: { limit?: number }
): SearchResult[] {
  const handle = getHandle(moduleId);
  return sqliteProvider.lexicalSearch(handle.db, query, opts);
}

function getDictionaryEntry(moduleId: string, topic: string): DictionaryEntry | null {
  const handle = getHandle(moduleId);
  if (!dictColumnCache.has(moduleId)) {
    dictColumnCache.set(moduleId, sqliteProvider.getDictColumns(handle.db));
  }
  const cols = dictColumnCache.get(moduleId);
  return sqliteProvider.getDictionaryEntry(handle.db, cols, topic);
}

function lookupAllStrongDicts(
  topic: string,
  allowedModuleIds?: string[]
): DictionaryLookupResult[] {
  if (!allowedModuleIds || allowedModuleIds.length === 0) return [];
  const results: DictionaryLookupResult[] = [];
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

function searchDictionaryTopics(moduleId: string, prefix: string, limit: number): string[] {
  const handle = getHandle(moduleId);
  return sqliteProvider.searchDictionaryTopics(handle.db, prefix, limit);
}

function getDictionaryCognates(moduleId: string, strongsNumber: string): DictionaryCognate[] {
  const handle = getHandle(moduleId);
  return sqliteProvider.getDictionaryCognates(handle.db, strongsNumber);
}

function getDictionaryMeta(moduleId: string): ModuleListRecord & { info: Record<string, string> } {
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

function resolveMorphology(params: MorphologyRequest = {}): MorphologyResult | null {
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

function getDictionaryTopicCount(moduleId: string): number {
  const handle = getHandle(moduleId);
  return sqliteProvider.getDictionaryTopicCount(handle.db);
}

function getDictionaryTopicsByPrefix(
  moduleId: string,
  prefix: string,
  limit: number,
  offset: number
): string[] {
  const handle = getHandle(moduleId);
  return sqliteProvider.getDictionaryTopicsByPrefix(handle.db, prefix, limit, offset);
}

function getDictionaryRandomTopics(moduleId: string, limit: number): string[] {
  const handle = getHandle(moduleId);
  return sqliteProvider.getDictionaryRandomTopics(handle.db, limit);
}

function getCrossReferences(moduleId: string, book: number, chapter: number): CrossReference[] {
  const handle = getHandle(moduleId);
  return sqliteProvider.getCrossReferences(handle.db, book, chapter);
}

function lookupAllCrossRefModules(
  book: number,
  chapter: number,
  allowedModuleIds?: string[]
): CrossReference[] {
  if (!allowedModuleIds || allowedModuleIds.length === 0) return [];
  const results: CrossReference[] = [];
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

function lookupAllReverseCrossRefs(
  bookTo: number,
  chapterTo: number,
  verseTo: number,
  allowedModuleIds?: string[]
): CrossReference[] {
  if (!allowedModuleIds || allowedModuleIds.length === 0) return [];
  const results: CrossReference[] = [];
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

function getCommentary(moduleId: string, bookNumber: number, chapter: number): CommentaryEntry[] {
  const handle = getHandle(moduleId);
  return sqliteProvider.getCommentary(handle.db, bookNumber, chapter);
}

function getCommentaryBooks(moduleId: string): number[] {
  const handle = getHandle(moduleId);
  return sqliteProvider.getCommentaryBooks(handle.db);
}

function getCommentaryCoverage(moduleId: string): CommentaryCoverage {
  const handle = getHandle(moduleId);
  return sqliteProvider.getCommentaryCoverage(handle.db);
}

function getModulePath(moduleId: string): string {
  const handle = getHandle(moduleId);
  return handle.filePath;
}

function getEditableModuleState(moduleId: string): EditableModuleStateResult {
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

function saveInfoValue(moduleId: string, name: string, value: string): boolean {
  return withWritableDb(moduleId, (db) => {
    const result = sqliteProvider.upsertInfoValue(db, name, value);
    return result.updated || result.inserted;
  });
}

function deleteInfoValue(moduleId: string, name: string): boolean {
  return withWritableDb(moduleId, (db) => sqliteProvider.deleteInfoKey(db, name));
}

function saveBookNames(moduleId: string, bookNumber: number, fields: BookNameFields): boolean {
  return withWritableDb(moduleId, (db) =>
    sqliteProvider.updateBookNames(db, Number(bookNumber), fields || {})
  );
}

function getVerseRecord(
  moduleId: string,
  bookNumber: number,
  chapter: number,
  verse: number
): VerseRecord | null {
  const handle = getHandle(moduleId);
  return sqliteProvider.getVerseRecord(
    handle.db,
    Number(bookNumber),
    Number(chapter),
    Number(verse)
  );
}

function saveVerseText(
  moduleId: string,
  bookNumber: number,
  chapter: number,
  verse: number,
  text: string
): boolean {
  return withWritableDb(moduleId, (db) =>
    sqliteProvider.updateVerseText(db, Number(bookNumber), Number(chapter), Number(verse), text)
  );
}

function getCommentaryEntry(
  moduleId: string,
  bookNumber: number,
  chapter: number,
  verseFrom: number
): CommentaryEntry | null {
  const handle = getHandle(moduleId);
  return sqliteProvider.getCommentaryEntry(
    handle.db,
    Number(bookNumber),
    Number(chapter),
    Number(verseFrom)
  );
}

function saveCommentaryText(
  moduleId: string,
  bookNumber: number,
  chapter: number,
  verseFrom: number,
  text: string
): boolean {
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

function isValidModule(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.sqlite3') return false;
  return sqliteProvider.isValidModule(filePath);
}

function installFiles(filePaths: string[]): InstallFilesResult {
  const skipped: string[] = [];
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

export {
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

if (typeof module !== 'undefined') module.exports = {
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

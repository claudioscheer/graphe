/**
 * TheWord TWM provider — handles .twm commentary/dictionary modules (SQLite with RTF/RVF content).
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import Database, { type Database as DatabaseInstance } from 'better-sqlite3';
import rtfToHTML from '@iarna/rtf-to-html';
import { grapheToTwBook, twBookToGraphe } from './book-map.ts';

interface TableNameRow {
  name: string;
}

interface ConfigRow {
  name: string;
  value: string | number | null;
}

interface TopicRow {
  id: number;
  subject: string;
}

interface BibleLinkSearchRow {
  data: string | Buffer | null;
}

interface ContentSearchRow {
  data: Buffer | string | null;
}

interface BibleRefRow {
  topic_id: number;
  fvi: number;
  tvi: number | null;
}

interface ContentRow {
  data: string | Buffer | null;
}

interface TheWordTwmHandle {
  format: 'theword-twm';
  filePath: string;
  db: DatabaseInstance;
  config: Record<string, string>;
  hasContentSearch: boolean;
  topicBased: boolean;
  isDictionary: boolean;
  topicBookMap: Map<number, number[]>;
}

interface TheWordTwmModuleInfo {
  type: 'dictionary' | 'commentary';
  description: string;
  isStrongDict?: boolean;
  language?: string | null;
}

interface TheWordTwmCommentaryEntry {
  verseFrom: number;
  verseTo: number | null;
  chapterTo: number | null;
  text: string;
}

interface DictionaryEntryResult {
  topic: string;
  definition: string;
}

/**
 * Load a .twm file and return a handle.
 */
function load(filePath: string): TheWordTwmHandle | null {
  const db = new Database(filePath, { readonly: true });

  const tables = (db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as TableNameRow[]).map((r) => r.name);

  const hasConfig = tables.includes('config');
  const hasBibleRefs = tables.includes('bible_refs');
  const hasContent = tables.includes('content');
  const hasTopics = tables.includes('topics');
  const hasContentSearch = tables.includes('content_search');

  if (!hasConfig || !hasContent) {
    db.close();
    return null;
  }

  // Read config into key-value object
  const config: Record<string, string> = {};
  const configRows = db.prepare('SELECT name, value FROM config').all() as ConfigRow[];
  for (const row of configRows) {
    config[row.name] = String(row.value ?? '');
  }

  if (hasBibleRefs) {
    // Type=2: verse-indexed commentary
    return {
      format: 'theword-twm',
      filePath,
      db,
      config,
      hasContentSearch,
      topicBased: false,
      isDictionary: false,
      topicBookMap: new Map(),
    };
  }

  if (hasTopics && hasContentSearch) {
    // Type=3 (topic-based commentary) or type=1 (dictionary)
    const moduleType = config.type;

    if (moduleType === '1') {
      // Dictionary module — no book map needed
      return {
        format: 'theword-twm',
        filePath,
        db,
        config,
        hasContentSearch: true,
        topicBased: false,
        isDictionary: true,
        topicBookMap: new Map(),
      };
    }

    // Type=3: topic-based commentary — build book map
    const topicBookMap = buildTopicBookMap(db);
    return {
      format: 'theword-twm',
      filePath,
      db,
      config,
      hasContentSearch: true,
      topicBased: true,
      isDictionary: false,
      topicBookMap,
    };
  }

  db.close();
  return null;
}

/**
 * Collect all descendant topic IDs that have content_search entries.
 */
function collectDescendantContentIds(db: DatabaseInstance, parentId: number): number[] {
  const ids: number[] = [];
  const children = db
    .prepare('SELECT id FROM topics WHERE pid = ? ORDER BY rel_order')
    .all(parentId) as Pick<TopicRow, 'id'>[];
  for (const child of children) {
    const hasContent = db
      .prepare('SELECT 1 FROM content_search WHERE topic_id = ? LIMIT 1')
      .get(child.id);
    if (hasContent) ids.push(child.id);
    ids.push(...collectDescendantContentIds(db, child.id));
  }
  return ids;
}

/**
 * Build a map from Graphe book numbers to topic IDs for type=3 modules.
 * Returns Map<grapheBookNumber, topicId[]>.
 */
function buildTopicBookMap(db: DatabaseInstance): Map<number, number[]> {
  const bookMap = new Map<number, number[]>();

  // Get root topics that have content, ordered by rel_order
  let rootTopics = db
    .prepare(
      'SELECT id, subject FROM topics WHERE pid = 0 AND id IN (SELECT topic_id FROM content_search) ORDER BY rel_order'
    )
    .all() as TopicRow[];

  // Fallback: if no root topics have content, use all root topics whose
  // descendants have content (e.g. general books where roots are containers)
  if (rootTopics.length === 0) {
    const allRoots = db
      .prepare('SELECT id, subject FROM topics WHERE pid = 0 ORDER BY rel_order')
      .all() as TopicRow[];
    rootTopics = allRoots.filter((t) => collectDescendantContentIds(db, t.id).length > 0);
  }

  // Check if bible_link_search table exists
  let hasBibleLinkSearch = false;
  try {
    db.prepare('SELECT 1 FROM bible_link_search LIMIT 1').get();
    hasBibleLinkSearch = true;
  } catch (_) {}

  for (let pos = 0; pos < rootTopics.length; pos++) {
    const topic = rootTopics[pos];
    let grapheBook = null;

    if (hasBibleLinkSearch) {
      grapheBook = detectBookFromBibleLinks(db, topic.id);
    }

    // Fallback: sequential position → TW book number (1-based)
    if (grapheBook == null) {
      const twBook = pos + 1;
      grapheBook = twBookToGraphe(twBook);
    }

    if (grapheBook != null) {
      // Include the root topic itself if it has content, plus all descendants
      const topicIds = [];
      const rootHasContent = db
        .prepare('SELECT 1 FROM content_search WHERE topic_id = ? LIMIT 1')
        .get(topic.id);
      if (rootHasContent) topicIds.push(topic.id);
      topicIds.push(...collectDescendantContentIds(db, topic.id));

      if (topicIds.length > 0) {
        if (!bookMap.has(grapheBook)) {
          bookMap.set(grapheBook, []);
        }
        bookMap.get(grapheBook).push(...topicIds);
      }
    }
  }

  return bookMap;
}

/**
 * Detect which Graphe book a topic covers by parsing its bible_link_search data.
 * Returns the Graphe book number or null if no data.
 */
function detectBookFromBibleLinks(db: DatabaseInstance, topicId: number): number | null {
  try {
    const row = db.prepare('SELECT data FROM bible_link_search WHERE topic_id = ?').get(topicId) as
      | BibleLinkSearchRow
      | undefined;
    if (!row || !row.data) return null;

    const text = typeof row.data === 'string' ? row.data : String(row.data);

    // Parse entries like ,1.2.3,4 → book=1
    const bookCounts = new Map<number, number>();
    const entryPattern = /,(\d+)\.\d+\.\d+,/g;
    let match: RegExpExecArray | null;
    while ((match = entryPattern.exec(text)) !== null) {
      const twBook = parseInt(match[1], 10);
      bookCounts.set(twBook, (bookCounts.get(twBook) || 0) + 1);
    }

    if (bookCounts.size === 0) return null;

    // Find most frequent book
    let maxCount = 0;
    let maxBook: number | null = null;
    for (const [twBook, count] of bookCounts) {
      if (count > maxCount) {
        maxCount = count;
        maxBook = twBook;
      }
    }

    return maxBook != null ? twBookToGraphe(maxBook) : null;
  } catch (_) {
    return null;
  }
}

function getModuleInfo(handle: TheWordTwmHandle): TheWordTwmModuleInfo {
  const moduleType = handle.config.type;

  if (moduleType === '1' || handle.isDictionary) {
    const isStrong =
      handle.config.strong === '1' ||
      handle.config['strong.h'] === '1' ||
      handle.config['strong.g'] === '1';
    return {
      type: 'dictionary',
      description:
        handle.config.title || handle.config.description || path.basename(handle.filePath, '.twm'),
      isStrongDict: isStrong,
      language: handle.config.lang || null,
    };
  }

  return {
    type: 'commentary',
    description:
      handle.config.title || handle.config.description || path.basename(handle.filePath, '.twm'),
  };
}

/**
 * Convert RTF string to HTML body content.
 * Returns a promise that resolves to the HTML string.
 */
function convertRtfToHtml(rtfString: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    // Fix unsupported codepage 0 → 1252
    let rtf = rtfString.replace(/\\ansicpg0/g, '\\ansicpg1252');

    rtfToHTML.fromString(rtf, (err: Error | null, html: string): void => {
      if (err) {
        reject(err);
        return;
      }

      // Extract just the body content
      const bodyMatch = html.match(/<body>([\s\S]*)<\/body>/);
      const body = bodyMatch ? bodyMatch[1].trim() : html;

      resolve(body);
    });
  });
}

/**
 * Extract plain text from content_search table (UTF-16 LE encoded blobs).
 * Used as fallback for RVF content type.
 */
function isLikelyZlib(buf: Buffer): boolean {
  if (!Buffer.isBuffer(buf) || buf.length < 2) return false;
  if (buf[0] !== 0x78) return false;
  const cmf = buf[0];
  const flg = buf[1];
  // RFC1950 check: deflate method + checksum
  return (cmf & 0x0f) === 8 && ((cmf << 8) + flg) % 31 === 0;
}

function isLikelyUtf16LE(buf: Buffer): boolean {
  if (buf.length < 2) return false;
  // UTF-16LE BOM
  if (buf[0] === 0xff && buf[1] === 0xfe) return true;
  // Sample first ~20 byte-pairs; if ≥50% have a null high byte, it's UTF-16LE
  const pairs = Math.min(20, Math.floor(buf.length / 2));
  if (pairs === 0) return false;
  let nullHigh = 0;
  for (let i = 0; i < pairs; i++) {
    if (buf[i * 2 + 1] === 0x00) nullHigh++;
  }
  return nullHigh / pairs >= 0.5;
}

function decodeContentSearchBlob(raw: Buffer | string, compressedHint: boolean): string {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  let decoded: Buffer | null = null;

  if (compressedHint || isLikelyZlib(buf)) {
    try {
      decoded = zlib.inflateSync(buf);
    } catch (_) {
      decoded = null;
    }
  }

  const payload = decoded || buf;

  if (isLikelyUtf16LE(payload)) {
    return payload.toString('utf16le').replace(/^\ufeff/, '');
  }

  // Try UTF-8, fall back to Latin1 for legacy modules
  const text = payload.toString('utf8');
  if (text.includes('\ufffd')) {
    return payload.toString('latin1');
  }
  return text;
}

function extractPlainText(handle: TheWordTwmHandle, topicId: number): string | null {
  if (!handle.hasContentSearch) return null;
  try {
    const row = handle.db
      .prepare('SELECT CAST(data AS BLOB) AS data FROM content_search WHERE topic_id = ?')
      .get(topicId) as ContentSearchRow | undefined;
    if (!row || !row.data) return null;

    const isCompressed = String(handle.config.compressed || '').trim() === '1';
    const text = decodeContentSearchBlob(row.data, isCompressed);
    if (!text || !text.trim()) return null;

    // Wrap in basic HTML paragraph tags
    return text
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => `<p>${escapeHtml(line)}</p>`)
      .join('\n');
  } catch (_) {
    return null;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Get commentary entries for a book and chapter.
 */
async function getCommentary(
  handle: TheWordTwmHandle,
  bookNumber: number,
  chapter: number
): Promise<TheWordTwmCommentaryEntry[]> {
  if (handle.topicBased) {
    const topicIds = handle.topicBookMap.get(bookNumber);
    if (!topicIds || topicIds.length === 0) return [];

    const texts = topicIds
      .map((id: number) => extractPlainText(handle, id))
      .filter((text: string | null): text is string => Boolean(text));
    if (texts.length === 0) return [];

    return [{ verseFrom: 1, verseTo: null, chapterTo: null, text: texts.join('\n') }];
  }

  // Type=2 flow
  const bi = grapheToTwBook(bookNumber);
  if (bi < 0) return [];

  const rows = handle.db
    .prepare('SELECT topic_id, fvi, tvi FROM bible_refs WHERE bi = ? AND ci = ? ORDER BY fvi')
    .all(bi, chapter) as BibleRefRow[];

  if (rows.length === 0) return [];

  const configIsRtf = (handle.config['content.type'] || '').toLowerCase() === 'rtf';
  const results: TheWordTwmCommentaryEntry[] = [];

  for (const row of rows) {
    let text = '';

    try {
      const content = handle.db
        .prepare('SELECT data FROM content WHERE topic_id = ?')
        .get(row.topic_id) as ContentRow | undefined;

      if (content && content.data) {
        const dataStr = String(content.data);
        const isRtf = configIsRtf || dataStr.startsWith('{\\rtf');
        if (isRtf) {
          try {
            text = await convertRtfToHtml(dataStr);
          } catch (_) {
            // RTF conversion threw
          }
          if (!text) {
            text = extractPlainText(handle, row.topic_id) || escapeHtml(dataStr);
          }
        } else {
          // RVF or unknown format — use plain text from content_search
          text = extractPlainText(handle, row.topic_id) || '';
          // Fallback: try wrapping as RTF for RVF content without content_search
          if (!text && dataStr.trim()) {
            try {
              text = await convertRtfToHtml('{\\rtf1\\ansi\\deff0 ' + dataStr + '}');
            } catch (_) {
              text = escapeHtml(dataStr);
            }
          }
        }
      }
    } catch (_) {}

    if (text) {
      results.push({
        verseFrom: row.fvi,
        verseTo: row.tvi,
        chapterTo: null,
        text,
      });
    }
  }

  return results;
}

/**
 * Get list of book numbers that have commentary entries.
 */
function getCommentaryBooks(handle: TheWordTwmHandle): number[] {
  if (handle.topicBased) {
    return Array.from(handle.topicBookMap.keys());
  }

  const rows = handle.db
    .prepare('SELECT DISTINCT bi FROM bible_refs WHERE ci > 0 ORDER BY bi')
    .all() as Array<{ bi: number }>;

  return rows
    .map((r) => twBookToGraphe(r.bi))
    .filter((bn: number | null): bn is number => bn != null);
}

/**
 * Get a dictionary entry by topic string (e.g. "H1", "G5547").
 */
function getDictionaryEntry(handle: TheWordTwmHandle, topic: string): DictionaryEntryResult | null {
  try {
    const row = handle.db.prepare('SELECT id FROM topics WHERE subject = ?').get(topic) as
      | Pick<TopicRow, 'id'>
      | undefined;
    if (!row) return null;

    const text = extractPlainText(handle, row.id);
    return text ? { topic, definition: text } : null;
  } catch (_) {
    return null;
  }
}

/**
 * Search dictionary topics by prefix.
 */
function searchDictionaryTopics(
  handle: TheWordTwmHandle,
  prefix: string,
  limit?: number
): string[] {
  try {
    return (handle.db
      .prepare(
        'SELECT subject AS topic FROM topics WHERE pid = 0 AND subject LIKE ? ORDER BY subject LIMIT ?'
      )
      .all(prefix + '%', limit || 20) as Array<{ topic: string }>).map((r) => r.topic);
  } catch (_) {
    return [];
  }
}

/**
 * Check if module is a dictionary (type=1).
 */
function hasDictionaryTable(handle: TheWordTwmHandle): boolean {
  return handle.isDictionary === true;
}

function isValidFile(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false;
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.twm') return false;

    const db = new Database(filePath, { readonly: true });
    try {
      const tables = (db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as TableNameRow[]).map((r) => r.name);

      if (!tables.includes('config') || !tables.includes('content')) return false;

      // Accept: bible_refs (type=2) OR topics + content_search (type=3 / type=1)
      return (
        tables.includes('bible_refs') ||
        (tables.includes('topics') && tables.includes('content_search'))
      );
    } finally {
      db.close();
    }
  } catch (_) {
    return false;
  }
}

function close(handle: TheWordTwmHandle): void {
  try {
    handle.db.close();
  } catch (_) {}
}

export {
  load,
  getModuleInfo,
  getCommentary,
  getCommentaryBooks,
  getDictionaryEntry,
  searchDictionaryTopics,
  hasDictionaryTable,
  isValidFile,
  close,
  extractPlainText,
  convertRtfToHtml,
};

if (typeof module !== 'undefined') module.exports = {
  load,
  getModuleInfo,
  getCommentary,
  getCommentaryBooks,
  getDictionaryEntry,
  searchDictionaryTopics,
  hasDictionaryTable,
  isValidFile,
  close,
  extractPlainText,
  convertRtfToHtml,
};

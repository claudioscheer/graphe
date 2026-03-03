/**
 * TheWord Bible provider — handles plain-text .ont/.nt/.ot files.
 * Encrypted .ontx/.ntx/.otx files are detected and rejected with a clear error.
 */
const fs = require('fs');
const path = require('path');
const {
  GRAPHE_BOOK_NUMBERS,
  VERSES_PER_CHAPTER,
  BOOK_NAMES,
  NT_BOOK_OFFSET,
  buildVerseIndex,
} = require('./book-map');

const TOTAL_VERSES = 31102;
const NT_VERSES = 7957;
const OT_VERSES = TOTAL_VERSES - NT_VERSES;
const ENCRYPTED_MAGIC = 'TWENCBMOD';

function decodeTheWordText(rawBuf) {
  // UTF-8 BOM is authoritative for TheWord plain-text modules.
  if (rawBuf.length >= 3 && rawBuf[0] === 0xef && rawBuf[1] === 0xbb && rawBuf[2] === 0xbf) {
    return rawBuf.slice(3).toString('utf-8');
  }

  // Prefer strict UTF-8. If bytes are not valid UTF-8, fall back to latin1 for legacy modules.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(rawBuf);
  } catch (_) {
    return rawBuf.toString('latin1');
  }
}

function getBibleModuleKind(ext) {
  if (ext === '.nt' || ext === '.ntx') return 'nt';
  if (ext === '.ot' || ext === '.otx') return 'ot';
  if (ext === '.ont' || ext === '.ontx') return 'full';
  return null;
}

function inferScope(kind, totalLines) {
  const canNt = totalLines >= NT_VERSES;
  const canOt = totalLines >= OT_VERSES;
  const canFull = totalLines >= TOTAL_VERSES;

  if (kind === 'nt') {
    if (canNt) return 'nt';
    return null;
  }

  if (kind === 'ot') {
    if (canFull) return 'full';
    if (canOt) return 'ot';
    if (canNt) return 'nt';
    return null;
  }

  if (kind === 'full') {
    if (canFull) return 'full';
    if (canOt) return 'ot';
    if (canNt) return 'nt';
    return null;
  }

  return null;
}

function buildOtVerseIndex() {
  const index = new Map();
  let line = 0;
  for (let i = 0; i < NT_BOOK_OFFSET; i++) {
    const bookNumber = GRAPHE_BOOK_NUMBERS[i];
    const chapters = VERSES_PER_CHAPTER[i];
    const chapterMap = new Map();

    for (let ch = 0; ch < chapters.length; ch++) {
      chapterMap.set(ch + 1, { startLine: line, verseCount: chapters[ch] });
      line += chapters[ch];
    }

    index.set(bookNumber, chapterMap);
  }
  return index;
}

function getExpectedVerseCount(scope) {
  if (scope === 'nt') return NT_VERSES;
  if (scope === 'ot') return OT_VERSES;
  return TOTAL_VERSES;
}

function getVerseIndex(scope) {
  if (scope === 'nt') return buildVerseIndex(true);
  if (scope === 'ot') return buildOtVerseIndex();
  return buildVerseIndex(false);
}

function normalizeForPresenceCheck(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .trim();
}

function hasVisibleVerseText(rawLine) {
  const converted = convertTags(String(rawLine || ''));
  return normalizeForPresenceCheck(converted).length > 0;
}

/**
 * Convert TheWord inline tags to Graphe's <S> format.
 *
 * Input patterns:
 *   <wt>word<WH1234><WTmorph l="lemma">
 *   <wt>word<WG5678><WTmorph l="lemma">
 *   <wt>word<WH1234><WTmorph l="lemma"><WH5678><WTmorph l="lemma">  (multiple Strong's)
 *
 * Output:
 *   word<S morph="morph" lemma="lemma">H1234</S>
 */
function convertTags(line) {
  let result = line;

  // Strip section titles: <TS>...<Ts>
  result = result.replace(/<TS>[\s\S]*?<Ts>/gi, '');

  // Red letter: <FR>...<Fr> → keep text, strip tags
  result = result.replace(/<FR>/gi, '');
  result = result.replace(/<Fr>/gi, '');

  // OT quotations: <FO>...<Fo> → keep text, strip tags
  result = result.replace(/<FO>/gi, '');
  result = result.replace(/<Fo>/gi, '');

  // Italic: <FI>text<Fi> → <i>text</i>
  result = result.replace(/<FI>([\s\S]*?)<Fi>/gi, '<i>$1</i>');

  // Footnotes: <RF...>text<Rf> → <f>text</f>
  result = result.replace(/<RF[^>]*>([\s\S]*?)<Rf>/gi, '<f>$1</f>');

  // Variant readings: strip <V1{>...<V1}> blocks entirely
  result = result.replace(/<V1\{>[\s\S]*?<V1\}>/gi, '');
  // Strip remaining variant tags
  result = result.replace(/<V[12][^>]*>/gi, '');

  // Paragraph break: <CM> or <CL>
  result = result.replace(/<CM>/gi, '<pb/>');
  result = result.replace(/<CL>/gi, '<pb/>');

  // Convert <wt>word<WH/G####><WTmorph...> sequences to word<S ...>H/G####</S>
  // This regex matches a <wt> tag followed by the word and one or more Strong's+morph sequences
  result = result.replace(
    /<wt>([^<]*)((?:<W[HG]\d+\w*>(?:<WT[^>]*>)?)+)/gi,
    (_, word, strongsBlock) => {
      // Parse each Strong's number + optional morph/lemma from the block
      const strongsPattern = /<W([HG])(\d+\w*)>(?:<WT([^ >]*?)(?:\s+l="([^"]*)")?>)?/gi;
      let match;
      let tags = '';

      while ((match = strongsPattern.exec(strongsBlock)) !== null) {
        const prefix = match[1].toUpperCase();
        const number = match[2];
        const morph = match[3] || '';
        const lemma = match[4] || '';

        const attrs = [];
        if (morph) attrs.push(`morph="${morph}"`);
        if (lemma) attrs.push(`lemma="${lemma}"`);
        const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';

        tags += `<S${attrStr}>${prefix}${number}</S>`;
      }

      return word + tags;
    }
  );

  // Handle bare Strong's tags (modules without <wt> wrappers)
  result = result.replace(/<W([HG])(\d+\w*)>/gi, (_, prefix, number) => {
    return `<S>${prefix.toUpperCase()}${number}</S>`;
  });

  // Strip bare <H####> morphology codes
  result = result.replace(/<H\d+\w*>/gi, '');

  // Clean up any remaining <wt> tags without Strong's data
  result = result.replace(/<wt>/gi, '');
  // Clean up any orphaned <WT...> tags
  result = result.replace(/<WT[^>]*>/gi, '');
  // Clean up any orphaned <W[HG]...> tags
  result = result.replace(/<W[HG][^>]*>/gi, '');

  // Strip NB (no-break) tags
  result = result.replace(/<\/?NB>/gi, '');
  result = result.replace(/<\/?Nb>/gi, '');

  return result;
}

/**
 * Load a TheWord Bible text module and return a handle.
 */
function load(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const kind = getBibleModuleKind(ext);
  if (!kind) throw new Error(`Unsupported TheWord Bible extension: ${ext}`);

  const rawBuf = fs.readFileSync(filePath);
  const magic = rawBuf.slice(0, ENCRYPTED_MAGIC.length).toString('ascii');
  if (magic === ENCRYPTED_MAGIC) {
    throw new Error(
      'Encrypted TheWord Bible modules (.ontx/.ntx/.otx) are not supported for conversion'
    );
  }

  let raw = decodeTheWordText(rawBuf);
  // Strip BOM
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);

  const allLines = raw.split(/\r?\n/);
  // Remove trailing empty line if present
  if (allLines.length > 0 && allLines[allLines.length - 1] === '') allLines.pop();

  const scope = inferScope(kind, allLines.length);
  if (!scope) {
    throw new Error(
      `Invalid or truncated TheWord Bible module: expected at least ${NT_VERSES} verse lines, got ${allLines.length}`
    );
  }
  const expectedVerseCount = getExpectedVerseCount(scope);

  // Separate verse lines from metadata trailer
  const lines = allLines.slice(0, expectedVerseCount);
  const trailerLines = allLines.slice(expectedVerseCount);

  // Parse metadata from trailer: key=value lines
  const metadata = {};
  for (const tl of trailerLines) {
    const eq = tl.indexOf('=');
    if (eq > 0) {
      const key = tl.substring(0, eq).trim();
      const value = tl.substring(eq + 1).trim();
      metadata[key] = value;
    }
  }

  const verseIndex = getVerseIndex(scope);

  let nonEmptyVerseCount = 0;
  const presentBooks = new Set();
  const presentChapters = new Map();
  let hasOtText = false;
  let hasNtText = false;

  for (const [bookNumber, chapterMap] of verseIndex) {
    for (const [chapter, info] of chapterMap) {
      for (let v = 0; v < info.verseCount; v++) {
        const lineIdx = info.startLine + v;
        if (lineIdx >= lines.length) break;
        const rawText = lines[lineIdx];
        if (!hasVisibleVerseText(rawText)) continue;
        nonEmptyVerseCount++;
        presentBooks.add(bookNumber);
        if (bookNumber >= 470) hasNtText = true;
        else hasOtText = true;
        if (!presentChapters.has(bookNumber)) presentChapters.set(bookNumber, new Set());
        presentChapters.get(bookNumber).add(chapter);
      }
    }
  }

  const effectiveScope = hasOtText && hasNtText ? 'full' : hasOtText ? 'ot' : hasNtText ? 'nt' : scope;

  // Detect Strong's by checking a sample of lines for <WH or <WG patterns
  let hasStrongs = false;
  const sampleSize = Math.min(200, lines.length);
  for (let i = 0; i < sampleSize; i++) {
    if (/<W[HG]\d/.test(lines[i])) {
      hasStrongs = true;
      break;
    }
  }

  return {
    format: 'theword-bible',
    filePath,
    lines,
    metadata,
    verseIndex,
    scope,
    effectiveScope,
    isNtOnly: effectiveScope === 'nt',
    isOtOnly: effectiveScope === 'ot',
    presentBooks,
    presentChapters,
    nonEmptyVerseCount,
    hasStrongs,
  };
}

function getBooks(handle) {
  const presentBooks = handle.presentBooks || new Set();
  const filterByPresence = presentBooks.size > 0;
  const start = handle.isNtOnly ? NT_BOOK_OFFSET : 0;
  const end = handle.isOtOnly ? NT_BOOK_OFFSET : 66;
  const books = [];
  for (let i = start; i < end; i++) {
    const bn = GRAPHE_BOOK_NUMBERS[i];
    if (filterByPresence && !presentBooks.has(bn)) continue;
    books.push({
      bookNumber: bn,
      shortName: BOOK_NAMES[i].short,
      longName: BOOK_NAMES[i].long,
    });
  }
  return books;
}

function getChapterCount(handle, bookNumber) {
  if (handle.presentBooks && !handle.presentBooks.has(bookNumber)) return 0;
  if (handle.presentChapters && handle.presentChapters.has(bookNumber)) {
    return handle.presentChapters.get(bookNumber).size;
  }
  const chapterMap = handle.verseIndex.get(bookNumber);
  if (!chapterMap) return 0;
  return chapterMap.size;
}

function getChapter(handle, bookNumber, chapter) {
  if (handle.presentBooks && !handle.presentBooks.has(bookNumber)) return [];
  const chapterMap = handle.verseIndex.get(bookNumber);
  if (!chapterMap) return [];
  const info = chapterMap.get(chapter);
  if (!info) return [];

  const verses = [];
  for (let v = 0; v < info.verseCount; v++) {
    const lineIdx = info.startLine + v;
    if (lineIdx >= handle.lines.length) break;
    const rawText = handle.lines[lineIdx];
    const converted = convertTags(rawText);
    if (!normalizeForPresenceCheck(converted)) continue;
    verses.push({
      verse: v + 1,
      text: converted,
    });
  }
  return verses;
}

function searchVerses(handle, query) {
  const { strongs, textTerms } = require('./sqlite-provider').parseSearchQuery(query);
  if (strongs.length === 0 && textTerms.length === 0) return [];

  const results = [];

  for (const [bookNumber, chapterMap] of handle.verseIndex) {
    for (const [chapter, info] of chapterMap) {
      for (let v = 0; v < info.verseCount; v++) {
        const lineIdx = info.startLine + v;
        if (lineIdx >= handle.lines.length) continue;
        const rawLine = handle.lines[lineIdx];
        if (!hasVisibleVerseText(rawLine)) continue;

        // Check Strong's matches on raw line (before tag conversion)
        let allMatch = true;
        for (const { prefix, number } of strongs) {
          const pattern = new RegExp(`<W[HG]${number}>`, 'i');
          if (!pattern.test(rawLine)) {
            allMatch = false;
            break;
          }
          if (prefix === 'H' && bookNumber >= 470) {
            allMatch = false;
            break;
          }
          if (prefix === 'G' && bookNumber < 470) {
            allMatch = false;
            break;
          }
        }
        if (!allMatch) continue;

        // Check text terms (strip tags for matching)
        if (textTerms.length > 0) {
          const plainText = rawLine.replace(/<[^>]+>/g, '').toLowerCase();
          for (const term of textTerms) {
            if (!plainText.includes(term.toLowerCase())) {
              allMatch = false;
              break;
            }
          }
          if (!allMatch) continue;
        }

        const converted = convertTags(rawLine);
        if (!normalizeForPresenceCheck(converted)) continue;
        results.push({
          bookNumber,
          chapter,
          verse: v + 1,
          text: converted,
        });
      }
    }
  }

  return results;
}

function isValidFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const ext = path.extname(filePath).toLowerCase();
    const kind = getBibleModuleKind(ext);
    if (!kind) return false;

    // Read first few bytes to verify it looks like a TheWord file
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(512);
    const bytesRead = fs.readSync(fd, buf, 0, 512, 0);
    fs.closeSync(fd);

    const head = decodeTheWordText(buf.slice(0, bytesRead));
    // Encrypted modules are valid files, but not supported by this provider.
    if (head.slice(0, ENCRYPTED_MAGIC.length) === ENCRYPTED_MAGIC) return true;

    // Strip BOM
    const content = head.charCodeAt(0) === 0xfeff ? head.slice(1) : head;
    // Accept any non-empty content (verse count check in load() is the real validator)
    return /^(<wt>|<TS>|\s*\S)/i.test(content);
  } catch (_) {
    return false;
  }
}

module.exports = {
  load,
  getBooks,
  getChapterCount,
  getChapter,
  searchVerses,
  isValidFile,
  convertTags,
};

/**
 * MySword (.mybible) → MyBible SQLite3 converter.
 * Converts MySword Bible (.bbl.mybible) and Dictionary (.dct.mybible) files.
 */
const path = require('path');
const Database = require('better-sqlite3');
const myswordProvider = require('../mysword-provider');
const { twBookToGraphe, GRAPHE_BOOK_NUMBERS, BOOK_NAMES } = require('../book-map');

// ---------------------------------------------------------------------------
// Tag sanitization (same logic as theword-converter, kept independent)
// ---------------------------------------------------------------------------

function normalizeStrongNumber(value) {
  const match = String(value || '').match(/\d+/);
  return match ? match[0] : '';
}

function sanitizeStrongTags(text) {
  let tokenIndex = 0;
  const tokens = [];

  let result = String(text || '').replace(/<S[^>]*>[\s\S]*?<\/S>/gi, (pair) => {
    const contentMatch = pair.match(/^<S[^>]*>([\s\S]*?)<\/S>$/i);
    const rawInner = contentMatch ? contentMatch[1] : '';
    const innerText = rawInner.replace(/<[^>]+>/g, '');
    const number = normalizeStrongNumber(innerText);
    if (!number) return '';
    const token = `__GRAPHE_S_TOKEN_${tokenIndex++}__`;
    tokens.push({ token, value: `<S>${number}</S>` });
    return token;
  });

  result = result.replace(/<S[^>]*>/gi, '');
  result = result.replace(/<\/S>/gi, '');

  for (const { token, value } of tokens) {
    result = result.replaceAll(token, value);
  }

  return result;
}

function sanitizeSupportedTags(text) {
  const allowedOpenClose = new Set(['i', 'f', 'j', 'h', 'm', 'l']);
  const canonicalTag = (name) => (name === 'j' ? 'J' : name);
  return String(text || '').replace(/<[^>]*>/g, (tag) => {
    if (/^<pb\s*\/?>$/i.test(tag)) return '<pb/>';
    if (/^<(E|O|T|OG|OH|TG|TH|X)>$/.test(tag)) return tag;
    if (/^<(e|o|t|og|oh|tg|th|x)>$/.test(tag)) return tag;

    const closeMatch = tag.match(/^<\/\s*([a-z0-9]+)\s*>$/i);
    if (closeMatch) {
      const name = closeMatch[1].toLowerCase();
      if (name === 's') return '</S>';
      if (allowedOpenClose.has(name)) return `</${canonicalTag(name)}>`;
      return '';
    }

    const openMatch = tag.match(/^<\s*([a-z0-9]+)(?:\s+[^>]*)?\s*>$/i);
    if (!openMatch) return '';

    const name = openMatch[1].toLowerCase();
    if (name === 's') return '<S>';
    if (allowedOpenClose.has(name)) return `<${canonicalTag(name)}>`;
    return '';
  });
}

function normalizeConvertedVerse(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// MySword tag conversion
// ---------------------------------------------------------------------------

/**
 * Convert MySword inline tags to MyBible format.
 *
 * Key patterns found in .mybible files:
 *   - <WH1234> / <WG5678>  → Strong's numbers
 *   - <WG976><WTN-NSF l="βίβλος">  → Strong's + morphology + lemma
 *   - <W>1<w>  → word position (NOT Strong's, strip)
 *   - <T>text<t>, <G>text<g>, <Q>text<q>  → case-paired interlinear tags (pass through)
 *   - <HEB>..., <TRA>..., <SEP>..., <ACF>...  → language section labels (strip tags)
 *   - 「」  → word delimiters (strip)
 *   - <br> → line break
 */
function convertMySwordTags(text) {
  let result = String(text || '');

  // 1. Convert Strong's with optional morphology+lemma: <WH/G####><WTmorph l="lemma">
  result = result.replace(
    /<W([HG])(\d+)>(?:<WT([^ >]*?)(?:\s+l="([^"]*)")?>)?/gi,
    (_, _prefix, number, morph, lemma) => {
      const num = normalizeStrongNumber(number);
      if (!num) return '';
      let tags = `<S>${num}</S>`;
      if (morph) tags += `<m>${morph}</m>`;
      if (lemma) tags += `<l>${lemma}</l>`;
      return tags;
    }
  );

  // 1a. Strip variant readings (OGNTe: ＊<Vr>...</vr>)
  result = result.replace(/＊<Vr>[\s\S]*?<\/vr>/gi, '');
  result = result.replace(/＊/g, '');

  // 1b. Convert OGNTe brackets (discriminated by <Mn> inside)
  result = result.replace(/「([\s\S]*?)」/g, (match, inner) => {
    if (!/<Mn>/i.test(inner)) return match;

    const extractField = (tag) => {
      const m = inner.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
      return m ? m[1].replace(/<[^>]+>/g, '').trim() : '';
    };

    const greek = extractField('Mn');
    const translit = extractField('Tr');

    // Collect already-converted Strong's/morph/lemma from step 1
    const sMatch = inner.match(/<S>\d+<\/S>(?:<m>[^<]*<\/m>)?(?:<l>[^<]*<\/l>)?/);
    const strongs = sMatch ? sMatch[0] : '';

    // Build extended annotation fields
    const xParts = [];
    const pr = extractField('Cla');
    if (pr) xParts.push(`pr=${pr}`);
    const pbr = extractField('Pbr');
    if (pbr) xParts.push(`pbr=${pbr}`);
    const es = extractField('Es');
    if (es) xParts.push(`es=${es}`);
    const og = extractField('Og');
    if (og) xParts.push(`og=${og}`);

    // Louw-Nida: strip <a> tags, replace fullwidth comma
    const lnMatch = inner.match(/<LN>([\s\S]*?)<\/LN>/i);
    if (lnMatch) {
      const ln = lnMatch[1].replace(/<[^>]+>/g, '').replace(/，/g, ', ').trim();
      if (ln) xParts.push(`ln=${ln}`);
    }

    const gk = extractField('GN');
    if (gk) xParts.push(`gk=${gk}`);

    let out = '';
    if (greek) out += `<E>${greek}<e>`;
    if (translit) out += `<T>${translit}<t>`;
    out += strongs;
    if (xParts.length > 0) out += `<X>${xParts.join('|')}<x>`;
    return out;
  });

  // 1c. Clean inter-word separators before <E> tags
  result = result.replace(/,&?\s*(?=<E>)/g, ' ');

  // 2. Insert space at word boundaries: <q> closes a Hebrew word, <Q> opens one
  result = result.replace(/<q>/g, ' ');
  result = result.replace(/<Q>/g, '');

  // 3. Strip word-position tags <W>num<w> (NOT Strong's)
  result = result.replace(/<W>\d+<w>/gi, '');
  result = result.replace(/<W>\d+<\/w>/gi, '');

  // 4. Convert section labels to use non-breaking space (prevents line break after label)
  result = result.replace(/<(HEB|TRA|SEP|ACF|SBL|GRC)>([^<]*)<\/\1>/gi, (_, _tag, inner) => {
    return inner.replace(/\s+$/, '\u00a0');
  });
  // Strip remaining interlinear sub-tags, keep inner text
  result = result.replace(/<\/?(HEB|TRA|SEP|ACF|SBL|GRC|Tr|Cla|Mn|Wn|Ko|LN|GN|Pbr|Es|Og)>/gi, '');

  // 5. Convert <br> to <pb/>
  result = result.replace(/<br\s*\/?>/gi, '<pb/>');

  // 6. Convert NA28-style bracketed interlinear units:
  // 「<T>translit<t><G>greek<g>」→ <E>greek<e><T>translit<t>
  result = result.replace(
    /「([^」]*?)<G>([\s\S]*?)<g>([^」]*?)」/g,
    (_, before, greek, after) => {
      const combined = before + after;
      const translitMatch = combined.match(/<T>([\s\S]*?)<t>/i);
      const translit = translitMatch ? translitMatch[1] : '';
      let out = `<E>${greek}<e>`;
      if (translit) out += `<T>${translit}<t>`;
      return out + ' ';
    }
  );

  // Fallback: convert remaining <G>...<g> outside brackets to <E>...<e>
  result = result.replace(/<G>([\s\S]*?)<g>/gi, '<E>$1<e>');

  // 7. Strip Japanese quotation brackets (word delimiters)
  result = result.replace(/[「」]/g, '');

  // 8. Clean orphaned MySword tags
  result = result.replace(/<W[HG][^>]*>/gi, '');
  result = result.replace(/<WT[^>]*>/gi, '');

  // 9. Apply standard tag sanitization
  result = sanitizeSupportedTags(result);
  result = sanitizeStrongTags(result);

  // Collapse multiple spaces
  result = result.replace(/ {2,}/g, ' ');

  return result;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

function getEffectiveExtension(filePath) {
  const base = path.basename(filePath).toLowerCase();
  if (base.endsWith('.bbl.mybible')) return '.bbl.mybible';
  if (base.endsWith('.dct.mybible')) return '.dct.mybible';
  return path.extname(filePath).toLowerCase();
}

async function convert(inputPath, outputDir, onProgress) {
  const ext = getEffectiveExtension(inputPath);

  if (ext === '.bbl.mybible') {
    return convertBible(inputPath, outputDir, onProgress);
  }

  if (ext === '.dct.mybible') {
    return convertDictionary(inputPath, outputDir, onProgress);
  }

  throw new Error(`Unsupported MySword format: ${path.basename(inputPath)}`);
}

// ---------------------------------------------------------------------------
// Bible conversion
// ---------------------------------------------------------------------------

function convertBible(inputPath, outputDir, onProgress) {
  const handle = myswordProvider.load(inputPath);
  if (!handle || handle.type !== 'bible') {
    throw new Error(`Cannot load MySword Bible: ${path.basename(inputPath)}`);
  }

  const basename = path.basename(inputPath).replace(/\.bbl\.mybible$/i, '');
  const outputPath = path.join(outputDir, `${basename}.SQLite3`);

  const outDb = new Database(outputPath);
  try {
    outDb.pragma('journal_mode = DELETE');

    outDb.exec(`
      CREATE TABLE IF NOT EXISTS info (name TEXT, value TEXT);
      CREATE TABLE IF NOT EXISTS books (
        book_number INTEGER, book_color TEXT, short_name TEXT, long_name TEXT, sorting_order NUMERIC
      );
      CREATE TABLE IF NOT EXISTS verses (
        book_number INTEGER, chapter INTEGER, verse INTEGER, text TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS verses_index ON verses (book_number, chapter, verse);
    `);

    // Insert info from Details
    const details = handle.details;
    const displayName = details.title || details.description || details.abbreviation || basename;
    const insertInfo = outDb.prepare('INSERT INTO info (name, value) VALUES (?, ?)');
    outDb.transaction(() => {
      insertInfo.run('description', details.description || displayName);
      if (details.title) insertInfo.run('short.title', details.title);
      insertInfo.run('language', details.language || '');
      insertInfo.run('strong_numbers', handle.hasStrongs ? 'true' : 'false');
    })();

    // Query source verses
    const scriptureCol = handle.scriptureCol;
    const sourceVerses = handle.db
      .prepare(
        `SELECT Book, Chapter, Verse, "${scriptureCol}" as text FROM "${handle.bibleTable}" ORDER BY Book, Chapter, Verse`
      )
      .all();

    const insertVerse = outDb.prepare(
      'INSERT OR REPLACE INTO verses (book_number, chapter, verse, text) VALUES (?, ?, ?, ?)'
    );
    const insertBook = outDb.prepare(
      'INSERT INTO books (book_number, book_color, short_name, long_name, sorting_order) VALUES (?, ?, ?, ?, ?)'
    );

    const insertedBooks = new Set();
    let inserted = 0;
    let nonEmpty = 0;
    const total = sourceVerses.length;

    outDb.transaction(() => {
      for (const row of sourceVerses) {
        const grapheBook = twBookToGraphe(row.Book);
        if (grapheBook == null) continue;

        const converted = convertMySwordTags(row.text || '');
        insertVerse.run(grapheBook, row.Chapter, row.Verse, converted);
        inserted++;
        if (normalizeConvertedVerse(converted)) nonEmpty++;
        insertedBooks.add(grapheBook);

        if (onProgress && inserted % 1000 === 0) onProgress(inserted, total);
      }

      if (inserted === 0 || nonEmpty === 0) {
        throw new Error(
          `MySword module has no non-empty verse text: ${path.basename(inputPath)}`
        );
      }

      for (const grapheBook of insertedBooks) {
        const idx = GRAPHE_BOOK_NUMBERS.indexOf(grapheBook);
        if (idx >= 0) {
          insertBook.run(grapheBook, null, BOOK_NAMES[idx].short, BOOK_NAMES[idx].long, null);
        }
      }
    })();

    if (onProgress) onProgress(total, total);
  } finally {
    outDb.close();
    myswordProvider.close(handle);
  }

  return outputPath;
}

// ---------------------------------------------------------------------------
// Dictionary conversion
// ---------------------------------------------------------------------------

function convertDictionary(inputPath, outputDir, onProgress) {
  const handle = myswordProvider.load(inputPath);
  if (!handle || handle.type !== 'dictionary') {
    throw new Error(`Cannot load MySword Dictionary: ${path.basename(inputPath)}`);
  }

  const basename = path.basename(inputPath).replace(/\.dct\.mybible$/i, '');
  const outputPath = path.join(outputDir, `${basename}.dictionary.SQLite3`);

  const outDb = new Database(outputPath);
  try {
    outDb.pragma('journal_mode = DELETE');

    outDb.exec(`
      CREATE TABLE IF NOT EXISTS info (name TEXT, value TEXT);
      CREATE TABLE IF NOT EXISTS dictionary (
        topic TEXT, definition TEXT NOT NULL,
        short_definition TEXT, lexeme TEXT, transliteration TEXT, pronunciation TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_dictionary ON dictionary (topic);
    `);

    const details = handle.details;
    const isStrong = handle.isStrong;
    const insertInfo = outDb.prepare('INSERT INTO info (name, value) VALUES (?, ?)');
    outDb.transaction(() => {
      insertInfo.run('description', details.description || details.title || basename);
      insertInfo.run('language', details.language || '');
      insertInfo.run('is_strong', isStrong ? 'true' : 'false');
      insertInfo.run('type', isStrong ? 'strong lexicon' : 'explanatory');
    })();

    // Build query — include lexeme if available, order by relativeorder if available
    const dictTable = handle.dictTableName;
    const orderCol = handle.hasRelativeOrder ? 'relativeorder' : 'rowid';
    const selectCols = handle.hasLexeme
      ? `word, data, lexeme`
      : `word, data`;
    const entries = handle.db
      .prepare(`SELECT ${selectCols} FROM "${dictTable}" ORDER BY "${orderCol}"`)
      .all();

    const insertDict = outDb.prepare(
      'INSERT INTO dictionary (topic, definition, short_definition, lexeme, transliteration, pronunciation) VALUES (?, ?, ?, ?, ?, ?)'
    );
    let count = 0;
    const total = entries.length;

    outDb.transaction(() => {
      for (const entry of entries) {
        if (!entry.data) continue;
        insertDict.run(
          entry.word,
          entry.data,
          null,
          entry.lexeme || null,
          null,
          null
        );
        count++;
        if (onProgress && count % 100 === 0) onProgress(count, total);
      }
    })();

    if (onProgress) onProgress(total, total);
  } finally {
    outDb.close();
    myswordProvider.close(handle);
  }

  return outputPath;
}

module.exports = { convert, convertMySwordTags };

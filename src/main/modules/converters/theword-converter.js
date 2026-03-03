/**
 * TheWord → MyBible SQLite3 converter.
 * Converts TheWord Bible and .twm (commentary/dictionary) files.
 */
const path = require('path');
const Database = require('better-sqlite3');
const thewordBible = require('../theword-bible-provider');
const thewordTwm = require('../theword-twm-provider');
const { twBookToGraphe } = require('../book-map');

/**
 * Convert TheWord inline tags to MyBible format.
 *
 * Key differences from theword-bible-provider's convertTags():
 *   - Strong's: <S>1234</S> (number only, no H/G prefix) + <m>morph</m>
 *   - Red letter: <FR>...<Fr> → <J>...</J>
 *   - Other tags (italic, footnote, paragraph) same as Graphe's format
 */
function convertTagsToMyBible(line) {
  let result = line;

  // Convert TheWord ts2 titles to MyBible inline subheadings.
  result = result.replace(/<TS2>([\s\S]*?)<Ts>/gi, '<h>$1</h>');

  // Strip regular section titles: <TS>...<Ts>
  result = result.replace(/<TS>[\s\S]*?<Ts>/gi, '');

  // Red letter: <FR>...<Fr> → <J>...</J> (case-sensitive to distinguish open/close)
  result = result.replace(/<FR>/g, '<J>');
  result = result.replace(/<Fr>/g, '</J>');

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

  // Convert <wt>word<WH/G####><WTmorph l="lemma"> → word<S>####</S><m>morph</m>
  result = result.replace(
    /<wt>([^<]*)((?:<W[HG]\d+\w*>(?:<WT[^>]*>)?)+)/gi,
    (_, word, strongsBlock) => {
      const strongsPattern = /<W[HG](\d+\w*)>(?:<WT([^ >]*?)(?:\s+l="([^"]*)")?>)?/gi;
      let match;
      let tags = '';

      while ((match = strongsPattern.exec(strongsBlock)) !== null) {
        const number = match[1];
        const morph = match[2] || '';
        const lemma = match[3] || '';

        tags += `<S>${number}</S>`;
        if (morph) tags += `<m>${morph}</m>`;
        if (lemma) tags += `<l>${lemma}</l>`;
      }

      return word + tags;
    }
  );

  // Handle bare Strong's tags (modules without <wt> wrappers, e.g. ARA+)
  // <WH/G####> = Strong's number → <S>####</S>
  result = result.replace(/<W([HG])(\d+\w*)>/gi, (_, _prefix, number) => {
    return `<S>${number}</S>`;
  });

  // Strip bare <H####> morphology codes (TheWord tense/voice/mood markers)
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

function normalizeConvertedVerse(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .trim();
}

/**
 * Main entry point — dispatches based on file extension and module type.
 */
async function convert(inputPath, outputDir, onProgress) {
  const ext = path.extname(inputPath).toLowerCase();
  const bibleExts = new Set(['.ont', '.ontx', '.nt', '.ntx', '.ot', '.otx']);

  if (bibleExts.has(ext)) {
    return convertBible(inputPath, outputDir, onProgress);
  }

  if (ext === '.twm') {
    const handle = thewordTwm.load(inputPath);
    if (!handle) throw new Error(`Cannot load TWM module: ${path.basename(inputPath)}`);

    try {
      if (handle.isDictionary) {
        return await convertDictionary(handle, inputPath, outputDir, onProgress);
      }
      if (handle.topicBased) {
        return await convertCommentaryType3(handle, inputPath, outputDir, onProgress);
      }
      return await convertCommentaryType2(handle, inputPath, outputDir, onProgress);
    } finally {
      thewordTwm.close(handle);
    }
  }

  throw new Error(`Unsupported format: ${ext}`);
}

/**
 * Convert TheWord Bible file to MyBible .SQLite3.
 */
function convertBible(inputPath, outputDir, onProgress) {
  const handle = thewordBible.load(inputPath);
  const basename = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(outputDir, `${basename}.SQLite3`);

  const db = new Database(outputPath);
  try {
    db.pragma('journal_mode = DELETE');

    db.exec(`
      CREATE TABLE IF NOT EXISTS info (name TEXT, value TEXT);
      CREATE TABLE IF NOT EXISTS books (
        book_number INTEGER, book_color TEXT, short_name TEXT, long_name TEXT, sorting_order NUMERIC
      );
      CREATE TABLE IF NOT EXISTS verses (
        book_number INTEGER, chapter INTEGER, verse INTEGER, text TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS verses_index ON verses (book_number, chapter, verse);
    `);

    // Insert info
    const insertInfo = db.prepare('INSERT INTO info (name, value) VALUES (?, ?)');
    const shortTitle = handle.metadata['short.title'] || handle.metadata.short_title || '';
    const description = handle.metadata.description || '';
    const displayName = shortTitle || description || basename;
    const language = handle.metadata.lang || '';
    const hasStrongs = handle.hasStrongs ? 'true' : 'false';

    db.transaction(() => {
      insertInfo.run('description', description || displayName);
      if (shortTitle) insertInfo.run('short.title', shortTitle);
      insertInfo.run('language', language);
      insertInfo.run('strong_numbers', hasStrongs);
    })();

    // Insert verses
    const books = thewordBible.getBooks(handle);
    const insertBook = db.prepare(
      'INSERT INTO books (book_number, book_color, short_name, long_name, sorting_order) VALUES (?, ?, ?, ?, ?)'
    );
    const insertVerse = db.prepare(
      'INSERT INTO verses (book_number, chapter, verse, text) VALUES (?, ?, ?, ?)'
    );
    const insertedBooks = new Set();
    let scanned = 0;
    let inserted = 0;
    const total = handle.lines.length;

    db.transaction(() => {
      for (const [bookNumber, chapterMap] of handle.verseIndex) {
        for (const [chapter, info] of chapterMap) {
          for (let v = 0; v < info.verseCount; v++) {
            const lineIdx = info.startLine + v;
            if (lineIdx >= handle.lines.length) break;
            scanned++;
            const rawText = handle.lines[lineIdx];
            const converted = convertTagsToMyBible(rawText);
            if (!normalizeConvertedVerse(converted)) {
              if (onProgress && scanned % 1000 === 0) onProgress(scanned, total);
              continue;
            }
            insertVerse.run(bookNumber, chapter, v + 1, converted);
            inserted++;
            insertedBooks.add(bookNumber);
            if (onProgress && scanned % 1000 === 0) onProgress(scanned, total);
          }
        }
      }

      if (inserted === 0) {
        throw new Error(
          `TheWord module has no non-empty verse text: ${path.basename(inputPath)}`
        );
      }

      for (const book of books) {
        if (!insertedBooks.has(book.bookNumber)) continue;
        insertBook.run(book.bookNumber, null, book.shortName, book.longName, null);
      }
    })();

    if (onProgress) onProgress(total, total);
  } finally {
    db.close();
  }

  return outputPath;
}

/**
 * Convert type=2 (verse-indexed) commentary TWM to MyBible .SQLite3.
 */
async function convertCommentaryType2(handle, inputPath, outputDir, onProgress) {
  const basename = path.basename(inputPath, '.twm');
  const outputPath = path.join(outputDir, `${basename}.commentaries.SQLite3`);

  const db = new Database(outputPath);
  try {
    db.pragma('journal_mode = DELETE');

    db.exec(`
      CREATE TABLE IF NOT EXISTS info (name TEXT, value TEXT);
      CREATE TABLE IF NOT EXISTS commentaries (
        book_number INTEGER,
        chapter_number_from INTEGER,
        verse_number_from INTEGER,
        chapter_number_to INTEGER,
        verse_number_to INTEGER,
        is_preceding INTEGER,
        marker TEXT,
        text TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_commentaries ON commentaries (book_number, chapter_number_from);
    `);

    // Insert info
    const info = thewordTwm.getModuleInfo(handle);
    const insertInfo = db.prepare('INSERT INTO info (name, value) VALUES (?, ?)');
    db.transaction(() => {
      insertInfo.run('description', info.description);
      insertInfo.run('language', handle.config.lang || '');
    })();

    // Get all bible_refs rows
    const rows = handle.db
      .prepare('SELECT topic_id, bi, ci, fvi, tvi FROM bible_refs ORDER BY bi, ci, fvi')
      .all();

    const isRtf = (handle.config['content.type'] || '').toLowerCase() === 'rtf';
    const insertComm = db.prepare(
      'INSERT INTO commentaries (book_number, chapter_number_from, verse_number_from, chapter_number_to, verse_number_to, is_preceding, marker, text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );

    let count = 0;
    const total = rows.length;

    const batch = [];
    for (const row of rows) {
      const bookNumber = twBookToGraphe(row.bi);
      if (bookNumber == null) continue;

      let text = '';
      try {
        if (isRtf) {
          const content = handle.db
            .prepare('SELECT data FROM content WHERE topic_id = ?')
            .get(row.topic_id);
          if (content && content.data) {
            try {
              text = await thewordTwm.convertRtfToHtml(String(content.data));
            } catch (_) {
              text = thewordTwm.extractPlainText(handle, row.topic_id) || '';
            }
          }
        } else {
          text = thewordTwm.extractPlainText(handle, row.topic_id) || '';
        }
      } catch (_) {}

      if (!text) continue;

      batch.push({
        bookNumber,
        chapterFrom: row.ci,
        verseFrom: row.fvi,
        chapterTo: null,
        verseTo: row.tvi,
        text,
      });

      count++;
      if (onProgress && count % 100 === 0) {
        onProgress(count, total);
      }
    }

    db.transaction(() => {
      for (const entry of batch) {
        insertComm.run(
          entry.bookNumber,
          entry.chapterFrom,
          entry.verseFrom,
          entry.chapterTo,
          entry.verseTo,
          null,
          null,
          entry.text
        );
      }
    })();

    if (onProgress) onProgress(total, total);
  } finally {
    db.close();
  }

  return outputPath;
}

/**
 * Convert type=3 (topic-based) commentary TWM to MyBible .SQLite3.
 */
async function convertCommentaryType3(handle, inputPath, outputDir, onProgress) {
  const basename = path.basename(inputPath, '.twm');
  const outputPath = path.join(outputDir, `${basename}.commentaries.SQLite3`);

  const db = new Database(outputPath);
  try {
    db.pragma('journal_mode = DELETE');

    db.exec(`
      CREATE TABLE IF NOT EXISTS info (name TEXT, value TEXT);
      CREATE TABLE IF NOT EXISTS commentaries (
        book_number INTEGER,
        chapter_number_from INTEGER,
        verse_number_from INTEGER,
        chapter_number_to INTEGER,
        verse_number_to INTEGER,
        is_preceding INTEGER,
        marker TEXT,
        text TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_commentaries ON commentaries (book_number, chapter_number_from);
    `);

    const info = thewordTwm.getModuleInfo(handle);
    const insertInfo = db.prepare('INSERT INTO info (name, value) VALUES (?, ?)');
    db.transaction(() => {
      insertInfo.run('description', info.description);
      insertInfo.run('language', handle.config.lang || '');
    })();

    const insertComm = db.prepare(
      'INSERT INTO commentaries (book_number, chapter_number_from, verse_number_from, chapter_number_to, verse_number_to, is_preceding, marker, text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );

    const books = Array.from(handle.topicBookMap.entries());
    let count = 0;

    db.transaction(() => {
      for (const [bookNumber, topicIds] of books) {
        const texts = topicIds
          .map((id) => thewordTwm.extractPlainText(handle, id))
          .filter(Boolean);
        if (texts.length === 0) continue;

        const text = texts.join('\n');
        insertComm.run(bookNumber, 1, 1, null, null, null, null, text);

        count++;
        if (onProgress) onProgress(count, books.length);
      }
    })();

    if (onProgress) onProgress(books.length, books.length);
  } finally {
    db.close();
  }

  return outputPath;
}

/**
 * Convert dictionary TWM to MyBible .SQLite3.
 */
async function convertDictionary(handle, inputPath, outputDir, onProgress) {
  const basename = path.basename(inputPath, '.twm');
  const outputPath = path.join(outputDir, `${basename}.dictionary.SQLite3`);

  const db = new Database(outputPath);
  try {
    db.pragma('journal_mode = DELETE');

    db.exec(`
      CREATE TABLE IF NOT EXISTS info (name TEXT, value TEXT);
      CREATE TABLE IF NOT EXISTS dictionary (
        topic TEXT, definition TEXT NOT NULL,
        short_definition TEXT, lexeme TEXT, transliteration TEXT, pronunciation TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_dictionary ON dictionary (topic);
    `);

    const info = thewordTwm.getModuleInfo(handle);
    const isStrong = info.isStrongDict;
    const insertInfo = db.prepare('INSERT INTO info (name, value) VALUES (?, ?)');
    db.transaction(() => {
      insertInfo.run('description', info.description);
      insertInfo.run('language', info.language || '');
      insertInfo.run('is_strong', isStrong ? 'true' : 'false');
      insertInfo.run('type', isStrong ? 'strong lexicon' : 'explanatory');
    })();

    // Get root topics
    const topics = handle.db
      .prepare('SELECT id, subject FROM topics WHERE pid = 0 ORDER BY rel_order')
      .all();

    const insertDict = db.prepare(
      'INSERT INTO dictionary (topic, definition, short_definition, lexeme, transliteration, pronunciation) VALUES (?, ?, ?, ?, ?, ?)'
    );
    let count = 0;
    const total = topics.length;

    db.transaction(() => {
      for (const topic of topics) {
        const definition = thewordTwm.extractPlainText(handle, topic.id);
        if (!definition) continue;

        insertDict.run(topic.subject, definition, null, null, null, null);
        count++;
        if (onProgress && count % 100 === 0) {
          onProgress(count, total);
        }
      }
    })();

    if (onProgress) onProgress(total, total);
  } finally {
    db.close();
  }

  return outputPath;
}

module.exports = { convert, convertTagsToMyBible };

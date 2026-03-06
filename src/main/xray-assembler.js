const modules = require('./modules');

function extractStrongNumbers(verseText, defaultPrefix) {
  const numbers = [];
  if (!verseText) return numbers;

  const seen = new Set();

  // <S>H1234</S> or <S>1234</S>
  const sTagRe = /<S[^>]*>([GH]?\d+\w*)<\/S>/gi;
  let m;
  while ((m = sTagRe.exec(verseText)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    let num;
    if (/^[GH]/i.test(raw)) {
      num = raw.toUpperCase();
    } else {
      const digits = raw.match(/\d+/);
      if (digits) num = `${defaultPrefix || ''}${digits[0]}`;
    }
    if (num && !seen.has(num)) {
      seen.add(num);
      numbers.push(num);
    }
  }

  // <WH1234> or <WG5678>
  const wTagRe = /<W([HG])([^>]*)>/gi;
  while ((m = wTagRe.exec(verseText)) !== null) {
    const digits = (m[2] || '').match(/\d+/);
    if (!digits) continue;
    const num = `${m[1].toUpperCase()}${digits[0]}`;
    if (!seen.has(num)) {
      seen.add(num);
      numbers.push(num);
    }
  }

  return numbers;
}

function stripVerseMarkup(text) {
  if (!text) return '';
  return text
    .replace(/<S[^>]*>[\s\S]*?<\/S>/gi, '')
    .replace(/<W[HG][^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function assembleVerseDossier(params) {
  const { moduleId, bookNumber, chapter, verse } = params;
  const book = Number(bookNumber);
  const ch = Number(chapter);
  const vs = Number(verse);

  const allModules = modules.getModules();

  // Get primary verse
  let verseRecord;
  try {
    verseRecord = modules.getVerseRecord(moduleId, book, ch, vs);
  } catch (_) {
    verseRecord = null;
  }

  const primaryModule = allModules.find((m) => m.id === moduleId);

  // Get book name from books list
  let bookName = '';
  try {
    const books = modules.getBooks(moduleId);
    const bookInfo = books.find((b) => b.bookNumber === book);
    if (bookInfo) bookName = bookInfo.shortName || bookInfo.longName || '';
  } catch (_) {}
  if (!bookName) {
    try {
      const allBooks = modules.getAllBooks();
      const bookInfo = allBooks.find((b) => b.bookNumber === book);
      if (bookInfo) bookName = bookInfo.shortName || bookInfo.longName || '';
    } catch (_) {}
  }

  const reference = {
    moduleId,
    bookNumber: book,
    chapter: ch,
    verse: vs,
    bookName,
  };

  // Translation comparison
  const bibleModules = allModules.filter((m) => m.type === 'bible');
  const translations = [];
  for (const bm of bibleModules) {
    try {
      const rec = modules.getVerseRecord(bm.id, book, ch, vs);
      if (rec && rec.text) {
        translations.push({
          moduleId: bm.id,
          displayName: bm.displayName,
          text: rec.text,
          plainText: stripVerseMarkup(rec.text),
          hasStrongs: bm.hasStrongs,
          strongsPrefix: bm.strongsPrefix || (book < 470 ? 'H' : 'G'),
        });
      }
    } catch (_) {}
  }

  // Strong's word analysis
  const strongsPrefix = primaryModule?.strongsPrefix || (book < 470 ? 'H' : 'G');
  const verseText = verseRecord?.text || '';
  const strongNumbers = extractStrongNumbers(verseText, strongsPrefix);

  const dictModules = allModules.filter((m) => m.type === 'dictionary' && m.isStrongDict);
  const dictModuleIds = dictModules.map((m) => m.id);

  const words = [];
  for (const sn of strongNumbers) {
    const word = { strongsNumber: sn, dictEntries: [], morphology: null, cognates: [] };

    // Dictionary entries (include displayName from module metadata)
    try {
      const entries = modules.lookupAllStrongDicts(sn, dictModuleIds);
      word.dictEntries = (entries || []).map((e) => {
        const dm = dictModules.find((m) => m.id === e.moduleId);
        return { ...e, displayName: dm?.displayName || e.moduleId };
      });
    } catch (_) {}

    // Cognates from first dict that has them
    for (const dm of dictModules) {
      try {
        const cogs = modules.getDictionaryCognates(dm.id, sn);
        if (cogs && cogs.length > 0) {
          word.cognates = cogs;
          break;
        }
      } catch (_) {}
    }

    // Frequency: count occurrences across the primary module
    try {
      const results = modules.searchVerses(moduleId, `strong:${sn}`, { limit: 1000 });
      word.frequency = results ? results.length : 0;
    } catch (_) {
      word.frequency = 0;
    }

    words.push(word);
  }

  // Cross-references
  const crossRefModules = allModules.filter((m) => m.type === 'crossreference');
  const crossRefModuleIds = crossRefModules.map((m) => m.id);
  let crossRefs = [];
  try {
    const allRefs = modules.lookupAllCrossRefModules(book, ch, crossRefModuleIds);
    // Filter to this verse
    crossRefs = (allRefs || []).filter((r) => r.verse === vs);
    // Sort by votes descending
    crossRefs.sort((a, b) => (b.votes || 0) - (a.votes || 0));

    // Resolve book names for ALL cross-refs
    let allBooksForRefs = null;
    try {
      allBooksForRefs = modules.getAllBooks();
    } catch (_) {}
    for (const ref of crossRefs) {
      if (allBooksForRefs) {
        const bk = allBooksForRefs.find((b) => b.bookNumber === ref.bookTo);
        if (bk) ref.bookToName = bk.shortName || bk.longName || '';
      }
    }

    // Get preview text for top 20
    const previewCount = Math.min(crossRefs.length, 20);
    for (let i = 0; i < previewCount; i++) {
      const ref = crossRefs[i];
      try {
        const rec = modules.getVerseRecord(moduleId, ref.bookTo, ref.chapterTo, ref.verseToStart);
        if (rec && rec.text) {
          ref.previewText = stripVerseMarkup(rec.text);
        }
      } catch (_) {}
    }
  } catch (_) {}

  // Reverse cross-references (heat map)
  let reverseCrossRefs = [];
  try {
    reverseCrossRefs = modules.lookupAllReverseCrossRefs(book, ch, vs, crossRefModuleIds);
  } catch (_) {}

  const reverseCrossRefHeatMap = {};
  const reverseCrossRefsByBook = {};
  for (const ref of reverseCrossRefs) {
    if (!reverseCrossRefHeatMap[ref.book]) reverseCrossRefHeatMap[ref.book] = 0;
    reverseCrossRefHeatMap[ref.book]++;
    if (!reverseCrossRefsByBook[ref.book]) reverseCrossRefsByBook[ref.book] = [];
    reverseCrossRefsByBook[ref.book].push({
      chapter: ref.chapter,
      verse: ref.verse,
    });
  }

  // Commentaries
  const commentaryModules = allModules.filter((m) => m.type === 'commentary');
  const commentaries = [];
  for (const cm of commentaryModules) {
    try {
      const entries = modules.getCommentary(cm.id, book, ch);
      if (!entries || entries.length === 0) continue;
      // Filter entries that cover this verse
      const relevant = entries.filter((e) => {
        const from = e.verse_number_from || e.verseFrom || e.verse || 0;
        const to = e.verse_number_to || e.verseTo || from;
        return vs >= from && vs <= to;
      });
      if (relevant.length > 0) {
        commentaries.push({
          moduleId: cm.id,
          displayName: cm.displayName,
          entries: relevant,
        });
      }
    } catch (_) {}
  }

  // Chapter verse count (for prev/next navigation)
  let chapterVerseCount = 0;
  try {
    const chapterVerses = modules.getChapter(moduleId, book, ch);
    chapterVerseCount = chapterVerses ? chapterVerses.length : 0;
  } catch (_) {}

  // At a glance
  const atAGlance = {
    translationCount: translations.length,
    crossRefCount: crossRefs.length,
    commentaryCount: commentaries.length,
    strongsNumbers: strongNumbers,
    chapterVerseCount,
  };

  // Build book name map for renderer-side resolution
  const bookNameMap = {};
  try {
    const allBks = modules.getAllBooks();
    for (const b of allBks) {
      bookNameMap[b.bookNumber] = b.shortName || b.longName || '';
    }
  } catch (_) {}

  return {
    reference,
    primaryDisplayName: primaryModule?.displayName || moduleId,
    verseText,
    strongsPrefix,
    bookNameMap,
    translations,
    words,
    crossRefs,
    crossRefModuleIds,
    reverseCrossRefHeatMap,
    reverseCrossRefsByBook,
    commentaries,
    atAGlance,
  };
}

module.exports = { assembleVerseDossier };

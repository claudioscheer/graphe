/**
 * Canonical verse table and book number mapping between TheWord and Graphe formats.
 */

// Graphe book_number for each of the 66 books (index 0 = Genesis, index 65 = Revelation)
const GRAPHE_BOOK_NUMBERS = [
  10,
  20,
  30,
  40,
  50,
  60,
  70,
  80,
  90,
  100, // Gen-2Sam
  110,
  120,
  130,
  140,
  150,
  160,
  190,
  220,
  230,
  240, // 1Ki-Prov
  250,
  260,
  290,
  300,
  310,
  330,
  340,
  350,
  360,
  370, // Ecc-Amos
  380,
  390,
  400,
  410,
  420,
  430,
  440,
  450,
  460, // Obad-Mal
  470,
  480,
  490,
  500,
  510,
  520,
  530,
  540,
  550,
  560, // Matt-Eph
  570,
  580,
  590,
  600,
  610,
  620,
  630,
  640,
  650,
  660, // Phil-Jas
  670,
  680,
  690,
  700,
  710,
  720,
  730, // 1Pet-Rev
];

// KJV standard verse counts per chapter for all 66 books (total = 31,102)
const VERSES_PER_CHAPTER = [
  // Genesis (50 chapters)
  [
    31, 25, 24, 26, 32, 22, 24, 22, 29, 32, 32, 20, 18, 24, 21, 16, 27, 33, 38, 18, 34, 24, 20, 67,
    34, 35, 46, 22, 35, 43, 55, 32, 20, 31, 29, 43, 36, 30, 23, 23, 57, 38, 34, 34, 28, 34, 31, 22,
    33, 26,
  ],
  // Exodus (40 chapters)
  [
    22, 25, 22, 31, 23, 30, 25, 32, 35, 29, 10, 51, 22, 31, 27, 36, 16, 27, 25, 26, 36, 31, 33, 18,
    40, 37, 21, 43, 46, 38, 18, 35, 23, 35, 35, 38, 29, 31, 43, 38,
  ],
  // Leviticus (27 chapters)
  [
    17, 16, 17, 35, 19, 30, 38, 36, 24, 20, 47, 8, 59, 57, 33, 34, 16, 30, 37, 27, 24, 33, 44, 23,
    55, 46, 34,
  ],
  // Numbers (36 chapters)
  [
    54, 34, 51, 49, 31, 27, 89, 26, 23, 36, 35, 16, 33, 45, 41, 50, 13, 32, 22, 29, 35, 41, 30, 25,
    18, 65, 23, 31, 40, 16, 54, 42, 56, 29, 34, 13,
  ],
  // Deuteronomy (34 chapters)
  [
    46, 37, 29, 49, 33, 25, 26, 20, 29, 22, 32, 32, 18, 29, 23, 22, 20, 22, 21, 20, 23, 30, 25, 22,
    19, 19, 26, 68, 29, 20, 30, 52, 29, 12,
  ],
  // Joshua (24 chapters)
  [18, 24, 17, 24, 15, 27, 26, 35, 27, 43, 23, 24, 33, 15, 63, 10, 18, 28, 51, 9, 45, 34, 16, 33],
  // Judges (21 chapters)
  [36, 23, 31, 24, 31, 40, 25, 35, 57, 18, 40, 15, 25, 20, 20, 31, 13, 31, 30, 48, 25],
  // Ruth (4 chapters)
  [22, 23, 18, 22],
  // 1 Samuel (31 chapters)
  [
    28, 36, 21, 22, 12, 21, 17, 22, 27, 27, 15, 25, 23, 52, 35, 23, 58, 30, 24, 42, 15, 23, 29, 22,
    44, 25, 12, 25, 11, 31, 13,
  ],
  // 2 Samuel (24 chapters)
  [27, 32, 39, 12, 25, 23, 29, 18, 13, 19, 27, 31, 39, 33, 37, 23, 29, 33, 43, 26, 22, 51, 39, 25],
  // 1 Kings (22 chapters)
  [53, 46, 28, 34, 18, 38, 51, 66, 28, 29, 43, 33, 34, 31, 34, 34, 24, 46, 21, 43, 29, 53],
  // 2 Kings (25 chapters)
  [
    18, 25, 27, 44, 27, 33, 20, 29, 37, 36, 21, 21, 25, 29, 38, 20, 41, 37, 37, 21, 26, 20, 37, 20,
    30,
  ],
  // 1 Chronicles (29 chapters)
  [
    54, 55, 24, 43, 26, 81, 40, 40, 44, 14, 47, 40, 14, 17, 29, 43, 27, 17, 19, 8, 30, 19, 32, 31,
    31, 32, 34, 21, 30,
  ],
  // 2 Chronicles (36 chapters)
  [
    17, 18, 17, 22, 14, 42, 22, 18, 31, 19, 23, 16, 22, 15, 19, 14, 19, 34, 11, 37, 20, 12, 21, 27,
    28, 23, 9, 27, 36, 27, 21, 33, 25, 33, 27, 23,
  ],
  // Ezra (10 chapters)
  [11, 70, 13, 24, 17, 22, 28, 36, 15, 44],
  // Nehemiah (13 chapters)
  [11, 20, 32, 23, 19, 19, 73, 18, 38, 39, 36, 47, 31],
  // Esther (10 chapters)
  [22, 23, 15, 17, 14, 14, 10, 17, 32, 3],
  // Job (42 chapters)
  [
    22, 13, 26, 21, 27, 30, 21, 22, 35, 22, 20, 25, 28, 22, 35, 22, 16, 21, 29, 29, 34, 30, 17, 25,
    6, 14, 23, 28, 25, 31, 40, 22, 33, 37, 16, 33, 24, 41, 30, 24, 34, 17,
  ],
  // Psalms (150 chapters)
  [
    6, 12, 8, 8, 12, 10, 17, 9, 20, 18, 7, 8, 6, 7, 5, 11, 15, 50, 14, 9, 13, 31, 6, 10, 22, 12, 14,
    9, 11, 12, 24, 11, 22, 22, 28, 12, 40, 22, 13, 17, 13, 11, 5, 26, 17, 11, 9, 14, 20, 23, 19, 9,
    6, 7, 23, 13, 11, 11, 17, 12, 8, 12, 11, 10, 13, 20, 7, 35, 36, 5, 24, 20, 28, 23, 10, 12, 20,
    72, 13, 19, 16, 8, 18, 12, 13, 17, 7, 18, 52, 17, 16, 15, 5, 23, 11, 13, 12, 9, 9, 5, 8, 28, 22,
    35, 45, 48, 43, 13, 31, 7, 10, 10, 9, 8, 18, 19, 2, 29, 176, 7, 8, 9, 4, 8, 5, 6, 5, 6, 8, 8, 3,
    18, 3, 3, 21, 26, 9, 8, 24, 13, 10, 7, 12, 15, 21, 10, 20, 14, 9, 6,
  ],
  // Proverbs (31 chapters)
  [
    33, 22, 35, 27, 23, 35, 27, 36, 18, 32, 31, 28, 25, 35, 33, 33, 28, 24, 29, 30, 31, 29, 35, 34,
    28, 28, 27, 28, 27, 33, 31,
  ],
  // Ecclesiastes (12 chapters)
  [18, 26, 22, 16, 20, 12, 29, 17, 18, 20, 10, 14],
  // Song of Solomon (8 chapters)
  [17, 17, 11, 16, 16, 13, 13, 14],
  // Isaiah (66 chapters)
  [
    31, 22, 26, 6, 30, 13, 25, 22, 21, 34, 16, 6, 22, 32, 9, 14, 14, 7, 25, 6, 17, 25, 18, 23, 12,
    21, 13, 29, 24, 33, 9, 20, 24, 17, 10, 22, 38, 22, 8, 31, 29, 25, 28, 28, 25, 13, 15, 22, 26,
    11, 23, 15, 12, 17, 13, 12, 21, 14, 21, 22, 11, 12, 19, 12, 25, 24,
  ],
  // Jeremiah (52 chapters)
  [
    19, 37, 25, 31, 31, 30, 34, 22, 26, 25, 23, 17, 27, 22, 21, 21, 27, 23, 15, 18, 14, 30, 40, 10,
    38, 24, 22, 17, 32, 24, 40, 44, 26, 22, 19, 32, 21, 28, 18, 16, 18, 22, 13, 30, 5, 28, 7, 47,
    39, 46, 64, 34,
  ],
  // Lamentations (5 chapters)
  [22, 22, 66, 22, 22],
  // Ezekiel (48 chapters)
  [
    28, 10, 27, 17, 17, 14, 27, 18, 11, 22, 25, 28, 23, 23, 8, 63, 24, 32, 14, 49, 32, 31, 49, 27,
    17, 21, 36, 26, 21, 26, 18, 32, 33, 31, 15, 38, 28, 23, 29, 49, 26, 20, 27, 31, 25, 24, 23, 35,
  ],
  // Daniel (12 chapters)
  [21, 49, 30, 37, 31, 28, 28, 27, 27, 21, 45, 13],
  // Hosea (14 chapters)
  [11, 23, 5, 19, 15, 11, 16, 14, 17, 15, 12, 14, 16, 9],
  // Joel (3 chapters)
  [20, 32, 21],
  // Amos (9 chapters)
  [15, 16, 15, 13, 27, 14, 17, 14, 15],
  // Obadiah (1 chapter)
  [21],
  // Jonah (4 chapters)
  [17, 10, 10, 11],
  // Micah (7 chapters)
  [16, 13, 12, 13, 15, 16, 20],
  // Nahum (3 chapters)
  [15, 13, 19],
  // Habakkuk (3 chapters)
  [17, 20, 19],
  // Zephaniah (3 chapters)
  [18, 15, 20],
  // Haggai (2 chapters)
  [15, 23],
  // Zechariah (14 chapters)
  [21, 13, 10, 14, 11, 15, 14, 23, 17, 12, 17, 14, 9, 21],
  // Malachi (4 chapters)
  [14, 17, 18, 6],
  // Matthew (28 chapters)
  [
    25, 23, 17, 25, 48, 34, 29, 34, 38, 42, 30, 50, 58, 36, 39, 28, 27, 35, 30, 34, 46, 46, 39, 51,
    46, 75, 66, 20,
  ],
  // Mark (16 chapters)
  [45, 28, 35, 41, 43, 56, 37, 38, 50, 52, 33, 44, 37, 72, 47, 20],
  // Luke (24 chapters)
  [80, 52, 38, 44, 39, 49, 50, 56, 62, 42, 54, 59, 35, 35, 32, 31, 37, 43, 48, 47, 38, 71, 56, 53],
  // John (21 chapters)
  [51, 25, 36, 54, 47, 71, 53, 59, 41, 42, 57, 50, 38, 31, 27, 33, 26, 40, 42, 31, 25],
  // Acts (28 chapters)
  [
    26, 47, 26, 37, 42, 15, 60, 40, 43, 48, 30, 25, 52, 28, 41, 40, 34, 28, 41, 38, 40, 30, 35, 27,
    27, 32, 44, 31,
  ],
  // Romans (16 chapters)
  [32, 29, 31, 25, 21, 23, 25, 39, 33, 21, 36, 21, 14, 23, 33, 27],
  // 1 Corinthians (16 chapters)
  [31, 16, 23, 21, 13, 20, 40, 13, 27, 33, 34, 31, 13, 40, 58, 24],
  // 2 Corinthians (13 chapters)
  [24, 17, 18, 18, 21, 18, 16, 24, 15, 18, 33, 21, 14],
  // Galatians (6 chapters)
  [24, 21, 29, 31, 26, 18],
  // Ephesians (6 chapters)
  [23, 22, 21, 32, 33, 24],
  // Philippians (4 chapters)
  [30, 30, 21, 23],
  // Colossians (4 chapters)
  [29, 23, 25, 18],
  // 1 Thessalonians (5 chapters)
  [10, 20, 13, 18, 28],
  // 2 Thessalonians (3 chapters)
  [12, 17, 18],
  // 1 Timothy (6 chapters)
  [20, 15, 16, 16, 25, 21],
  // 2 Timothy (4 chapters)
  [18, 26, 17, 22],
  // Titus (3 chapters)
  [16, 15, 15],
  // Philemon (1 chapter)
  [25],
  // Hebrews (13 chapters)
  [14, 18, 19, 16, 14, 20, 28, 13, 28, 39, 40, 29, 25],
  // James (5 chapters)
  [27, 26, 18, 17, 20],
  // 1 Peter (5 chapters)
  [25, 25, 22, 19, 14],
  // 2 Peter (3 chapters)
  [21, 22, 18],
  // 1 John (5 chapters)
  [10, 29, 24, 21, 21],
  // 2 John (1 chapter)
  [13],
  // 3 John (1 chapter)
  [14],
  // Jude (1 chapter)
  [25],
  // Revelation (22 chapters)
  [20, 29, 22, 11, 14, 17, 17, 13, 21, 11, 19, 17, 18, 20, 8, 21, 18, 24, 21, 15, 27, 21],
];

// English book names (fallback when no module provides names)
const BOOK_NAMES = [
  { short: 'Gen', long: 'Genesis' },
  { short: 'Exo', long: 'Exodus' },
  { short: 'Lev', long: 'Leviticus' },
  { short: 'Num', long: 'Numbers' },
  { short: 'Deu', long: 'Deuteronomy' },
  { short: 'Jos', long: 'Joshua' },
  { short: 'Jdg', long: 'Judges' },
  { short: 'Rut', long: 'Ruth' },
  { short: '1Sa', long: '1 Samuel' },
  { short: '2Sa', long: '2 Samuel' },
  { short: '1Ki', long: '1 Kings' },
  { short: '2Ki', long: '2 Kings' },
  { short: '1Ch', long: '1 Chronicles' },
  { short: '2Ch', long: '2 Chronicles' },
  { short: 'Ezr', long: 'Ezra' },
  { short: 'Neh', long: 'Nehemiah' },
  { short: 'Est', long: 'Esther' },
  { short: 'Job', long: 'Job' },
  { short: 'Psa', long: 'Psalms' },
  { short: 'Pro', long: 'Proverbs' },
  { short: 'Ecc', long: 'Ecclesiastes' },
  { short: 'Sol', long: 'Song of Solomon' },
  { short: 'Isa', long: 'Isaiah' },
  { short: 'Jer', long: 'Jeremiah' },
  { short: 'Lam', long: 'Lamentations' },
  { short: 'Eze', long: 'Ezekiel' },
  { short: 'Dan', long: 'Daniel' },
  { short: 'Hos', long: 'Hosea' },
  { short: 'Joe', long: 'Joel' },
  { short: 'Amo', long: 'Amos' },
  { short: 'Oba', long: 'Obadiah' },
  { short: 'Jon', long: 'Jonah' },
  { short: 'Mic', long: 'Micah' },
  { short: 'Nah', long: 'Nahum' },
  { short: 'Hab', long: 'Habakkuk' },
  { short: 'Zep', long: 'Zephaniah' },
  { short: 'Hag', long: 'Haggai' },
  { short: 'Zec', long: 'Zechariah' },
  { short: 'Mal', long: 'Malachi' },
  { short: 'Mat', long: 'Matthew' },
  { short: 'Mar', long: 'Mark' },
  { short: 'Luk', long: 'Luke' },
  { short: 'Joh', long: 'John' },
  { short: 'Act', long: 'Acts' },
  { short: 'Rom', long: 'Romans' },
  { short: '1Co', long: '1 Corinthians' },
  { short: '2Co', long: '2 Corinthians' },
  { short: 'Gal', long: 'Galatians' },
  { short: 'Eph', long: 'Ephesians' },
  { short: 'Php', long: 'Philippians' },
  { short: 'Col', long: 'Colossians' },
  { short: '1Th', long: '1 Thessalonians' },
  { short: '2Th', long: '2 Thessalonians' },
  { short: '1Ti', long: '1 Timothy' },
  { short: '2Ti', long: '2 Timothy' },
  { short: 'Tit', long: 'Titus' },
  { short: 'Phm', long: 'Philemon' },
  { short: 'Heb', long: 'Hebrews' },
  { short: 'Jas', long: 'James' },
  { short: '1Pe', long: '1 Peter' },
  { short: '2Pe', long: '2 Peter' },
  { short: '1Jo', long: '1 John' },
  { short: '2Jo', long: '2 John' },
  { short: '3Jo', long: '3 John' },
  { short: 'Jud', long: 'Jude' },
  { short: 'Rev', long: 'Revelation' },
];

const NT_BOOK_OFFSET = 39;

// Reverse lookup: Graphe book_number → 0-based index
const _grapheToIndex = new Map();
for (let i = 0; i < GRAPHE_BOOK_NUMBERS.length; i++) {
  _grapheToIndex.set(GRAPHE_BOOK_NUMBERS[i], i);
}

function twBookToGraphe(bi) {
  return GRAPHE_BOOK_NUMBERS[bi - 1];
}

function grapheToTwBook(bookNumber) {
  const idx = _grapheToIndex.get(bookNumber);
  return idx != null ? idx + 1 : -1;
}

/**
 * Build a verse index mapping Graphe book numbers → chapter → {startLine, verseCount}.
 * Walks VERSES_PER_CHAPTER accumulating line offsets.
 * @param {boolean} isNtOnly - If true, only NT books (starting from index 39)
 * @returns {Map<number, Map<number, {startLine: number, verseCount: number}>>}
 */
function buildVerseIndex(isNtOnly) {
  const index = new Map();
  let line = 0;
  const startBook = isNtOnly ? NT_BOOK_OFFSET : 0;

  for (let i = startBook; i < 66; i++) {
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

module.exports = {
  GRAPHE_BOOK_NUMBERS,
  VERSES_PER_CHAPTER,
  BOOK_NAMES,
  NT_BOOK_OFFSET,
  twBookToGraphe,
  grapheToTwBook,
  buildVerseIndex,
};

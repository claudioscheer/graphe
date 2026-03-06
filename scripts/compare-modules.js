/**
 * Compare original TheWord modules with their converted MyBible (Graphe) SQLite3 counterparts.
 *
 * Usage: node scripts/compare-modules.js
 *
 * Reads both source TheWord modules and their converted outputs, comparing
 * verse counts, book lists, entry counts, and text content.
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const thewordBible = require('../src/main/modules/theword-bible-provider');
const thewordTwm = require('../src/main/modules/theword-twm-provider');
const { convertTagsToMyBible } = require('../src/main/modules/converters/theword-converter');

const BASE_DIR = path.join(__dirname, '..', 'test-the-word');
const INPUT_DIR = path.join(BASE_DIR, 'The Word');
const OUTPUT_DIR = path.join(BASE_DIR, 'Graphe');

const CATEGORIES = [
  { name: 'Bibles', subdir: 'Bibles' },
  { name: 'Books', subdir: 'Books' },
];

const BIBLE_EXTS = new Set(['.ont', '.nt', '.ot']);
const ENCRYPTED_EXTS = new Set(['.ontx', '.ntx', '.otx']);

function discoverFiles() {
  const supported = new Set(['.ont', '.ontx', '.nt', '.ntx', '.ot', '.otx', '.twm']);
  const files = [];
  for (const cat of CATEGORIES) {
    const dir = path.join(INPUT_DIR, cat.subdir);
    if (!fs.existsSync(dir)) continue;
    for (const filename of fs.readdirSync(dir)) {
      const ext = path.extname(filename).toLowerCase();
      if (!supported.has(ext)) continue;
      files.push({
        category: cat.name,
        subdir: cat.subdir,
        inputPath: path.join(dir, filename),
        filename,
      });
    }
  }
  return files;
}

function resolveOutputPath(inputPath, outputSubdir) {
  const ext = path.extname(inputPath).toLowerCase();
  const outputDir = path.join(OUTPUT_DIR, outputSubdir);

  if (ext !== '.twm') {
    const basename = path.basename(inputPath, path.extname(inputPath));
    return path.join(outputDir, `${basename}.SQLite3`);
  }

  // TWM — check which output type was generated
  const baseTwm = path.basename(inputPath, '.twm');
  const candidates = [
    path.join(outputDir, `${baseTwm}.commentaries.SQLite3`),
    path.join(outputDir, `${baseTwm}.dictionary.SQLite3`),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function detectOutputType(outputPath) {
  if (outputPath.endsWith('.commentaries.SQLite3')) return 'commentary';
  if (outputPath.endsWith('.dictionary.SQLite3')) return 'dictionary';
  return 'bible';
}

// --- Bible comparison ---

function compareBible(inputPath, outputPath) {
  const result = {
    type: 'bible',
    status: 'pass',
    issues: [],
    sourceVerseCount: 0,
    outputVerseCount: 0,
    sourceBookCount: 0,
    outputBookCount: 0,
  };

  let handle;
  try {
    handle = thewordBible.load(inputPath);
  } catch (err) {
    result.status = 'error';
    result.issues.push(`Cannot load source: ${err.message}`);
    return result;
  }

  const db = new Database(outputPath, { readonly: true });
  try {
    // Count source verses
    for (const [, chapterMap] of handle.verseIndex) {
      for (const [, info] of chapterMap) {
        result.sourceVerseCount += info.verseCount;
      }
    }

    // Count output verses
    result.outputVerseCount = db.prepare('SELECT COUNT(*) AS c FROM verses').get().c;

    if (result.sourceVerseCount !== result.outputVerseCount) {
      result.status = 'mismatch';
      result.issues.push(
        `Verse count: source=${result.sourceVerseCount}, output=${result.outputVerseCount}`
      );
    }

    // Book counts
    const sourceBooks = thewordBible.getBooks(handle);
    result.sourceBookCount = sourceBooks.length;
    result.outputBookCount = db.prepare('SELECT COUNT(*) AS c FROM books').get().c;

    if (result.sourceBookCount !== result.outputBookCount) {
      result.status = 'mismatch';
      result.issues.push(
        `Book count: source=${result.sourceBookCount}, output=${result.outputBookCount}`
      );
    }

    // Text content sampling — compare first 3 verses of first available book
    const firstBook = sourceBooks[0];
    if (firstBook) {
      const chapterMap = handle.verseIndex.get(firstBook.bookNumber);
      if (chapterMap) {
        const ch1 = chapterMap.get(1);
        if (ch1) {
          const sampleCount = Math.min(3, ch1.verseCount);
          for (let v = 0; v < sampleCount; v++) {
            const lineIdx = ch1.startLine + v;
            if (lineIdx >= handle.lines.length) break;
            const rawText = handle.lines[lineIdx];
            const expected = convertTagsToMyBible(rawText);
            const actual = db
              .prepare(
                'SELECT text FROM verses WHERE book_number = ? AND chapter = ? AND verse = ?'
              )
              .get(firstBook.bookNumber, 1, v + 1);
            if (!actual) {
              result.status = 'mismatch';
              result.issues.push(`Missing verse ${firstBook.bookNumber}:1:${v + 1} in output`);
            } else if (actual.text !== expected) {
              result.status = 'mismatch';
              result.issues.push(
                `Text mismatch at ${firstBook.bookNumber}:1:${v + 1} (first 100 chars): expected="${expected.slice(0, 100)}" got="${actual.text.slice(0, 100)}"`
              );
            }
          }
        }
      }
    }

    // Strong's flag
    const strongsInfo = db.prepare("SELECT value FROM info WHERE name = 'strong_numbers'").get();
    const outputHasStrongs = strongsInfo && strongsInfo.value === 'true';
    if (handle.hasStrongs !== outputHasStrongs) {
      result.status = 'mismatch';
      result.issues.push(`Strong's flag: source=${handle.hasStrongs}, output=${outputHasStrongs}`);
    }
  } finally {
    db.close();
  }

  return result;
}

// --- Commentary comparison ---

function compareCommentary(inputPath, outputPath) {
  const result = {
    type: 'commentary',
    status: 'pass',
    issues: [],
    sourceEntryCount: 0,
    outputEntryCount: 0,
  };

  let handle;
  try {
    handle = thewordTwm.load(inputPath);
    if (!handle) {
      result.status = 'error';
      result.issues.push('Cannot load source TWM');
      return result;
    }
  } catch (err) {
    result.status = 'error';
    result.issues.push(`Cannot load source: ${err.message}`);
    return result;
  }

  const db = new Database(outputPath, { readonly: true });
  try {
    // Output entry count
    result.outputEntryCount = db
      .prepare("SELECT COUNT(*) AS c FROM commentaries WHERE text IS NOT NULL AND text != ''")
      .get().c;

    // Source entry count (approximate — count bible_refs or topic-based entries)
    if (handle.topicBased) {
      for (const [, topicIds] of handle.topicBookMap) {
        const hasContent = topicIds.some((id) => thewordTwm.extractPlainText(handle, id));
        if (hasContent) result.sourceEntryCount++;
      }
    } else {
      const rows = handle.db.prepare('SELECT topic_id FROM bible_refs ORDER BY bi, ci, fvi').all();
      for (const row of rows) {
        const text = thewordTwm.extractPlainText(handle, row.topic_id);
        if (text) result.sourceEntryCount++;
      }
    }

    if (result.outputEntryCount === 0 && result.sourceEntryCount > 0) {
      result.status = 'mismatch';
      result.issues.push(
        `No entries in converted output (source has ${result.sourceEntryCount} entries)`
      );
    }

    // Book coverage
    const sourceBooks = thewordTwm.getCommentaryBooks(handle);
    const outputBooks = db
      .prepare('SELECT DISTINCT book_number FROM commentaries ORDER BY book_number')
      .all()
      .map((r) => r.book_number);

    if (sourceBooks.length !== outputBooks.length) {
      result.issues.push(
        `Book coverage: source=${sourceBooks.length} books, output=${outputBooks.length} books`
      );
      // Not necessarily a mismatch — some books may have no content
    }

    // Spot check: verify first entry has non-empty text (only if source has entries)
    if (result.sourceEntryCount > 0) {
      const firstEntry = db
        .prepare('SELECT text FROM commentaries WHERE text IS NOT NULL LIMIT 1')
        .get();
      if (!firstEntry || !firstEntry.text) {
        result.status = 'mismatch';
        result.issues.push('First commentary entry has empty text');
      }
    }
  } finally {
    db.close();
    thewordTwm.close(handle);
  }

  return result;
}

// --- Dictionary comparison ---

function compareDictionary(inputPath, outputPath) {
  const result = {
    type: 'dictionary',
    status: 'pass',
    issues: [],
    sourceTopicCount: 0,
    outputTopicCount: 0,
  };

  let handle;
  try {
    handle = thewordTwm.load(inputPath);
    if (!handle) {
      result.status = 'error';
      result.issues.push('Cannot load source TWM');
      return result;
    }
  } catch (err) {
    result.status = 'error';
    result.issues.push(`Cannot load source: ${err.message}`);
    return result;
  }

  const db = new Database(outputPath, { readonly: true });
  try {
    // Source topic count (root topics with content)
    result.sourceTopicCount = handle.db
      .prepare('SELECT COUNT(*) AS c FROM topics WHERE pid = 0')
      .get().c;

    // Output topic count
    result.outputTopicCount = db.prepare('SELECT COUNT(*) AS c FROM dictionary').get().c;

    if (result.outputTopicCount === 0) {
      result.status = 'mismatch';
      result.issues.push('No entries in converted dictionary');
    }

    // The output may have fewer entries if some topics had empty definitions
    if (result.outputTopicCount > result.sourceTopicCount) {
      result.status = 'mismatch';
      result.issues.push(
        `Output has more entries than source: source=${result.sourceTopicCount}, output=${result.outputTopicCount}`
      );
    }

    // Strong's flag check
    const info = thewordTwm.getModuleInfo(handle);
    const outputInfo = {};
    const infoRows = db.prepare('SELECT name, value FROM info').all();
    for (const row of infoRows) outputInfo[row.name] = row.value;

    const sourceIsStrong = info.isStrongDict;
    const outputIsStrong = outputInfo.is_strong === 'true';
    if (sourceIsStrong !== outputIsStrong) {
      result.status = 'mismatch';
      result.issues.push(`Strong's flag: source=${sourceIsStrong}, output=${outputIsStrong}`);
    }

    // Spot check: first 3 topics exist and have definitions
    const sampleTopics = handle.db
      .prepare('SELECT id, subject FROM topics WHERE pid = 0 ORDER BY rel_order LIMIT 3')
      .all();
    for (const topic of sampleTopics) {
      const entry = db
        .prepare('SELECT definition FROM dictionary WHERE topic = ?')
        .get(topic.subject);
      if (!entry) {
        // May be skipped if definition was empty
        const sourceDef = thewordTwm.extractPlainText(handle, topic.id);
        if (sourceDef) {
          result.issues.push(`Topic "${topic.subject}" missing in output but has source content`);
        }
      }
    }
  } finally {
    db.close();
    thewordTwm.close(handle);
  }

  return result;
}

// --- Main ---

function main() {
  const files = discoverFiles();
  const results = [];
  let passCount = 0;
  let mismatchCount = 0;
  let errorCount = 0;
  let notConvertedCount = 0;

  console.log(`Comparing ${files.length} modules...\n`);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const ext = path.extname(file.filename).toLowerCase();
    const label = `[${i + 1}/${files.length}]`;

    // Skip encrypted files — they were not converted
    if (ENCRYPTED_EXTS.has(ext)) {
      console.log(`${label} ${file.filename} ... SKIPPED (encrypted)`);
      notConvertedCount++;
      continue;
    }

    const outputPath = resolveOutputPath(file.inputPath, file.subdir);
    if (!outputPath || !fs.existsSync(outputPath)) {
      console.log(`${label} ${file.filename} ... NOT CONVERTED`);
      notConvertedCount++;
      continue;
    }

    process.stdout.write(`${label} ${file.filename} ...`);

    let comparison;
    try {
      if (BIBLE_EXTS.has(ext)) {
        comparison = compareBible(file.inputPath, outputPath);
      } else {
        const outputType = detectOutputType(outputPath);
        if (outputType === 'dictionary') {
          comparison = compareDictionary(file.inputPath, outputPath);
        } else {
          comparison = compareCommentary(file.inputPath, outputPath);
        }
      }
    } catch (err) {
      comparison = { type: 'unknown', status: 'error', issues: [err.message] };
    }

    comparison.filename = file.filename;
    comparison.category = file.category;
    results.push(comparison);

    if (comparison.status === 'pass') {
      passCount++;
      console.log(`\r${label} ${file.filename} ... PASS`);
    } else if (comparison.status === 'mismatch') {
      mismatchCount++;
      console.log(`\r${label} ${file.filename} ... MISMATCH`);
      for (const issue of comparison.issues) {
        console.log(`      ${issue}`);
      }
    } else {
      errorCount++;
      console.log(`\r${label} ${file.filename} ... ERROR`);
      for (const issue of comparison.issues) {
        console.log(`      ${issue}`);
      }
    }
  }

  // Summary
  console.log('\n=== Comparison Summary ===\n');
  console.log(`Total files:     ${files.length}`);
  console.log(`Pass:            ${passCount}`);
  console.log(`Mismatch:        ${mismatchCount}`);
  console.log(`Error:           ${errorCount}`);
  console.log(`Not converted:   ${notConvertedCount}`);

  if (mismatchCount > 0) {
    console.log('\nMismatches:');
    for (const r of results.filter((r) => r.status === 'mismatch')) {
      console.log(`  [${r.type}] ${r.filename}:`);
      for (const issue of r.issues) {
        console.log(`    - ${issue}`);
      }
    }
  }

  if (errorCount > 0) {
    console.log('\nErrors:');
    for (const r of results.filter((r) => r.status === 'error')) {
      console.log(`  [${r.type}] ${r.filename}:`);
      for (const issue of r.issues) {
        console.log(`    - ${issue}`);
      }
    }
  }

  // Write report
  const reportPath = path.join(OUTPUT_DIR, 'comparison-report.json');
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      { summary: { passCount, mismatchCount, errorCount, notConvertedCount }, results },
      null,
      2
    )
  );
  console.log(`\nReport written to ${reportPath}`);

  process.exit(mismatchCount > 0 || errorCount > 0 ? 1 : 0);
}

main();

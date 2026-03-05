/**
 * Batch-convert and verify ALL TheWord modules from the system-wide directory.
 *
 * Usage: node scripts/batch-convert-all.js
 *
 * Phase 1: Convert every module from ~/.graphe/modules/The Word/ into tmp-converted/
 * Phase 2: Verify conversion integrity (full per-verse comparison for Bibles)
 * Phase 3: Print summary and write JSON report
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const converterRegistry = require('../src/main/modules/converters');
const thewordBible = require('../src/main/modules/theword-bible-provider');
const thewordTwm = require('../src/main/modules/theword-twm-provider');
const { convertTagsToMyBible } = require('../src/main/modules/converters/theword-converter');

const INPUT_DIR = path.join(require('os').homedir(), '.graphe', 'modules', 'The Word');
const OUTPUT_DIR = path.join(__dirname, '..', 'tmp-converted');

const CATEGORIES = [
  { name: 'Bibles', subdir: 'Bibles' },
  { name: 'Books', subdir: 'Books' },
];

const BIBLE_EXTS = new Set(['.ont', '.nt', '.ot']);
const MAX_REPORTED_MISMATCHES = 50;

// ─── Discovery ───

function discoverFiles() {
  const supportedExts = new Set(converterRegistry.getSupportedExtensions());
  const files = [];

  for (const cat of CATEGORIES) {
    const dir = path.join(INPUT_DIR, cat.subdir);
    if (!fs.existsSync(dir)) continue;

    for (const filename of fs.readdirSync(dir)) {
      const ext = path.extname(filename).toLowerCase();
      if (!supportedExts.has(ext)) continue;
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

// ─── Phase 1: Convert ───

async function convertAll(files) {
  const successes = [];
  const skipped = [];
  const failures = [];

  if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, { recursive: true });
  }

  console.log(`\n=== Phase 1: Converting ${files.length} files ===\n`);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const outputDir = path.join(OUTPUT_DIR, file.subdir);
    fs.mkdirSync(outputDir, { recursive: true });

    const label = `[${i + 1}/${files.length}]`;
    process.stdout.write(`${label} ${file.filename} ...`);
    const startTime = Date.now();

    try {
      const outputPath = await converterRegistry.convertFile(
        file.inputPath,
        outputDir,
        (current, total) => {
          process.stdout.write(`\r${label} ${file.filename} ... ${current}/${total}`);
        }
      );
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const outputName = path.basename(outputPath);
      console.log(`\r${label} ${file.filename} -> ${outputName} (${elapsed}s)`);
      successes.push({
        filename: file.filename,
        category: file.category,
        subdir: file.subdir,
        outputName,
        outputPath,
        elapsed,
      });
    } catch (err) {
      const msg = err.message || String(err);

      if (/Encrypted TheWord/i.test(msg)) {
        console.log(`\r${label} ${file.filename} ... SKIPPED (encrypted)`);
        skipped.push({ filename: file.filename, category: file.category, reason: 'encrypted' });
      } else if (/Cannot load TWM module/i.test(msg)) {
        console.log(`\r${label} ${file.filename} ... SKIPPED (unsupported TWM type)`);
        skipped.push({ filename: file.filename, category: file.category, reason: 'unsupported TWM type' });
      } else if (/no non-empty verse text/i.test(msg)) {
        console.log(`\r${label} ${file.filename} ... SKIPPED (empty module)`);
        skipped.push({ filename: file.filename, category: file.category, reason: 'empty module' });
      } else {
        console.log(`\r${label} ${file.filename} ... FAILED: ${msg}`);
        failures.push({ filename: file.filename, category: file.category, error: msg });
      }
    }
  }

  return { successes, skipped, failures };
}

// ─── Phase 2: Verify ───

function detectOutputType(outputPath) {
  if (outputPath.endsWith('.commentaries.SQLite3')) return 'commentary';
  if (outputPath.endsWith('.dictionary.SQLite3')) return 'dictionary';
  return 'bible';
}

function verifyBible(inputPath, outputPath) {
  const result = {
    type: 'bible',
    status: 'pass',
    issues: [],
    sourceVerseCount: 0,
    outputVerseCount: 0,
    sourceBookCount: 0,
    outputBookCount: 0,
    textMismatches: 0,
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
    // Verse count
    for (const [, chapterMap] of handle.verseIndex) {
      for (const [, info] of chapterMap) {
        result.sourceVerseCount += info.verseCount;
      }
    }
    result.outputVerseCount = db.prepare('SELECT COUNT(*) AS c FROM verses').get().c;

    if (result.sourceVerseCount !== result.outputVerseCount) {
      result.status = 'mismatch';
      result.issues.push(
        `Verse count: source=${result.sourceVerseCount}, output=${result.outputVerseCount}`
      );
    }

    // Book count
    const sourceBooks = thewordBible.getBooks(handle);
    result.sourceBookCount = sourceBooks.length;
    result.outputBookCount = db.prepare('SELECT COUNT(*) AS c FROM books').get().c;

    if (result.sourceBookCount !== result.outputBookCount) {
      result.status = 'mismatch';
      result.issues.push(
        `Book count: source=${result.sourceBookCount}, output=${result.outputBookCount}`
      );
    }

    // Full per-verse text comparison
    const getVerse = db.prepare(
      'SELECT text FROM verses WHERE book_number = ? AND chapter = ? AND verse = ?'
    );

    for (const [bookNumber, chapterMap] of handle.verseIndex) {
      for (const [chapter, info] of chapterMap) {
        for (let v = 0; v < info.verseCount; v++) {
          const lineIdx = info.startLine + v;
          if (lineIdx >= handle.lines.length) break;
          const rawText = handle.lines[lineIdx];
          const expected = convertTagsToMyBible(rawText);
          const verse = v + 1;
          const actual = getVerse.get(bookNumber, chapter, verse);

          if (!actual) {
            result.textMismatches++;
            if (result.textMismatches <= MAX_REPORTED_MISMATCHES) {
              result.issues.push(`Missing verse ${bookNumber}:${chapter}:${verse} in output`);
            }
          } else if (actual.text !== expected) {
            result.textMismatches++;
            if (result.textMismatches <= MAX_REPORTED_MISMATCHES) {
              result.issues.push(
                `Text mismatch at ${bookNumber}:${chapter}:${verse}: expected="${expected.slice(0, 80)}" got="${actual.text.slice(0, 80)}"`
              );
            }
          }
        }
      }
    }

    if (result.textMismatches > 0) {
      result.status = 'mismatch';
      if (result.textMismatches > MAX_REPORTED_MISMATCHES) {
        result.issues.push(
          `... and ${result.textMismatches - MAX_REPORTED_MISMATCHES} more text mismatches`
        );
      }
    }

    // Strong's flag
    const strongsInfo = db.prepare("SELECT value FROM info WHERE name = 'strong_numbers'").get();
    const outputHasStrongs = strongsInfo && strongsInfo.value === 'true';
    if (handle.hasStrongs !== outputHasStrongs) {
      result.status = 'mismatch';
      result.issues.push(
        `Strong's flag: source=${handle.hasStrongs}, output=${outputHasStrongs}`
      );
    }
  } finally {
    db.close();
  }

  return result;
}

function verifyCommentary(inputPath, outputPath) {
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
    result.outputEntryCount = db
      .prepare("SELECT COUNT(*) AS c FROM commentaries WHERE text IS NOT NULL AND text != ''")
      .get().c;

    if (handle.topicBased) {
      for (const [, topicIds] of handle.topicBookMap) {
        const hasContent = topicIds.some((id) => thewordTwm.extractPlainText(handle, id));
        if (hasContent) result.sourceEntryCount++;
      }
    } else {
      const rows = handle.db
        .prepare('SELECT topic_id FROM bible_refs ORDER BY bi, ci, fvi')
        .all();
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
    }

    // No empty text entries check
    const emptyCount = db
      .prepare("SELECT COUNT(*) AS c FROM commentaries WHERE text IS NULL OR text = ''")
      .get().c;
    if (emptyCount > 0) {
      result.issues.push(`${emptyCount} empty text entries in output`);
    }
  } finally {
    db.close();
    thewordTwm.close(handle);
  }

  return result;
}

function verifyDictionary(inputPath, outputPath) {
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
    result.sourceTopicCount = handle.db
      .prepare('SELECT COUNT(*) AS c FROM topics WHERE pid = 0')
      .get().c;

    result.outputTopicCount = db.prepare('SELECT COUNT(*) AS c FROM dictionary').get().c;

    if (result.outputTopicCount === 0) {
      result.status = 'mismatch';
      result.issues.push('No entries in converted dictionary');
    }

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
      result.issues.push(
        `Strong's flag: source=${sourceIsStrong}, output=${outputIsStrong}`
      );
    }

    // Spot-check first 3 topics
    const sampleTopics = handle.db
      .prepare('SELECT id, subject FROM topics WHERE pid = 0 ORDER BY rel_order LIMIT 3')
      .all();
    for (const topic of sampleTopics) {
      const entry = db
        .prepare('SELECT definition FROM dictionary WHERE topic = ?')
        .get(topic.subject);
      if (!entry) {
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

function verifyAll(successes) {
  const verifications = [];

  console.log(`\n=== Phase 2: Verifying ${successes.length} conversions ===\n`);

  for (let i = 0; i < successes.length; i++) {
    const entry = successes[i];
    const label = `[${i + 1}/${successes.length}]`;
    const inputPath = path.join(INPUT_DIR, entry.subdir, entry.filename);

    process.stdout.write(`${label} ${entry.filename} ...`);

    let verification;
    try {
      const ext = path.extname(entry.filename).toLowerCase();
      if (BIBLE_EXTS.has(ext)) {
        verification = verifyBible(inputPath, entry.outputPath);
      } else {
        const outputType = detectOutputType(entry.outputPath);
        if (outputType === 'dictionary') {
          verification = verifyDictionary(inputPath, entry.outputPath);
        } else {
          verification = verifyCommentary(inputPath, entry.outputPath);
        }
      }
    } catch (err) {
      verification = { type: 'unknown', status: 'error', issues: [err.message] };
    }

    verification.filename = entry.filename;
    verification.category = entry.category;
    verification.outputName = entry.outputName;
    verifications.push(verification);

    if (verification.status === 'pass') {
      console.log(`\r${label} ${entry.filename} ... PASS`);
    } else if (verification.status === 'mismatch') {
      console.log(`\r${label} ${entry.filename} ... MISMATCH`);
      for (const issue of verification.issues) {
        console.log(`      ${issue}`);
      }
    } else {
      console.log(`\r${label} ${entry.filename} ... ERROR`);
      for (const issue of verification.issues) {
        console.log(`      ${issue}`);
      }
    }
  }

  return verifications;
}

// ─── Phase 3: Report ───

function printReport(conversion, verifications) {
  const { successes, skipped, failures } = conversion;
  const total = successes.length + skipped.length + failures.length;

  let passCount = 0;
  let mismatchCount = 0;
  let errorCount = 0;
  for (const v of verifications) {
    if (v.status === 'pass') passCount++;
    else if (v.status === 'mismatch') mismatchCount++;
    else errorCount++;
  }

  console.log('\n=== Combined Summary ===\n');
  console.log('Conversion:');
  console.log(`  Total files:  ${total}`);
  console.log(`  Converted:    ${successes.length}`);
  console.log(`  Skipped:      ${skipped.length}`);
  console.log(`  Failed:       ${failures.length}`);

  if (skipped.length > 0) {
    const byReason = {};
    for (const s of skipped) {
      byReason[s.reason] = (byReason[s.reason] || 0) + 1;
    }
    console.log('  Skipped breakdown:');
    for (const [reason, count] of Object.entries(byReason)) {
      console.log(`    ${reason}: ${count}`);
    }
  }

  if (failures.length > 0) {
    console.log('  Failures:');
    for (const f of failures) {
      console.log(`    ${f.filename}: ${f.error}`);
    }
  }

  console.log('\nVerification:');
  console.log(`  Verified:     ${verifications.length}`);
  console.log(`  Pass:         ${passCount}`);
  console.log(`  Mismatch:     ${mismatchCount}`);
  console.log(`  Error:        ${errorCount}`);

  if (mismatchCount > 0) {
    console.log('\n  Mismatches:');
    for (const r of verifications.filter((v) => v.status === 'mismatch')) {
      console.log(`    [${r.type}] ${r.filename}:`);
      for (const issue of r.issues) {
        console.log(`      - ${issue}`);
      }
    }
  }

  if (errorCount > 0) {
    console.log('\n  Errors:');
    for (const r of verifications.filter((v) => v.status === 'error')) {
      console.log(`    [${r.type}] ${r.filename}:`);
      for (const issue of r.issues) {
        console.log(`      - ${issue}`);
      }
    }
  }

  // Write JSON report
  const report = {
    conversion: {
      total,
      converted: successes.length,
      skipped: skipped.length,
      failed: failures.length,
      failures,
      skippedDetails: skipped,
    },
    verification: {
      total: verifications.length,
      pass: passCount,
      mismatch: mismatchCount,
      error: errorCount,
      details: verifications,
    },
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const reportPath = path.join(OUTPUT_DIR, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport written to ${reportPath}`);

  return failures.length > 0 || mismatchCount > 0 || errorCount > 0;
}

// ─── Main ───

async function main() {
  const files = discoverFiles();
  console.log(`Found ${files.length} files in ${INPUT_DIR}`);

  const conversion = await convertAll(files);
  const verifications = verifyAll(conversion.successes);
  const hasIssues = printReport(conversion, verifications);

  process.exit(hasIssues ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});

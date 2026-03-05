/**
 * Batch-convert all TheWord modules to MyBible (Graphe) SQLite3 format.
 *
 * Usage: node scripts/batch-convert.js
 *
 * Scans test-the-word/The Word/{Bibles,Books}/ and converts each supported
 * file into test-the-word/Graphe/{Bibles,Books}/.
 */
const path = require('path');
const fs = require('fs');
const converterRegistry = require('../src/main/modules/converters');

const BASE_DIR = path.join(__dirname, '..', 'test-the-word');
const INPUT_DIR = path.join(BASE_DIR, 'The Word');
const OUTPUT_DIR = path.join(BASE_DIR, 'Graphe');

const CATEGORIES = [
  { name: 'Bibles', subdir: 'Bibles' },
  { name: 'Books', subdir: 'Books' },
];

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

async function batchConvert() {
  const files = discoverFiles();
  const successes = [];
  const skipped = [];
  const failures = [];

  // Clean output directory before converting to avoid stale files from previous runs
  if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, { recursive: true });
  }

  console.log(`Found ${files.length} files to convert\n`);

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
      successes.push({ filename: file.filename, category: file.category, outputName, elapsed });
    } catch (err) {
      const msg = err.message || String(err);

      if (/Encrypted TheWord/i.test(msg)) {
        console.log(`\r${label} ${file.filename} ... SKIPPED (encrypted)`);
        skipped.push({ filename: file.filename, category: file.category, reason: 'encrypted' });
      } else if (/Cannot load TWM module/i.test(msg)) {
        console.log(`\r${label} ${file.filename} ... SKIPPED (unsupported TWM type)`);
        skipped.push({
          filename: file.filename,
          category: file.category,
          reason: 'unsupported TWM type',
        });
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

function printSummary(results) {
  const { successes, skipped, failures } = results;
  const total = successes.length + skipped.length + failures.length;

  console.log('\n=== Conversion Summary ===\n');
  console.log(`Total files:  ${total}`);
  console.log(`Converted:    ${successes.length}`);
  console.log(`Skipped:      ${skipped.length}`);
  console.log(`Failed:       ${failures.length}`);

  if (skipped.length > 0) {
    const byReason = {};
    for (const s of skipped) {
      byReason[s.reason] = (byReason[s.reason] || 0) + 1;
    }
    console.log('\nSkipped breakdown:');
    for (const [reason, count] of Object.entries(byReason)) {
      console.log(`  ${reason}: ${count}`);
    }
  }

  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  ${f.filename}: ${f.error}`);
    }
  }
}

batchConvert()
  .then((results) => {
    printSummary(results);

    const reportPath = path.join(OUTPUT_DIR, 'conversion-report.json');
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
    console.log(`\nReport written to ${reportPath}`);

    process.exit(results.failures.length > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(2);
  });

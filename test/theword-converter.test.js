import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { convertTagsToMyBible } from '../src/main/modules/converters/theword-converter.ts';
import * as converterRegistry from '../src/main/modules/converters/index.ts';
const TOTAL_VERSES = 31102;
const OT_VERSES = 23145;

// --- Pure function tests (no file needed) ---

describe('convertTagsToMyBible', () => {
  it('converts Strong numbers without H/G prefix', () => {
    const input = '<wt>word<WH1234><WTmorph l="lemma">';
    const result = convertTagsToMyBible(input);
    expect(result).toBe('word<S>1234</S><m>morph</m><l>lemma</l>');
  });

  it('converts Greek Strong numbers without prefix', () => {
    const input = '<wt>logos<WG3056><WTverb l="say">';
    const result = convertTagsToMyBible(input);
    expect(result).toBe('logos<S>3056</S><m>verb</m><l>say</l>');
  });

  it('converts multiple Strong numbers per word', () => {
    const input = '<wt>word<WH1234><WTmorph1 l="lem1"><WH5678><WTmorph2 l="lem2">';
    const result = convertTagsToMyBible(input);
    expect(result).toBe(
      'word<S>1234</S><m>morph1</m><l>lem1</l><S>5678</S><m>morph2</m><l>lem2</l>'
    );
  });

  it('handles Strong number without morph', () => {
    const input = '<wt>word<WH1234>';
    const result = convertTagsToMyBible(input);
    expect(result).toBe('word<S>1234</S>');
    expect(result).not.toContain('<m>');
  });

  it('converts red letter to <J> tags', () => {
    const input = '<FR>Jesus said<Fr>';
    const result = convertTagsToMyBible(input);
    expect(result).toBe('<J>Jesus said</J>');
  });

  it('converts italics', () => {
    const input = 'some <FI>italic text<Fi> here';
    const result = convertTagsToMyBible(input);
    expect(result).toBe('some <i>italic text</i> here');
  });

  it('converts footnotes', () => {
    const input = 'text <RF>footnote content<Rf> more';
    const result = convertTagsToMyBible(input);
    expect(result).toBe('text <f>footnote content</f> more');
  });

  it('converts paragraph breaks', () => {
    const input = 'line1<CM>line2';
    const result = convertTagsToMyBible(input);
    expect(result).toBe('line1<pb/>line2');
  });

  it('converts CL to paragraph break', () => {
    const input = 'line1<CL>line2';
    const result = convertTagsToMyBible(input);
    expect(result).toBe('line1<pb/>line2');
  });

  it('strips section titles', () => {
    const input = '<TS>Title Text<Ts>verse content';
    const result = convertTagsToMyBible(input);
    expect(result).toBe('verse content');
  });

  it('converts TS2 titles to inline subheadings', () => {
    const input = '<TS2>O CÉU E A TERRA<Ts>verse content';
    const result = convertTagsToMyBible(input);
    expect(result).toBe('<h>O CÉU E A TERRA</h>verse content');
  });

  it('keeps multiple TS2 titles in one verse line', () => {
    const input = 'text<TS2>Heading 1<Ts>middle<TS2>Heading 2<Ts>end';
    const result = convertTagsToMyBible(input);
    expect(result).toBe('text<h>Heading 1</h>middle<h>Heading 2</h>end');
  });

  it('strips OT quotation tags', () => {
    const input = '<FO>quoted text<Fo>';
    const result = convertTagsToMyBible(input);
    expect(result).toBe('quoted text');
  });

  it('strips variant reading blocks', () => {
    const input = 'text<V1{>variant stuff<V1}>more';
    const result = convertTagsToMyBible(input);
    expect(result).toBe('textmore');
  });

  it('S tags contain only numbers (no H/G)', () => {
    const input = '<wt>beginning<WH7225><WTnoun>';
    const result = convertTagsToMyBible(input);
    // Verify <S> contains only numbers
    const sMatches = result.match(/<S>(.*?)<\/S>/g);
    expect(sMatches).toBeTruthy();
    for (const m of sMatches) {
      const content = m.replace(/<\/?S>/g, '');
      expect(content).toMatch(/^\d+$/);
    }
  });

  it('converts bare Strong tags (no <wt> wrapper)', () => {
    const input = 'word<WH1234>';
    const result = convertTagsToMyBible(input);
    expect(result).toBe('word<S>1234</S>');
  });

  it('converts bare Strong with morph code stripped', () => {
    const input = 'word<WH1254><H8804>';
    const result = convertTagsToMyBible(input);
    expect(result).toBe('word<S>1254</S>');
  });

  it('converts multiple bare Strong tags', () => {
    const input = 'criou<WH1254><H8804><WH853>';
    const result = convertTagsToMyBible(input);
    expect(result).toBe('criou<S>1254</S><S>853</S>');
  });

  it('converts mixed bare Strong verse (ARA+ style)', () => {
    const input = 'No princípio,<WH7225> criou<WH1254><H8804><WH853> Deus<WH430>';
    const result = convertTagsToMyBible(input);
    expect(result).toContain('<S>7225</S>');
    expect(result).toContain('<S>1254</S>');
    expect(result).toContain('<S>853</S>');
    expect(result).toContain('<S>430</S>');
    expect(result).not.toMatch(/<H\d+>/i);
    expect(result).not.toMatch(/<W[HG]\d+>/i);
  });

  it('handles complex verse with multiple features', () => {
    const input =
      '<TS>Section<Ts><FR><wt>In<WH1234><WTnoun l="begin"><Fr> the <FI>beginning<Fi><CM>';
    const result = convertTagsToMyBible(input);
    expect(result).toContain('<J>');
    expect(result).toContain('</J>');
    expect(result).toContain('<S>1234</S>');
    expect(result).toContain('<m>noun</m>');
    expect(result).toContain('<l>begin</l>');
    expect(result).toContain('<i>beginning</i>');
    expect(result).toContain('<pb/>');
    expect(result).not.toContain('<TS>');
    expect(result).not.toContain('<FR>');
    expect(result).not.toContain('H1234');
  });

  it('strips unsupported tags while preserving text', () => {
    const input = 'A<font color=red>B</font><sup>C</sup><v>D</v><pb/>E';
    const result = convertTagsToMyBible(input);
    expect(result).toBe('ABCD<pb/>E');
  });

  it('normalizes malformed Strong values to digits only', () => {
    const input = 'one<WG1161x> two<WH5555(> three<WG3156>';
    const result = convertTagsToMyBible(input);
    expect(result).toBe('one<S>1161</S> two<S>5555</S> three<S>3156</S>');
  });

  it('preserves case-paired interlinear tags for renderer layout', () => {
    const input = '<wt><E>Word<e><O>Λόγος<o><T>lógos<t><WG3056><WTN-NSM l="λόγος">';
    const result = convertTagsToMyBible(input);
    expect(result).toContain('<E>Word<e>');
    expect(result).toContain('<O>Λόγος<o>');
    expect(result).toContain('<T>lógos<t>');
    expect(result).toContain('<S>3056</S>');
  });

  it('preserves <X>...<x> extended annotation tags', () => {
    const input = '<E>Word<e><X>pr=test<x>';
    const result = convertTagsToMyBible(input);
    expect(result).toContain('<X>pr=test<x>');
  });
});

describe('converter registry', () => {
  it('includes encrypted TheWord bible extensions in picker support', () => {
    const exts = converterRegistry.getSupportedExtensions();
    expect(exts).toContain('.ontx');
    expect(exts).toContain('.ntx');
    expect(exts).toContain('.otx');
    expect(exts).toContain('.ot');
  });
});

describe('encrypted bible module handling', () => {
  it('rejects encrypted .ontx with explicit error', async () => {
    const converter = require('../src/main/modules/converters/theword-converter.ts');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphe-test-ontx-'));
    const inputPath = path.join(tmpDir, 'sample.ontx');
    fs.writeFileSync(inputPath, Buffer.from('TWENCBMOD\x00\x01\x02\x03', 'binary'));

    try {
      await expect(converter.convert(inputPath, tmpDir)).rejects.toThrow(/Encrypted TheWord Bible/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// --- Integration tests (require actual module files) ---

describe('convertBible integration', () => {
  const MODULES_DIR = path.join(os.homedir(), '.graphe', 'modules');
  const Database = require('better-sqlite3');
  let converter;
  let ontFile;
  let tmpDir;

  function hasOntFile() {
    try {
      const files = fs.readdirSync(MODULES_DIR);
      return files.some((f) => f.toLowerCase().endsWith('.ont'));
    } catch (_) {
      return false;
    }
  }

  beforeAll(() => {
    converter = require('../src/main/modules/converters/theword-converter.ts');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphe-test-'));

    try {
      const files = fs.readdirSync(MODULES_DIR);
      const ont = files.find((f) => f.toLowerCase().endsWith('.ont'));
      if (ont) ontFile = path.join(MODULES_DIR, ont);
    } catch (_) {}
  });

  afterAll(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it.skipIf(!hasOntFile())('converts .ont to .SQLite3 with correct tables', async () => {
    const outputPath = await converter.convert(ontFile, tmpDir);
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(outputPath.endsWith('.SQLite3')).toBe(true);

    const db = new Database(outputPath, { readonly: true });
    try {
      // Check info table
      const info = {};
      const rows = db.prepare('SELECT name, value FROM info').all();
      for (const row of rows) info[row.name] = row.value;
      expect(info.description).toBeTruthy();

      // Check books table
      const books = db
        .prepare('SELECT book_number, short_name, long_name FROM books ORDER BY book_number')
        .all();
      expect(books.length).toBeGreaterThan(0);

      // Check verses table
      const verses = db
        .prepare(
          'SELECT verse, text FROM verses WHERE book_number = 10 AND chapter = 1 ORDER BY verse'
        )
        .all();
      expect(verses.length).toBeGreaterThan(0);
      expect(verses[0].verse).toBe(1);

      // Verify no raw TheWord tags remain
      for (const v of verses.slice(0, 10)) {
        expect(v.text).not.toMatch(/<wt>/i);
        expect(v.text).not.toMatch(/<W[HG]\d/i);
        expect(v.text).not.toMatch(/<WT[^>]*>/i);
        expect(v.text).not.toMatch(/<FR>/i);
      }

      // If Strong's, verify <S> tags contain only numbers
      const strongVerse = verses.find((v) => /<S>/.test(v.text));
      if (strongVerse) {
        const sMatches = strongVerse.text.match(/<S>(.*?)<\/S>/g);
        for (const m of sMatches) {
          const content = m.replace(/<\/?S>/g, '');
          expect(content).toMatch(/^\d+$/);
        }
      }
    } finally {
      db.close();
    }
  });

  it('keeps contiguous verse rows for sparse full-length .ot files', async () => {
    const sparseTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graphe-test-sparse-ot-'));
    const inputPath = path.join(sparseTmp, 'sparse.ot');
    const verses = Array(TOTAL_VERSES).fill('');
    verses[0] = '1 In the beginning';
    verses[1] = '2 And the earth was without form';
    verses[OT_VERSES] = ''; // Matthew 1:1 placeholder
    fs.writeFileSync(inputPath, `${verses.join('\n')}\ndescription=Sparse OT\n`);

    try {
      const outputPath = await converter.convert(inputPath, sparseTmp);
      const db = new Database(outputPath, { readonly: true });
      try {
        const emptyVerseRows = db
          .prepare(
            "SELECT COUNT(*) AS c FROM verses WHERE trim(replace(replace(text, char(13), ''), char(10), '')) = ''"
          )
          .get().c;
        expect(emptyVerseRows).toBeGreaterThan(0);

        const books = db.prepare('SELECT book_number FROM books ORDER BY book_number').all();
        expect(books.length).toBeGreaterThan(0);
        expect(books.some((b) => b.book_number === 10)).toBe(true);

        const otRows = db
          .prepare('SELECT COUNT(*) AS c FROM verses WHERE book_number < 470')
          .get().c;
        expect(otRows).toBe(OT_VERSES);

        const totalRows = db.prepare('SELECT COUNT(*) AS c FROM verses').get().c;
        expect(totalRows).toBe(TOTAL_VERSES);

        const ntRows = db
          .prepare('SELECT COUNT(*) AS c FROM verses WHERE book_number >= 470')
          .get().c;
        expect(ntRows).toBe(TOTAL_VERSES - OT_VERSES);
      } finally {
        db.close();
      }
    } finally {
      fs.rmSync(sparseTmp, { recursive: true, force: true });
    }
  });

  it('fails conversion when module has no non-empty verse text', async () => {
    const sparseTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graphe-test-empty-ot-'));
    const inputPath = path.join(sparseTmp, 'empty.ot');
    const verses = Array(TOTAL_VERSES).fill('');
    fs.writeFileSync(inputPath, `${verses.join('\n')}\ndescription=Empty\n`);

    try {
      await expect(converter.convert(inputPath, sparseTmp)).rejects.toThrow(
        /no non-empty verse text/i
      );
    } finally {
      fs.rmSync(sparseTmp, { recursive: true, force: true });
    }
  });
});

describe('convertDictionary integration', () => {
  const MODULES_DIR = path.join(os.homedir(), '.graphe', 'modules');
  const Database = require('better-sqlite3');
  let converter;
  let dctFile;
  let tmpDir;

  function findFirstDctFile(root) {
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(root, entry.name);
        if (entry.isDirectory()) {
          const nested = findFirstDctFile(fullPath);
          if (nested) return nested;
          continue;
        }
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.dct.twm')) {
          return fullPath;
        }
      }
    } catch (_) {}
    return null;
  }

  function hasDctFile() {
    return Boolean(findFirstDctFile(MODULES_DIR));
  }

  beforeAll(() => {
    converter = require('../src/main/modules/converters/theword-converter.ts');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphe-test-dict-'));

    dctFile = findFirstDctFile(MODULES_DIR);
  });

  afterAll(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it.skipIf(!hasDctFile())('converts .dct.twm to dictionary .SQLite3', async () => {
    const outputPath = await converter.convert(dctFile, tmpDir);
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(outputPath).toContain('.dictionary.SQLite3');

    const db = new Database(outputPath, { readonly: true });
    try {
      const info = {};
      const rows = db.prepare('SELECT name, value FROM info').all();
      for (const row of rows) info[row.name] = row.value;
      expect(info.description).toBeTruthy();

      const entries = db.prepare('SELECT topic, definition FROM dictionary LIMIT 5').all();
      expect(entries.length).toBeGreaterThan(0);
      expect(entries[0]).toHaveProperty('topic');
      expect(entries[0]).toHaveProperty('definition');

      const g3588 = db
        .prepare('SELECT definition FROM dictionary WHERE topic = ? LIMIT 1')
        .get('G3588');
      if (g3588?.definition) {
        expect(g3588.definition).toContain('artigo definido');
      }
    } finally {
      db.close();
    }
  });
});

describe('convertCommentary integration', () => {
  const MODULES_DIR = path.join(os.homedir(), '.graphe', 'modules');
  const Database = require('better-sqlite3');
  let converter;
  let cmtFile;
  let tmpDir;

  function hasCmtFile() {
    try {
      const files = fs.readdirSync(MODULES_DIR);
      return files.some((f) => f.toLowerCase().endsWith('.cmt.twm'));
    } catch (_) {
      return false;
    }
  }

  beforeAll(() => {
    converter = require('../src/main/modules/converters/theword-converter.ts');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphe-test-cmt-'));

    try {
      const files = fs.readdirSync(MODULES_DIR);
      const cmt = files.find((f) => f.toLowerCase().endsWith('.cmt.twm'));
      if (cmt) cmtFile = path.join(MODULES_DIR, cmt);
    } catch (_) {}
  });

  afterAll(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it.skipIf(!hasCmtFile())('converts .cmt.twm to commentary .SQLite3', async () => {
    const outputPath = await converter.convert(cmtFile, tmpDir);
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(outputPath).toContain('.commentaries.SQLite3');

    const db = new Database(outputPath, { readonly: true });
    try {
      const info = {};
      const rows = db.prepare('SELECT name, value FROM info').all();
      for (const row of rows) info[row.name] = row.value;
      expect(info.description).toBeTruthy();

      const entries = db
        .prepare(
          'SELECT book_number, chapter_number_from, verse_number_from, text FROM commentaries LIMIT 5'
        )
        .all();
      expect(entries.length).toBeGreaterThan(0);
      expect(entries[0]).toHaveProperty('book_number');
      expect(entries[0]).toHaveProperty('text');
      expect(entries[0].text.length).toBeGreaterThan(0);

      const books = db.prepare('SELECT book_number FROM books ORDER BY book_number').all();
      expect(books.length).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });
});

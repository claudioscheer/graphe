import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { convertTagsToMyBible } = require('../src/main/modules/converters/theword-converter');
const converterRegistry = require('../src/main/modules/converters');

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
    expect(result).toBe('word<S>1234</S><m>morph1</m><l>lem1</l><S>5678</S><m>morph2</m><l>lem2</l>');
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
      expect(content).toMatch(/^\d+\w*$/);
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
});

describe('converter registry', () => {
  it('includes encrypted TheWord bible extensions in picker support', () => {
    const exts = converterRegistry.getSupportedExtensions();
    expect(exts).toContain('.ontx');
    expect(exts).toContain('.ntx');
  });
});

describe('encrypted bible module handling', () => {
  it('rejects encrypted .ontx with explicit error', async () => {
    const converter = require('../src/main/modules/converters/theword-converter');
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
    converter = require('../src/main/modules/converters/theword-converter');
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
        .prepare('SELECT verse, text FROM verses WHERE book_number = 10 AND chapter = 1 ORDER BY verse')
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
          expect(content).toMatch(/^\d+\w*$/);
        }
      }
    } finally {
      db.close();
    }
  });
});

describe('convertDictionary integration', () => {
  const MODULES_DIR = path.join(os.homedir(), '.graphe', 'modules');
  const Database = require('better-sqlite3');
  let converter;
  let dctFile;
  let tmpDir;

  function hasDctFile() {
    try {
      const files = fs.readdirSync(MODULES_DIR);
      return files.some((f) => f.toLowerCase().endsWith('.dct.twm'));
    } catch (_) {
      return false;
    }
  }

  beforeAll(() => {
    converter = require('../src/main/modules/converters/theword-converter');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphe-test-dict-'));

    try {
      const files = fs.readdirSync(MODULES_DIR);
      const dct = files.find((f) => f.toLowerCase().endsWith('.dct.twm'));
      if (dct) dctFile = path.join(MODULES_DIR, dct);
    } catch (_) {}
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
    converter = require('../src/main/modules/converters/theword-converter');
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
        .prepare('SELECT book_number, chapter_number_from, verse_number_from, text FROM commentaries LIMIT 5')
        .all();
      expect(entries.length).toBeGreaterThan(0);
      expect(entries[0]).toHaveProperty('book_number');
      expect(entries[0]).toHaveProperty('text');
      expect(entries[0].text.length).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });
});

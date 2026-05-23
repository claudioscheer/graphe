import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { convertTags } from '../src/main/modules/theword-bible-provider.ts';

const TOTAL_VERSES = 31102;
const OT_VERSES = 23145;
const NT_VERSES = TOTAL_VERSES - OT_VERSES;

function createTheWordModuleFile(tmpDir, name, verseCount, metadataLines = []) {
  const filePath = path.join(tmpDir, name);
  const verses = Array.from({ length: verseCount }, (_v, idx) => `Verse ${idx + 1}`);
  fs.writeFileSync(filePath, `${verses.join('\n')}\n${metadataLines.join('\n')}\n`);
  return filePath;
}

function createSparseTheWordModuleFile(tmpDir, name, verseLines, metadataLines = []) {
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, `${verseLines.join('\n')}\n${metadataLines.join('\n')}\n`);
  return filePath;
}

// --- Pure function tests (no file needed) ---

describe('convertTags', () => {
  it('converts a single Hebrew Strong number', () => {
    const input = '<wt>word<WH1234><WTmorph l="lemma">';
    const result = convertTags(input);
    expect(result).toBe('word<S morph="morph" lemma="lemma">H1234</S>');
  });

  it('converts a Greek Strong number', () => {
    const input = '<wt>logos<WG3056><WTverb l="say">';
    const result = convertTags(input);
    expect(result).toBe('logos<S morph="verb" lemma="say">G3056</S>');
  });

  it('converts multiple Strong numbers per word', () => {
    const input = '<wt>word<WH1234><WTmorph1 l="lem1"><WH5678><WTmorph2 l="lem2">';
    const result = convertTags(input);
    expect(result).toBe(
      'word<S morph="morph1" lemma="lem1">H1234</S><S morph="morph2" lemma="lem2">H5678</S>'
    );
  });

  it('handles Strong number without morph/lemma', () => {
    const input = '<wt>word<WH1234>';
    const result = convertTags(input);
    expect(result).toBe('word<S>H1234</S>');
  });

  it('converts footnotes', () => {
    const input = 'text <RF>footnote content<Rf> more';
    const result = convertTags(input);
    expect(result).toBe('text <f>footnote content</f> more');
  });

  it('converts italics', () => {
    const input = 'some <FI>italic text<Fi> here';
    const result = convertTags(input);
    expect(result).toBe('some <i>italic text</i> here');
  });

  it('converts paragraph breaks', () => {
    const input = 'line1<CM>line2';
    const result = convertTags(input);
    expect(result).toBe('line1<pb/>line2');
  });

  it('converts CL to paragraph break', () => {
    const input = 'line1<CL>line2';
    const result = convertTags(input);
    expect(result).toBe('line1<pb/>line2');
  });

  it('strips section titles', () => {
    const input = '<TS>Title Text<Ts>verse content';
    const result = convertTags(input);
    expect(result).toBe('verse content');
  });

  it('strips red letter tags', () => {
    const input = '<FR>Jesus said<Fr>';
    const result = convertTags(input);
    expect(result).toBe('Jesus said');
  });

  it('strips OT quotation tags', () => {
    const input = '<FO>quoted text<Fo>';
    const result = convertTags(input);
    expect(result).toBe('quoted text');
  });

  it('strips variant reading blocks', () => {
    const input = 'text<V1{>variant stuff<V1}>more';
    const result = convertTags(input);
    expect(result).toBe('textmore');
  });

  it('converts bare Strong tags with H/G prefix preserved', () => {
    const input = 'word<WH1234>';
    const result = convertTags(input);
    expect(result).toBe('word<S>H1234</S>');
  });

  it('converts bare Strong with morph code stripped', () => {
    const input = 'word<WH1254><H8804>';
    const result = convertTags(input);
    expect(result).toBe('word<S>H1254</S>');
  });

  it('handles complex verse with multiple features', () => {
    const input =
      '<TS>Section<Ts><FR><wt>In<WH1234><WTnoun l="begin"><Fr> the <FI>beginning<Fi><CM>';
    const result = convertTags(input);
    expect(result).toContain('In<S morph="noun" lemma="begin">H1234</S>');
    expect(result).toContain('<i>beginning</i>');
    expect(result).toContain('<pb/>');
    expect(result).not.toContain('<TS>');
    expect(result).not.toContain('<FR>');
  });
});

describe('encrypted module handling', () => {
  it('throws explicit error for encrypted .ontx input', () => {
    const provider = require('../src/main/modules/theword-bible-provider.ts');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphe-test-provider-ontx-'));
    const inputPath = path.join(tmpDir, 'enc.ontx');
    fs.writeFileSync(inputPath, Buffer.from('TWENCBMOD\x00\x01\x02\x03', 'binary'));

    try {
      expect(() => provider.load(inputPath)).toThrow(/Encrypted TheWord Bible/);
      expect(provider.isValidFile(inputPath)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('legacy encoding handling', () => {
  it('loads utf8 BOM .nt modules without mojibake', () => {
    const provider = require('../src/main/modules/theword-bible-provider.ts');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphe-test-provider-utf8bom-'));
    const inputPath = path.join(tmpDir, 'sample-utf8-bom.nt');
    const verses = Array.from({ length: NT_VERSES }, () => '');
    verses[0] = 'No princípio criou Deus o céu e a terra.';
    const content = `${verses.join('\n')}\n`;
    fs.writeFileSync(
      inputPath,
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(content, 'utf8')])
    );

    try {
      const handle = provider.load(inputPath);
      const chapter = provider.getChapter(handle, 470, 1);
      expect(chapter[0].text).toBe('No princípio criou Deus o céu e a terra.');
      expect(chapter[0].text).not.toContain('Ã');
      expect(chapter[0].text).not.toContain('ï»¿');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('loads latin1 .nt modules without mojibake', () => {
    const provider = require('../src/main/modules/theword-bible-provider.ts');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphe-test-provider-latin1-'));
    const inputPath = path.join(tmpDir, 'sample-latin1.nt');
    const verses = Array.from({ length: NT_VERSES }, () => '');
    verses[0] = 'Estes últimos se haviam concentrado no vale de Sidim (que agora é o mar Morto).';
    const content = `${verses.join('\n')}\n`;
    fs.writeFileSync(inputPath, Buffer.from(content, 'latin1'));

    try {
      const handle = provider.load(inputPath);
      const chapter = provider.getChapter(handle, 470, 1);
      expect(chapter[0].text).toBe(
        'Estes últimos se haviam concentrado no vale de Sidim (que agora é o mar Morto).'
      );
      expect(chapter[0].text).not.toContain('\ufffd');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('OT module handling', () => {
  it('loads OT-only .ot modules and exposes only OT books', () => {
    const provider = require('../src/main/modules/theword-bible-provider.ts');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphe-test-provider-ot-'));
    const inputPath = createTheWordModuleFile(tmpDir, 'sample.ot', OT_VERSES, [
      'description=Sample OT',
    ]);

    try {
      const handle = provider.load(inputPath);
      expect(handle.scope).toBe('ot');
      expect(handle.isOtOnly).toBe(true);
      expect(handle.isNtOnly).toBe(false);

      const books = provider.getBooks(handle);
      expect(books.length).toBe(39);
      expect(books[0].bookNumber).toBe(10); // Genesis
      expect(books[books.length - 1].bookNumber).toBe(460); // Malachi

      const gen1 = provider.getChapter(handle, 10, 1);
      expect(gen1.length).toBe(31);
      expect(gen1[0].verse).toBe(1);
      expect(gen1[0].text).toBe('Verse 1');

      // No NT in OT-only module
      const mat1 = provider.getChapter(handle, 470, 1);
      expect(mat1).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('loads .ot files with full-bible verse count as full scope', () => {
    const provider = require('../src/main/modules/theword-bible-provider.ts');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphe-test-provider-ot-full-'));
    const inputPath = createTheWordModuleFile(tmpDir, 'sample-full.ot', TOTAL_VERSES, [
      'description=Sample Full',
    ]);

    try {
      const handle = provider.load(inputPath);
      expect(handle.scope).toBe('full');
      expect(handle.isOtOnly).toBe(false);
      expect(handle.isNtOnly).toBe(false);

      const books = provider.getBooks(handle);
      expect(books.length).toBe(66);
      expect(provider.getChapter(handle, 470, 1).length).toBeGreaterThan(0); // Matthew 1 exists
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('accepts .ot files in isValidFile()', () => {
    const provider = require('../src/main/modules/theword-bible-provider.ts');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphe-test-provider-ot-valid-'));
    const inputPath = createTheWordModuleFile(tmpDir, 'valid.ot', OT_VERSES, ['description=OT']);

    try {
      expect(provider.isValidFile(inputPath)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('treats full-length sparse .ot files as effective OT and hides empty placeholders', () => {
    const provider = require('../src/main/modules/theword-bible-provider.ts');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphe-test-provider-ot-sparse-'));
    const verses = Array(TOTAL_VERSES).fill('');
    verses[0] = 'Verse 1';
    verses[1] = 'Verse 2';
    verses[OT_VERSES] = ''; // NT first verse placeholder remains empty
    const inputPath = createSparseTheWordModuleFile(tmpDir, 'sparse-full.ot', verses, [
      'description=Sparse OT-like',
    ]);

    try {
      const handle = provider.load(inputPath);
      expect(handle.scope).toBe('full');
      expect(handle.effectiveScope).toBe('ot');
      expect(handle.isOtOnly).toBe(true);
      expect(handle.isNtOnly).toBe(false);
      expect(handle.nonEmptyVerseCount).toBe(2);

      const books = provider.getBooks(handle);
      expect(books.map((b) => b.bookNumber)).toEqual([10]);

      const gen1 = provider.getChapter(handle, 10, 1);
      expect(gen1.map((v) => v.verse)).toEqual([1, 2]);
      expect(gen1.every((v) => v.text.trim().length > 0)).toBe(true);

      const mat1 = provider.getChapter(handle, 470, 1);
      expect(mat1).toEqual([]);
      expect(provider.getChapterCount(handle, 470)).toBe(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// --- Integration tests (require actual module files) ---

describe('TheWord Bible integration', () => {
  const MODULES_DIR = path.join(os.homedir(), '.graphe', 'modules');
  let ontFile;
  let provider;

  function hasOntFile() {
    try {
      const files = fs.readdirSync(MODULES_DIR);
      return files.some((f) => f.toLowerCase().endsWith('.ont'));
    } catch (_) {
      return false;
    }
  }

  function hasStrongOntFile() {
    try {
      const files = fs.readdirSync(MODULES_DIR);
      return files.some((f) => f.toLowerCase().endsWith('.ont') && /strong/i.test(f));
    } catch (_) {
      return false;
    }
  }

  beforeAll(() => {
    provider = require('../src/main/modules/theword-bible-provider.ts');

    try {
      const files = fs.readdirSync(MODULES_DIR);
      const ont = files.find((f) => f.toLowerCase().endsWith('.ont'));
      if (ont) ontFile = path.join(MODULES_DIR, ont);
    } catch (_) {}
  });

  it.skipIf(!hasOntFile())('loads an .ont file and returns valid handle', () => {
    const handle = provider.load(ontFile);
    expect(handle).toBeTruthy();
    expect(handle.format).toBe('theword-bible');
    expect(handle.lines).toBeInstanceOf(Array);
    expect(handle.lines.length).toBeGreaterThan(0);
    expect(handle.verseIndex).toBeInstanceOf(Map);
    expect(handle.metadata).toBeDefined();
  });

  it.skipIf(!hasOntFile())('getChapter returns verses with {verse, text}', () => {
    const handle = provider.load(ontFile);
    const verses = provider.getChapter(handle, 10, 1); // Genesis 1
    expect(verses.length).toBeGreaterThan(0);
    expect(verses[0]).toHaveProperty('verse');
    expect(verses[0]).toHaveProperty('text');
    expect(verses[0].verse).toBe(1);
    expect(typeof verses[0].text).toBe('string');
  });

  it.skipIf(!hasStrongOntFile())('detects Strong numbers in a Strong bible', () => {
    const files = fs.readdirSync(MODULES_DIR);
    const strongFile = files.find((f) => f.toLowerCase().endsWith('.ont') && /strong/i.test(f));
    if (!strongFile) return;
    const handle = provider.load(path.join(MODULES_DIR, strongFile));
    expect(handle.hasStrongs).toBe(true);

    const verses = provider.getChapter(handle, 10, 1);
    const hasSTags = verses.some((v) => /<S[ >]/.test(v.text));
    expect(hasSTags).toBe(true);
  });
});

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { convertTags } = require('../src/main/modules/theword-bible-provider');

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
    const provider = require('../src/main/modules/theword-bible-provider');
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
    provider = require('../src/main/modules/theword-bible-provider');

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
    const strongFile = files.find(
      (f) => f.toLowerCase().endsWith('.ont') && /strong/i.test(f)
    );
    if (!strongFile) return;
    const handle = provider.load(path.join(MODULES_DIR, strongFile));
    expect(handle.hasStrongs).toBe(true);

    const verses = provider.getChapter(handle, 10, 1);
    const hasSTags = verses.some((v) => /<S[ >]/.test(v.text));
    expect(hasSTags).toBe(true);
  });
});

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { convertMySwordTags } = require('../src/main/modules/converters/mysword-converter');
const converterRegistry = require('../src/main/modules/converters');
const Database = require('better-sqlite3');

const TEST_SUPPORT = path.join(__dirname, '..', 'test-support');

// --- Pure function tests ---

describe('convertMySwordTags', () => {
  it('converts Hebrew Strong number <WH1234> to <S>1234</S>', () => {
    expect(convertMySwordTags('word<WH1234>')).toContain('<S>1234</S>');
  });

  it('converts Greek Strong number <WG5678> to <S>5678</S>', () => {
    expect(convertMySwordTags('word<WG5678>')).toContain('<S>5678</S>');
  });

  it('converts Strong with morphology and lemma', () => {
    const result = convertMySwordTags('<WG976><WTN-NSF l="βίβλος">');
    expect(result).toContain('<S>976</S>');
    expect(result).toContain('<m>N-NSF</m>');
    expect(result).toContain('<l>βίβλος</l>');
  });

  it('converts Strong with morphology but no lemma', () => {
    const result = convertMySwordTags('<WG976><WTN-NSF>');
    expect(result).toContain('<S>976</S>');
    expect(result).toContain('<m>N-NSF</m>');
    expect(result).not.toContain('<l>');
  });

  it('strips word-position tags <W>num<w>', () => {
    const result = convertMySwordTags('<T>biblos<t><G>βιβλοσ<g><W>1<w>');
    expect(result).not.toMatch(/<W>\d+<w>/i);
  });

  it('strips Japanese quotation brackets', () => {
    const result = convertMySwordTags('「<T>biblos<t>」');
    expect(result).not.toContain('「');
    expect(result).not.toContain('」');
  });

  it('converts <br> to <pb/>', () => {
    expect(convertMySwordTags('line1<br>line2')).toContain('<pb/>');
  });

  it('converts <br/> to <pb/>', () => {
    expect(convertMySwordTags('line1<br/>line2')).toContain('<pb/>');
  });

  it('preserves case-paired interlinear tags', () => {
    const result = convertMySwordTags('<T>lógos<t>');
    expect(result).toContain('<T>lógos<t>');
  });

  it('preserves plain text without tags', () => {
    expect(convertMySwordTags('In the beginning God created')).toBe(
      'In the beginning God created'
    );
  });

  it('handles empty input', () => {
    expect(convertMySwordTags('')).toBe('');
    expect(convertMySwordTags(null)).toBe('');
  });

  it('S tags contain only digits (no H/G prefix)', () => {
    const result = convertMySwordTags('<WH7225><WG976>');
    const sMatches = result.match(/<S>(.*?)<\/S>/g);
    expect(sMatches).toBeTruthy();
    for (const m of sMatches) {
      const content = m.replace(/<\/?S>/g, '');
      expect(content).toMatch(/^\d+$/);
    }
  });

  it('handles HbGr-style verse with Hebrew Strong numbers', () => {
    const input = '<Q>בְּרֵאשִׁ֖ית<WH7225><q><Q>בָּרָ֣א<WH1254><q>';
    const result = convertMySwordTags(input);
    expect(result).toContain('<S>7225</S>');
    expect(result).toContain('<S>1254</S>');
    expect(result).not.toMatch(/<WH/i);
  });

  it('handles OGNTe-style verse with Greek Strong + morphology + lemma', () => {
    const input = '<WG2455><WTN-NSM-P l="Ἰούδας">';
    const result = convertMySwordTags(input);
    expect(result).toContain('<S>2455</S>');
    expect(result).toContain('<m>N-NSM-P</m>');
    expect(result).toContain('<l>Ἰούδας</l>');
  });

  it('strips language section label tags but keeps text with non-breaking space', () => {
    const input = '<HEB>HEB </HEB>some hebrew text<br><TRA>TRA </TRA>transliteration';
    const result = convertMySwordTags(input);
    expect(result).not.toMatch(/<\/?HEB>/i);
    expect(result).not.toMatch(/<\/?TRA>/i);
    expect(result).toContain('HEB\u00a0');
    expect(result).toContain('TRA\u00a0');
  });

  it('converts bracketed <G> with <T> to <E>greek<e><T>translit<t>', () => {
    const result = convertMySwordTags('「<T>biblos<t><G>βιβλοσ<g><W>1<w>」');
    expect(result.trim()).toBe('<E>βιβλοσ<e><T>biblos<t>');
  });

  it('converts bracketed <G> without <T>', () => {
    const result = convertMySwordTags('「<G>βιβλοσ<g><W>1<w>」');
    expect(result.trim()).toBe('<E>βιβλοσ<e>');
  });

  it('inserts space between consecutive bracketed words', () => {
    const input = '「<T>biblos<t><G>βιβλοσ<g><W>1<w>」「<T>geneseōs<t><G>γενεσεωσ<g><W>2<w>」';
    const result = convertMySwordTags(input);
    expect(result).toContain('<t> <E>');
  });

  it('converts standalone <G> outside brackets to <E>', () => {
    const result = convertMySwordTags('<G>λόγος<g>');
    expect(result).toBe('<E>λόγος<e>');
  });

  it('passes through brackets without <G> unchanged', () => {
    const result = convertMySwordTags('「<T>biblos<t>」');
    expect(result).toContain('<T>biblos<t>');
    expect(result).not.toContain('「');
    expect(result).not.toContain('」');
  });

  it('converts full NA28-style verse', () => {
    const input =
      '「<T>biblos<t><G>βιβλοσ<g><W>1<w>」\n「<T>geneseōs<t><G>γενεσεωσ<g><W>2<w>」';
    const result = convertMySwordTags(input);
    expect(result).not.toContain('「');
    expect(result).not.toContain('」');
    expect(result).not.toMatch(/<W>\d+<w>/);
    expect(result).not.toMatch(/<G>/);
    expect(result).toContain('<E>βιβλοσ<e><T>biblos<t>');
    expect(result).toContain('<E>γενεσεωσ<e><T>geneseōs<t>');
  });

  it('converts full HbGr-style verse', () => {
    const input =
      '<HEB>HEB </HEB><Q>בְּרֵאשִׁ֖ית<WH7225><q><Q>בָּרָ֣א<WH1254><q><Q>אֱלֹהִ֑ים<WH430><q><br><br><TRA>TRA </TRA>bereshit bara elohim';
    const result = convertMySwordTags(input);
    expect(result).toContain('<S>7225</S>');
    expect(result).toContain('<S>1254</S>');
    expect(result).toContain('<S>430</S>');
    expect(result).not.toMatch(/<WH/i);
    expect(result).not.toMatch(/<\/?HEB>/i);
    expect(result).toContain('bereshit bara elohim');
  });

  it('strips OGNTe interlinear sub-tags but keeps text', () => {
    const input = '<Tr>Biblos</Tr><Mn>Βίβλος</Mn>';
    const result = convertMySwordTags(input);
    expect(result).toContain('Biblos');
    expect(result).toContain('Βίβλος');
    expect(result).not.toMatch(/<\/?Tr>/i);
    expect(result).not.toMatch(/<\/?Mn>/i);
  });
});

// --- Converter registry tests ---

describe('converter registry', () => {
  it('includes .mybible in supported extensions', () => {
    const exts = converterRegistry.getSupportedExtensions();
    expect(exts).toContain('.mybible');
  });
});

// --- Integration tests using test-support files ---

describe('convertBible integration', () => {
  let tmpDir;

  afterAll(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function setup() {
    if (!tmpDir) tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphe-mysword-bible-'));
    return tmpDir;
  }

  it('converts NA28 NT-only Bible', async () => {
    const dir = setup();
    const inputPath = path.join(TEST_SUPPORT, 'NA28.bbl.mybible');
    const outputPath = await converterRegistry.convertFile(inputPath, dir);

    expect(fs.existsSync(outputPath)).toBe(true);
    expect(outputPath.endsWith('.SQLite3')).toBe(true);

    const db = new Database(outputPath, { readonly: true });
    try {
      // Check info table
      const info = {};
      for (const row of db.prepare('SELECT name, value FROM info').all()) {
        info[row.name] = row.value;
      }
      expect(info.description).toBeTruthy();

      // Check books — NA28 is NT only (books 40-66 → Graphe 470-730)
      const books = db
        .prepare('SELECT book_number FROM books ORDER BY book_number')
        .all();
      expect(books.length).toBeGreaterThan(0);
      for (const b of books) {
        expect(b.book_number).toBeGreaterThanOrEqual(470);
      }

      // Check verse count
      const total = db.prepare('SELECT COUNT(*) as c FROM verses').get().c;
      expect(total).toBe(7915);

      // No raw MySword tags; <G> converted to <E>
      const sample = db
        .prepare('SELECT text FROM verses WHERE book_number = 470 AND chapter = 1 LIMIT 10')
        .all();
      for (const v of sample) {
        expect(v.text).not.toMatch(/<W>\d+<w>/i);
        expect(v.text).not.toContain('「');
        expect(v.text).not.toContain('」');
        expect(v.text).not.toMatch(/<G>/i);
        expect(v.text).toMatch(/<E>/);
      }
    } finally {
      db.close();
    }
  });

  it('converts HbGr full Bible with Strong numbers', async () => {
    const dir = setup();
    const inputPath = path.join(TEST_SUPPORT, 'HbGr Interlinear e Trasnliterado.bbl.mybible');
    const outputPath = await converterRegistry.convertFile(inputPath, dir);

    const db = new Database(outputPath, { readonly: true });
    try {
      const books = db
        .prepare('SELECT book_number FROM books ORDER BY book_number')
        .all();
      // Should have both OT and NT books
      expect(books.some((b) => b.book_number < 470)).toBe(true);
      expect(books.some((b) => b.book_number >= 470)).toBe(true);

      // Check book number mapping: source book 1 → Graphe 10 (Genesis)
      const gen = db
        .prepare('SELECT COUNT(*) as c FROM verses WHERE book_number = 10')
        .get().c;
      expect(gen).toBeGreaterThan(0);

      // Strong's info
      const info = {};
      for (const row of db.prepare('SELECT name, value FROM info').all()) {
        info[row.name] = row.value;
      }
      expect(info.strong_numbers).toBe('true');

      // Verify Strong's tags converted
      const gen11 = db
        .prepare('SELECT text FROM verses WHERE book_number = 10 AND chapter = 1 AND verse = 1')
        .get();
      expect(gen11.text).toContain('<S>7225</S>');
      expect(gen11.text).not.toMatch(/<WH/i);
    } finally {
      db.close();
    }
  });

  it('converts OGNTe Bible with interlinear morphology and lemma', async () => {
    const dir = setup();
    const inputPath = path.join(TEST_SUPPORT, 'GR OGNTe Br +exegese.bbl.mybible');
    const outputPath = await converterRegistry.convertFile(inputPath, dir);

    const db = new Database(outputPath, { readonly: true });
    try {
      // Check Matthew 1:1 has Strong's + morphology + lemma
      const mat11 = db
        .prepare('SELECT text FROM verses WHERE book_number = 470 AND chapter = 1 AND verse = 1')
        .get();
      expect(mat11.text).toContain('<S>976</S>');
      expect(mat11.text).toContain('<m>N-NSF</m>');
      expect(mat11.text).toContain('<l>βίβλος</l>');

      // No raw MySword tags
      expect(mat11.text).not.toMatch(/<WG\d/i);
      expect(mat11.text).not.toMatch(/<WT[^>]*>/i);
    } finally {
      db.close();
    }
  });

  it('maps book numbers correctly: 1→10, 40→470, 66→730', async () => {
    const dir = setup();
    const inputPath = path.join(TEST_SUPPORT, 'HbGr Interlinear e Trasnliterado.bbl.mybible');
    const outputPath = await converterRegistry.convertFile(inputPath, dir);

    const db = new Database(outputPath, { readonly: true });
    try {
      // Genesis (1 → 10)
      expect(
        db.prepare('SELECT COUNT(*) as c FROM verses WHERE book_number = 10').get().c
      ).toBeGreaterThan(0);
      // Matthew (40 → 470)
      expect(
        db.prepare('SELECT COUNT(*) as c FROM verses WHERE book_number = 470').get().c
      ).toBeGreaterThan(0);
      // Revelation (66 → 730)
      expect(
        db.prepare('SELECT COUNT(*) as c FROM verses WHERE book_number = 730').get().c
      ).toBeGreaterThan(0);

      // No source book numbers should remain (1-66 sequential would produce numbers like 1, 2, 3...)
      const minBook = db.prepare('SELECT MIN(book_number) as m FROM verses').get().m;
      expect(minBook).toBe(10);
    } finally {
      db.close();
    }
  });
});

describe('convertDictionary integration', () => {
  let tmpDir;

  afterAll(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function setup() {
    if (!tmpDir) tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphe-mysword-dict-'));
    return tmpDir;
  }

  it('converts Berean Strongs dictionary', async () => {
    const dir = setup();
    const inputPath = path.join(TEST_SUPPORT, 'Berean Strongs.dct.mybible');
    const outputPath = await converterRegistry.convertFile(inputPath, dir);

    expect(outputPath).toContain('.dictionary.SQLite3');

    const db = new Database(outputPath, { readonly: true });
    try {
      const info = {};
      for (const row of db.prepare('SELECT name, value FROM info').all()) {
        info[row.name] = row.value;
      }
      expect(info.is_strong).toBe('true');
      expect(info.type).toBe('strong lexicon');

      const count = db.prepare('SELECT COUNT(*) as c FROM dictionary').get().c;
      expect(count).toBe(25111);

      const entry = db.prepare('SELECT topic, definition FROM dictionary LIMIT 1').get();
      expect(entry.topic).toBeTruthy();
      expect(entry.definition).toBeTruthy();
    } finally {
      db.close();
    }
  });

  it('converts THOMPSON dictionary (lowercase table names)', async () => {
    const dir = setup();
    const inputPath = path.join(TEST_SUPPORT, 'THOMPSON.dct.mybible');
    const outputPath = await converterRegistry.convertFile(inputPath, dir);

    const db = new Database(outputPath, { readonly: true });
    try {
      const count = db.prepare('SELECT COUNT(*) as c FROM dictionary').get().c;
      expect(count).toBeGreaterThan(0);

      const info = {};
      for (const row of db.prepare('SELECT name, value FROM info').all()) {
        info[row.name] = row.value;
      }
      expect(info.description).toBeTruthy();
    } finally {
      db.close();
    }
  });

  it('converts Léxico Gesenius with lexeme data', async () => {
    const dir = setup();
    const inputPath = path.join(TEST_SUPPORT, 'Léxico Gesenius.dct.mybible');
    const outputPath = await converterRegistry.convertFile(inputPath, dir);

    const db = new Database(outputPath, { readonly: true });
    try {
      // Verify dictionary table has entries
      const count = db.prepare('SELECT COUNT(*) as c FROM dictionary').get().c;
      expect(count).toBeGreaterThan(0);

      // Check that lexeme column is populated for some entries
      const cols = db.prepare('PRAGMA table_info(dictionary)').all();
      const hasLexeme = cols.some((c) => c.name === 'lexeme');
      expect(hasLexeme).toBe(true);
    } finally {
      db.close();
    }
  });

  it('converts Enciclopédia Mundo Bíblico (with relativeorder)', async () => {
    const dir = setup();
    const inputPath = path.join(TEST_SUPPORT, 'Enciclopédia Mundo Bíblico.dct.mybible');
    const outputPath = await converterRegistry.convertFile(inputPath, dir);

    const db = new Database(outputPath, { readonly: true });
    try {
      const count = db.prepare('SELECT COUNT(*) as c FROM dictionary').get().c;
      expect(count).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('converts Dicionario Transliterado (with binary data table)', async () => {
    const dir = setup();
    const inputPath = path.join(TEST_SUPPORT, 'Dicionario Transliterado.dct.mybible');
    const outputPath = await converterRegistry.convertFile(inputPath, dir);

    const db = new Database(outputPath, { readonly: true });
    try {
      const count = db.prepare('SELECT COUNT(*) as c FROM dictionary').get().c;
      expect(count).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('converts Wycliffe dictionary (with binary data table)', async () => {
    const dir = setup();
    const inputPath = path.join(TEST_SUPPORT, 'Wycliffe.dct.mybible');
    const outputPath = await converterRegistry.convertFile(inputPath, dir);

    const db = new Database(outputPath, { readonly: true });
    try {
      const count = db.prepare('SELECT COUNT(*) as c FROM dictionary').get().c;
      expect(count).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('converts Sermões de John MacArthur dictionary', async () => {
    const dir = setup();
    const inputPath = path.join(TEST_SUPPORT, 'Sermões de John MacArthur.dct.mybible');
    const outputPath = await converterRegistry.convertFile(inputPath, dir);

    const db = new Database(outputPath, { readonly: true });
    try {
      const count = db.prepare('SELECT COUNT(*) as c FROM dictionary').get().c;
      expect(count).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('converts Novo Dic Teologia NT dictionary', async () => {
    const dir = setup();
    const inputPath = path.join(TEST_SUPPORT, 'Novo Dic Teologia NT_Hagnos.dct.mybible');
    const outputPath = await converterRegistry.convertFile(inputPath, dir);

    const db = new Database(outputPath, { readonly: true });
    try {
      const count = db.prepare('SELECT COUNT(*) as c FROM dictionary').get().c;
      expect(count).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });
});

// --- Provider tests ---

describe('mysword-provider', () => {
  const myswordProvider = require('../src/main/modules/mysword-provider');

  it('loads a Bible .bbl.mybible and returns correct handle', () => {
    const handle = myswordProvider.load(path.join(TEST_SUPPORT, 'NA28.bbl.mybible'));
    try {
      expect(handle).not.toBeNull();
      expect(handle.type).toBe('bible');
      expect(handle.scriptureCol).toBeTruthy();
    } finally {
      myswordProvider.close(handle);
    }
  });

  it('detects lowercase scripture column', () => {
    const handle = myswordProvider.load(
      path.join(TEST_SUPPORT, 'HbGr Interlinear e Trasnliterado.bbl.mybible')
    );
    try {
      expect(handle).not.toBeNull();
      expect(handle.scriptureCol).toBe('scripture');
    } finally {
      myswordProvider.close(handle);
    }
  });

  it('detects Strong numbers in HbGr Bible', () => {
    const handle = myswordProvider.load(
      path.join(TEST_SUPPORT, 'HbGr Interlinear e Trasnliterado.bbl.mybible')
    );
    try {
      expect(handle.hasStrongs).toBe(true);
    } finally {
      myswordProvider.close(handle);
    }
  });

  it('detects no Strong numbers in NA28', () => {
    const handle = myswordProvider.load(path.join(TEST_SUPPORT, 'NA28.bbl.mybible'));
    try {
      expect(handle.hasStrongs).toBe(false);
    } finally {
      myswordProvider.close(handle);
    }
  });

  it('loads dictionary .dct.mybible', () => {
    const handle = myswordProvider.load(
      path.join(TEST_SUPPORT, 'Berean Strongs.dct.mybible')
    );
    try {
      expect(handle).not.toBeNull();
      expect(handle.type).toBe('dictionary');
      expect(handle.isStrong).toBe(true);
    } finally {
      myswordProvider.close(handle);
    }
  });

  it('handles lowercase table names', () => {
    const handle = myswordProvider.load(
      path.join(TEST_SUPPORT, 'THOMPSON.dct.mybible')
    );
    try {
      expect(handle).not.toBeNull();
      expect(handle.type).toBe('dictionary');
      expect(handle.dictTableName).toBe('dictionary');
    } finally {
      myswordProvider.close(handle);
    }
  });

  it('detects lexeme column when present', () => {
    const handle = myswordProvider.load(
      path.join(TEST_SUPPORT, 'Léxico Gesenius.dct.mybible')
    );
    try {
      expect(handle.hasLexeme).toBe(true);
    } finally {
      myswordProvider.close(handle);
    }
  });

  it('detects relativeorder column when present', () => {
    const handle = myswordProvider.load(
      path.join(TEST_SUPPORT, 'Enciclopédia Mundo Bíblico.dct.mybible')
    );
    try {
      expect(handle.hasRelativeOrder).toBe(true);
    } finally {
      myswordProvider.close(handle);
    }
  });

  it('returns null for invalid files', () => {
    const tmpFile = path.join(os.tmpdir(), 'not-a-db.mybible');
    fs.writeFileSync(tmpFile, 'not a sqlite file');
    try {
      const handle = myswordProvider.load(tmpFile);
      expect(handle).toBeNull();
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});

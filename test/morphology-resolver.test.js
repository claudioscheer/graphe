import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import * as resolver from '../src/main/modules/morphology-resolver.ts';
import * as sqliteProvider from '../src/main/modules/sqlite-provider.ts';

describe('built-in morphology decoders', () => {
  it('decodes compact dot morphology codes', () => {
    const result = resolver.parseMorphologyMeaning('subs.f.sg.a', 'en');
    expect(result).toBeTruthy();
    expect(result.source).toBe('builtin-compact');
    expect(result.displayText).toContain('Part of speech: Noun');
    expect(result.displayText).toContain('Gender: Feminine');
    expect(result.displayText).toContain('Number: Singular');
    expect(result.displayText).toContain('State: Absolute');
  });

  it('decodes Robinson morphology codes', () => {
    const result = resolver.parseMorphologyMeaning('N-NSF', 'en');
    expect(result).toBeTruthy();
    expect(result.source).toBe('builtin-robinson');
    expect(result.displayText).toContain('Part of speech: Noun');
    expect(result.displayText).toContain('Case: Nominative');
    expect(result.displayText).toContain('Number: Singular');
    expect(result.displayText).toContain('Gender: Feminine');
  });

  it('decodes BSB morphology codes', () => {
    const result = resolver.parseMorphologyMeaning('Adj-AFP', 'en');
    expect(result).toBeTruthy();
    expect(result.source).toBe('builtin-bsb');
    expect(result.displayText).toContain('Part of speech: Adjective');
    expect(result.displayText).toContain('Case: Accusative');
    expect(result.displayText).toContain('Gender: Feminine');
    expect(result.displayText).toContain('Number: Plural');
  });

  describe('extended Robinson codes', () => {
    it('decodes V-RAI-3S (Perfect Active Indicative)', () => {
      const result = resolver.parseMorphologyMeaning('V-RAI-3S', 'en');
      expect(result).toBeTruthy();
      expect(result.source).toBe('builtin-robinson');
      expect(result.displayText).toContain('Tense: Perfect');
      expect(result.displayText).toContain('Voice: Active');
      expect(result.displayText).toContain('Mood: Indicative');
      expect(result.displayText).toContain('Person: 3rd');
      expect(result.displayText).toContain('Number: Singular');
    });

    it('decodes V-LAI-3P (Pluperfect Active Indicative)', () => {
      const result = resolver.parseMorphologyMeaning('V-LAI-3P', 'en');
      expect(result).toBeTruthy();
      expect(result.source).toBe('builtin-robinson');
      expect(result.displayText).toContain('Tense: Pluperfect');
      expect(result.displayText).toContain('Voice: Active');
      expect(result.displayText).toContain('Mood: Indicative');
      expect(result.displayText).toContain('Person: 3rd');
      expect(result.displayText).toContain('Number: Plural');
    });

    it('decodes V-TAI-1S (Future Perfect Active Indicative)', () => {
      const result = resolver.parseMorphologyMeaning('V-TAI-1S', 'en');
      expect(result).toBeTruthy();
      expect(result.source).toBe('builtin-robinson');
      expect(result.displayText).toContain('Tense: Future Perfect');
      expect(result.displayText).toContain('Voice: Active');
      expect(result.displayText).toContain('Mood: Indicative');
    });

    it('decodes V-ADI-3S (Aorist Middle Deponent Indicative)', () => {
      const result = resolver.parseMorphologyMeaning('V-ADI-3S', 'en');
      expect(result).toBeTruthy();
      expect(result.source).toBe('builtin-robinson');
      expect(result.displayText).toContain('Tense: Aorist');
      expect(result.displayText).toContain('Voice: Middle Deponent');
      expect(result.displayText).toContain('Mood: Indicative');
    });

    it('decodes V-PUI-3S (Present Middle or Passive Indicative)', () => {
      const result = resolver.parseMorphologyMeaning('V-PUI-3S', 'en');
      expect(result).toBeTruthy();
      expect(result.source).toBe('builtin-robinson');
      expect(result.displayText).toContain('Tense: Present');
      expect(result.displayText).toContain('Voice: Middle or Passive');
      expect(result.displayText).toContain('Mood: Indicative');
    });

    it('decodes N-NDM (Noun Nominative Dual Masculine)', () => {
      const result = resolver.parseMorphologyMeaning('N-NDM', 'en');
      expect(result).toBeTruthy();
      expect(result.source).toBe('builtin-robinson');
      expect(result.displayText).toContain('Case: Nominative');
      expect(result.displayText).toContain('Number: Dual');
      expect(result.displayText).toContain('Gender: Masculine');
    });

    it('decodes A-NSM-P (Adjective Nominative Singular Masculine Positive)', () => {
      const result = resolver.parseMorphologyMeaning('A-NSM-P', 'en');
      expect(result).toBeTruthy();
      expect(result.source).toBe('builtin-robinson');
      expect(result.displayText).toContain('Part of speech: Adjective');
      expect(result.displayText).toContain('Case: Nominative');
      expect(result.displayText).toContain('Degree: Positive');
    });

    it('decodes N-BSM (Noun Ablative Singular Masculine)', () => {
      const result = resolver.parseMorphologyMeaning('N-BSM', 'en');
      expect(result).toBeTruthy();
      expect(result.source).toBe('builtin-robinson');
      expect(result.displayText).toContain('Case: Ablative');
      expect(result.displayText).toContain('Number: Singular');
      expect(result.displayText).toContain('Gender: Masculine');
    });
  });

  describe('extended compact codes', () => {
    it('decodes part (Particle)', () => {
      const result = resolver.parseMorphologyMeaning('part', 'en');
      expect(result).toBeTruthy();
      expect(result.source).toBe('builtin-compact');
      expect(result.displayText).toContain('Part of speech: Particle');
    });

    it('decodes neg (Negation)', () => {
      const result = resolver.parseMorphologyMeaning('neg', 'en');
      expect(result).toBeTruthy();
      expect(result.source).toBe('builtin-compact');
      expect(result.displayText).toContain('Part of speech: Negation');
    });

    it('decodes verb.polel.perf.p3.m.sg', () => {
      const result = resolver.parseMorphologyMeaning('verb.polel.perf.p3.m.sg', 'en');
      expect(result).toBeTruthy();
      expect(result.source).toBe('builtin-compact');
      expect(result.displayText).toContain('Part of speech: Verb');
      expect(result.displayText).toContain('Stem: Polel');
      expect(result.displayText).toContain('Aspect: Perfect');
      expect(result.displayText).toContain('Person: 3rd');
      expect(result.displayText).toContain('Gender: Masculine');
      expect(result.displayText).toContain('Number: Singular');
    });

    it('decodes verb.qal.ptcpp.m.sg (passive participle)', () => {
      const result = resolver.parseMorphologyMeaning('verb.qal.ptcpp.m.sg', 'en');
      expect(result).toBeTruthy();
      expect(result.source).toBe('builtin-compact');
      expect(result.displayText).toContain('Part of speech: Verb');
      expect(result.displayText).toContain('Stem: Qal');
      expect(result.displayText).toContain('Aspect: Passive participle');
    });

    it('decodes verb.qal.wayc.p3.m.sg (waw consecutive)', () => {
      const result = resolver.parseMorphologyMeaning('verb.qal.wayc.p3.m.sg', 'en');
      expect(result).toBeTruthy();
      expect(result.source).toBe('builtin-compact');
      expect(result.displayText).toContain('Aspect: Waw consecutive');
    });
  });

  describe('extended BSB codes', () => {
    it('decodes Verb-PAI-3S', () => {
      const result = resolver.parseMorphologyMeaning('Verb-PAI-3S', 'en');
      expect(result).toBeTruthy();
      expect(result.source).toBe('builtin-bsb');
      expect(result.displayText).toContain('Part of speech: Verb');
      expect(result.displayText).toContain('Tense: Present');
      expect(result.displayText).toContain('Voice: Active');
      expect(result.displayText).toContain('Mood: Indicative');
      expect(result.displayText).toContain('Person: 3rd');
      expect(result.displayText).toContain('Number: Singular');
    });

    it('decodes Adj-NMD (Adjective Nominative Masculine Dual)', () => {
      const result = resolver.parseMorphologyMeaning('Adj-NMD', 'en');
      expect(result).toBeTruthy();
      expect(result.source).toBe('builtin-bsb');
      expect(result.displayText).toContain('Part of speech: Adjective');
      expect(result.displayText).toContain('Case: Nominative');
      expect(result.displayText).toContain('Gender: Masculine');
      expect(result.displayText).toContain('Number: Dual');
    });
  });

  describe('i18n for new values', () => {
    it('translates new Robinson values to Portuguese', () => {
      const result = resolver.parseMorphologyMeaning('V-RAI-3S', 'pt');
      expect(result).toBeTruthy();
      expect(result.displayText).toContain('Tempo: Perfeito');
      expect(result.displayText).toContain('Voz: Ativa');
      expect(result.displayText).toContain('Modo: Indicativo');
      expect(result.displayText).toContain('Pessoa: 3ª');
    });

    it('translates new Robinson values to Spanish', () => {
      const result = resolver.parseMorphologyMeaning('V-RAI-3S', 'es');
      expect(result).toBeTruthy();
      expect(result.displayText).toContain('Tiempo: Perfecto');
      expect(result.displayText).toContain('Voz: Activa');
      expect(result.displayText).toContain('Modo: Indicativo');
      expect(result.displayText).toContain('Persona: 3.ª');
    });

    it('translates new compact values to Portuguese', () => {
      const result = resolver.parseMorphologyMeaning('verb.polel.perf.p3.m.sg', 'pt');
      expect(result).toBeTruthy();
      expect(result.displayText).toContain('Classe: Verbo');
      expect(result.displayText).toContain('Tema: Polel');
      expect(result.displayText).toContain('Aspecto: Perfeito');
    });

    it('translates new compact values to Spanish', () => {
      const result = resolver.parseMorphologyMeaning('verb.polel.perf.p3.m.sg', 'es');
      expect(result).toBeTruthy();
      expect(result.displayText).toContain('Clase: Verbo');
      expect(result.displayText).toContain('Tema: Polel');
      expect(result.displayText).toContain('Aspecto: Perfecto');
    });

    it('translates particle to Portuguese', () => {
      const result = resolver.parseMorphologyMeaning('part', 'pt');
      expect(result).toBeTruthy();
      expect(result.displayText).toContain('Partícula');
    });

    it('translates particle to Spanish', () => {
      const result = resolver.parseMorphologyMeaning('part', 'es');
      expect(result).toBeTruthy();
      expect(result.displayText).toContain('Partícula');
    });
  });
});

describe('morphology resolver precedence', () => {
  let tmpDir;
  let bibleDb;
  let dictDb;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphe-morph-'));
    bibleDb = new Database(path.join(tmpDir, 'bible.sqlite3'));
    dictDb = new Database(path.join(tmpDir, 'dict.sqlite3'));

    bibleDb.exec(`
      CREATE TABLE info (name TEXT, value TEXT);
      CREATE TABLE verses (book_number INTEGER, chapter INTEGER, verse INTEGER, text TEXT);
      CREATE TABLE morphology_indications (indication TEXT, applicable_to TEXT, language TEXT, meaning TEXT);
      CREATE TABLE morphology_topics (indication TEXT, topic TEXT);
    `);
    dictDb.exec(`
      CREATE TABLE info (name TEXT, value TEXT);
      CREATE TABLE dictionary (topic TEXT, definition TEXT);
      CREATE TABLE morphology_indications (indication TEXT, applicable_to TEXT, meaning TEXT);
      CREATE TABLE morphology_topics (indication TEXT, topic TEXT);
    `);

    bibleDb.prepare('INSERT INTO info (name, value) VALUES (?, ?)').run('language', 'pt');
    dictDb.prepare('INSERT INTO info (name, value) VALUES (?, ?)').run('language', 'en');

    bibleDb
      .prepare(
        'INSERT INTO morphology_indications (indication, applicable_to, language, meaning) VALUES (?, ?, ?, ?)'
      )
      .run('subs', '', 'en', 'Noun');
    bibleDb
      .prepare(
        'INSERT INTO morphology_indications (indication, applicable_to, language, meaning) VALUES (?, ?, ?, ?)'
      )
      .run('f', 'subs', 'en', 'Feminine');
    bibleDb
      .prepare(
        'INSERT INTO morphology_indications (indication, applicable_to, language, meaning) VALUES (?, ?, ?, ?)'
      )
      .run('sg', 'subs', 'en', 'Singular');
    bibleDb
      .prepare(
        'INSERT INTO morphology_indications (indication, applicable_to, language, meaning) VALUES (?, ?, ?, ?)'
      )
      .run('a', 'subs', 'en', 'Absolute');
    bibleDb
      .prepare('INSERT INTO morphology_topics (indication, topic) VALUES (?, ?)')
      .run('subs.f.sg.a', 'G5721');

    dictDb
      .prepare(
        'INSERT INTO morphology_indications (indication, applicable_to, meaning) VALUES (?, ?, ?)'
      )
      .run('subs', '', 'Dictionary noun');
  });

  afterAll(() => {
    if (bibleDb) bibleDb.close();
    if (dictDb) dictDb.close();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('prefers Bible morphology tables over dictionary tables', () => {
    const result = resolver.resolveMorphology({
      bibleHandle: {
        db: bibleDb,
        info: sqliteProvider.getInfo(bibleDb),
        morphology: sqliteProvider.getMorphologyTableInfo(bibleDb),
      },
      dictHandle: {
        db: dictDb,
        info: sqliteProvider.getInfo(dictDb),
        morphology: sqliteProvider.getMorphologyTableInfo(dictDb),
      },
      morphCode: 'subs.f.sg.a',
      uiLanguage: 'en',
    });

    expect(result).toBeTruthy();
    expect(result.source).toBe('bible-table');
    expect(result.displayText).toContain('Noun');
    expect(result.displayText).toContain('Feminine');
    expect(result.topicRef).toBe('G5721');
  });

  it('falls back to built-in decoder when no tables match', () => {
    const result = resolver.resolveMorphology({
      bibleHandle: null,
      dictHandle: null,
      morphCode: 'verb.qal.perf.p3.m.sg',
      uiLanguage: 'en',
    });

    expect(result).toBeTruthy();
    expect(result.source).toBe('builtin-compact');
    expect(result.displayText).toContain('Part of speech: Verb');
    expect(result.displayText).toContain('Aspect: Perfect');
    expect(result.displayText).toContain('Person: 3rd');
  });

  it('returns raw code when no decoder matches', () => {
    const result = resolver.resolveMorphology({
      bibleHandle: null,
      dictHandle: null,
      morphCode: 'XYZ-UNKNOWN',
      uiLanguage: 'en',
    });

    expect(result).toBeTruthy();
    expect(result.source).toBe('unknown');
    expect(result.displayText).toBe('XYZ-UNKNOWN');
  });
});

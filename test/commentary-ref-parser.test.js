import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const parser = require('../src/renderer/js/commentary-ref-parser.js');

const bookNames = {
  pt: [
    { short: 'Mt', long: 'Mateus' },
    { short: 'Mc', long: 'Marcos' },
    { short: 'Lc', long: 'Lucas' },
    { short: 'Jo', long: 'João' },
    { short: '1Co', long: '1 Coríntios' },
    { short: 'Jd', long: 'Judas' },
  ],
};
const bookNumbers = [470, 480, 490, 500, 540, 730];

describe('commentary reference matcher', () => {
  const matcher = parser.buildReferenceMatcher(bookNames, bookNumbers);

  it('parses spaced references', () => {
    const refs = matcher.findMatches('Veja Mt 2:11 e Lc 1:2.');
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ bookNum: 470, chapter: 2, verseFrom: 11, verseTo: 11 });
    expect(refs[1]).toMatchObject({ bookNum: 490, chapter: 1, verseFrom: 2, verseTo: 2 });
  });

  it('parses dotted references', () => {
    const refs = matcher.findMatches('V. nota em Mt.2:11; compare Jo.4:20.');
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ bookNum: 470, chapter: 2, verseFrom: 11, verseTo: 11 });
    expect(refs[1]).toMatchObject({ bookNum: 500, chapter: 4, verseFrom: 20, verseTo: 20 });
  });

  it('parses numbered books with dot form', () => {
    const refs = matcher.findMatches('Paulo diz em 1Co.9:5.');
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ bookNum: 540, chapter: 9, verseFrom: 5, verseTo: 5 });
  });

  it('parses numbered books with space between number and abbreviation', () => {
    const refs = matcher.findMatches('Paulo diz em 1 Co 2:1.');
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ bookNum: 540, chapter: 2, verseFrom: 1, verseTo: 1 });
  });

  it('parses "1 Cor" and "Philem" aliases', () => {
    const names = {
      en: [
        { short: '1Co', long: '1 Corinthians' },
        { short: 'Phm', long: 'Philemon' },
      ],
    };
    const nums = [540, 570];
    const m = parser.buildReferenceMatcher(names, nums);
    const refs = m.findMatches('1 Cor 1:1-9 Philem 4');
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ bookNum: 540, chapter: 1, verseFrom: 1, verseTo: 9 });
    expect(refs[1]).toMatchObject({ bookNum: 570, chapter: 4, verseFrom: null, verseTo: null });
  });

  it('does not match "Cor" without numeric prefix', () => {
    const names = {
      pt: [{ short: '1Co', long: '1 Coríntios' }],
    };
    const nums = [540];
    const m = parser.buildReferenceMatcher(names, nums);
    expect(m.findMatches('Cor 1:1-9')).toHaveLength(0);
    expect(m.findMatches('1 Cor 1:1-9')).toHaveLength(1);
  });

  it('parses noisy chained legacy references with duplicated numbered prefix', () => {
    const names = {
      pt: [
        { short: '1Co', long: '1 Coríntios' },
        { short: 'Fp', long: 'Filipenses' },
        { short: 'Cl', long: 'Colossenses' },
        { short: '1Ts', long: '1 Tessalonicenses' },
        { short: '2Ts', long: '2 Tessalonicenses' },
        { short: '2Tm', long: '2 Timóteo' },
        { short: 'Fm', long: 'Filemom' },
      ],
    };
    const nums = [540, 610, 620, 630, 640, 660, 570];
    const m = parser.buildReferenceMatcher(names, nums);
    const text =
      'f. 1 Cor 1:1-9;.. Phil 1:1-8; Colossenses 1:1-8;. 1 Tessalonicenses 1:2; 22 Ts 1. :. 3, 2 Tm 1:3; Philem 4';
    const refs = m.findMatches(text);
    expect(refs).toHaveLength(7);
    expect(refs[0]).toMatchObject({ bookNum: 540, chapter: 1, verseFrom: 1, verseTo: 9 });
    expect(refs[1]).toMatchObject({ bookNum: 610, chapter: 1, verseFrom: 1, verseTo: 8 });
    expect(refs[2]).toMatchObject({ bookNum: 620, chapter: 1, verseFrom: 1, verseTo: 8 });
    expect(refs[3]).toMatchObject({ bookNum: 630, chapter: 1, verseFrom: 2, verseTo: 2 });
    expect(refs[4]).toMatchObject({ bookNum: 640, chapter: 1, verseFrom: 3, verseTo: 3 });
    expect(refs[5]).toMatchObject({ bookNum: 660, chapter: 1, verseFrom: 3, verseTo: 3 });
    expect(refs[6]).toMatchObject({ bookNum: 570, chapter: 4, verseFrom: null, verseTo: null });
  });

  it('parses chained refs with "2 Sam", chapter-only Salmo continuation and dotted spacing', () => {
    const names = {
      pt: [
        { short: '2Sm', long: '2 Samuel' },
        { short: 'Sl', long: 'Salmos' },
        { short: 'Is', long: 'Isaías' },
        { short: 'Jr', long: 'Jeremias' },
        { short: 'Ez', long: 'Ezequiel' },
      ],
    };
    const nums = [100, 230, 290, 300, 260];
    const m = parser.buildReferenceMatcher(names, nums);
    const text = 'er 2 Sam 7:12-16;. Salmo 89; 132;. Isa 11:1-5; Jer . 23:5-6;. Ez 34:23-24).';
    const refs = m.findMatches(text);
    expect(refs).toHaveLength(6);
    expect(refs[0]).toMatchObject({ bookNum: 100, chapter: 7, verseFrom: 12, verseTo: 16 });
    expect(refs[1]).toMatchObject({ bookNum: 230, chapter: 89, verseFrom: null, verseTo: null });
    expect(refs[2]).toMatchObject({ bookNum: 230, chapter: 132, verseFrom: null, verseTo: null });
    expect(refs[3]).toMatchObject({ bookNum: 290, chapter: 11, verseFrom: 1, verseTo: 5 });
    expect(refs[4]).toMatchObject({ bookNum: 300, chapter: 23, verseFrom: 5, verseTo: 6 });
    expect(refs[5]).toMatchObject({ bookNum: 260, chapter: 34, verseFrom: 23, verseTo: 24 });
  });

  it('parses mixed dotted-number prefix and Psalm/Isaiah continuations', () => {
    const names = {
      pt: [
        { short: 'Dt', long: 'Deuteronômio' },
        { short: '1Sm', long: '1 Samuel' },
        { short: 'Sl', long: 'Salmos' },
        { short: 'Is', long: 'Isaías' },
        { short: 'Lm', long: 'Lamentações' },
        { short: 'Lam', long: 'Lamentations' },
      ],
    };
    const nums = [50, 90, 230, 290, 310, 310];
    const m = parser.buildReferenceMatcher(names, nums);
    const text = 'g, Dt 30:3;. 1. Sam 23:21;. Ps 103 : 13; Isa 49:15; 54:8; Lam 4:10)';
    const refs = m.findMatches(text);
    expect(refs).toHaveLength(6);
    expect(refs[0]).toMatchObject({ bookNum: 50, chapter: 30, verseFrom: 3, verseTo: 3 });
    expect(refs[1]).toMatchObject({ bookNum: 90, chapter: 23, verseFrom: 21, verseTo: 21 });
    expect(refs[2]).toMatchObject({ bookNum: 230, chapter: 103, verseFrom: 13, verseTo: 13 });
    expect(refs[3]).toMatchObject({ bookNum: 290, chapter: 49, verseFrom: 15, verseTo: 15 });
    expect(refs[4]).toMatchObject({ bookNum: 290, chapter: 54, verseFrom: 8, verseTo: 8 });
    expect(refs[5]).toMatchObject({ bookNum: 310, chapter: 4, verseFrom: 10, verseTo: 10 });
  });

  it('parses ranges', () => {
    const refs = matcher.findMatches('Leia Mt.5:3-10.');
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ bookNum: 470, chapter: 5, verseFrom: 3, verseTo: 10 });
  });

  it('parses same-book follow-up references after semicolon/comma', () => {
    const refs = matcher.findMatches('Veja Jo 3:16; 4:2, 5 e Jo 5:24.');
    expect(refs).toHaveLength(4);
    expect(refs[0]).toMatchObject({ bookNum: 500, chapter: 3, verseFrom: 16, verseTo: 16 });
    expect(refs[1]).toMatchObject({ bookNum: 500, chapter: 4, verseFrom: 2, verseTo: 2 });
    expect(refs[2]).toMatchObject({ bookNum: 500, chapter: 4, verseFrom: 5, verseTo: 5 });
    expect(refs[3]).toMatchObject({ bookNum: 500, chapter: 5, verseFrom: 24, verseTo: 24 });
  });

  it('parses continuation-only chunks using context', () => {
    const refs = matcher.findContinuations(' 25, 27; 7:1-2', { bookNum: 490, chapter: 6 });
    expect(refs).toHaveLength(3);
    expect(refs[0]).toMatchObject({ bookNum: 490, chapter: 6, verseFrom: 25, verseTo: 25 });
    expect(refs[1]).toMatchObject({ bookNum: 490, chapter: 6, verseFrom: 27, verseTo: 27 });
    expect(refs[2]).toMatchObject({ bookNum: 490, chapter: 7, verseFrom: 1, verseTo: 2 });
  });

  it('parses chapter-only references', () => {
    const refs = matcher.findMatches('Veja Mt.23 e depois Jo 3:16.');
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ bookNum: 470, chapter: 23, verseFrom: null, verseTo: null });
    expect(refs[1]).toMatchObject({ bookNum: 500, chapter: 3, verseFrom: 16, verseTo: 16 });
  });

  it('parses Matt alias without turning into Titus (tt)', () => {
    const refs = matcher.findMatches('Matt 21:12-17');
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ bookNum: 470, chapter: 21, verseFrom: 12, verseTo: 17 });
    expect(refs[0].raw.toLowerCase()).toContain('matt');
  });

  it('ignores non-reference tokens', () => {
    const refs = matcher.findMatches('Isso nao deve virar link: Mt2:11 e XX.1:1');
    expect(refs).toHaveLength(0);
  });
});

describe('commentary reference matcher - broader abbreviations', () => {
  const broadBookNames = {
    en: [
      { short: 'Exod', long: 'Exodus' },
      { short: 'Deut', long: 'Deuteronomy' },
      { short: 'Josh', long: 'Joshua' },
      { short: 'Judg', long: 'Judges' },
      { short: '2Sa', long: '2 Samuel' },
      { short: 'Psa', long: 'Psalms' },
      { short: 'Isa', long: 'Isaiah' },
      { short: 'Jer', long: 'Jeremiah' },
      { short: 'Zeph', long: 'Zephaniah' },
      { short: 'Prov', long: 'Proverbs' },
      { short: 'Song', long: 'Song of Solomon' },
      { short: 'Zech', long: 'Zechariah' },
      { short: 'Gal', long: 'Galatians' },
      { short: 'Col', long: 'Colossians' },
      { short: 'Phil', long: 'Philippians' },
    ],
  };
  const broadBookNumbers = [20, 50, 60, 70, 100, 230, 290, 300, 360, 200, 220, 380, 550, 580, 610];
  const broadMatcher = parser.buildReferenceMatcher(broadBookNames, broadBookNumbers);

  it('parses mixed commentary patterns from legacy modules', () => {
    const text =
      'Exod 20:3-21 Deut 4:5-6 Josh 10:24-25 Zech 5:3; 14:12 2Sa 5:14 Solomon Prov 6:33 Prov 8:6 Judg 7:9 Song 1:3 Josh 2:14 Col 3:12 Phil 2:1-3 Phil 4:2 Deut 2:4';
    const refs = broadMatcher.findMatches(text);
    expect(refs).toHaveLength(15);
    expect(refs[0]).toMatchObject({ bookNum: 20, chapter: 20, verseFrom: 3, verseTo: 21 });
    expect(refs[1]).toMatchObject({ bookNum: 50, chapter: 4, verseFrom: 5, verseTo: 6 });
    expect(refs[2]).toMatchObject({ bookNum: 60, chapter: 10, verseFrom: 24, verseTo: 25 });
    expect(refs[3]).toMatchObject({ bookNum: 380, chapter: 5, verseFrom: 3, verseTo: 3 });
    expect(refs[4]).toMatchObject({ bookNum: 380, chapter: 14, verseFrom: 12, verseTo: 12 });
    expect(refs[5]).toMatchObject({ bookNum: 100, chapter: 5, verseFrom: 14, verseTo: 14 });
    expect(refs[6]).toMatchObject({ bookNum: 200, chapter: 6, verseFrom: 33, verseTo: 33 });
    expect(refs[7]).toMatchObject({ bookNum: 200, chapter: 8, verseFrom: 6, verseTo: 6 });
    expect(refs[8]).toMatchObject({ bookNum: 70, chapter: 7, verseFrom: 9, verseTo: 9 });
    expect(refs[9]).toMatchObject({ bookNum: 220, chapter: 1, verseFrom: 3, verseTo: 3 });
    expect(refs[10]).toMatchObject({ bookNum: 60, chapter: 2, verseFrom: 14, verseTo: 14 });
    expect(refs[11]).toMatchObject({ bookNum: 580, chapter: 3, verseFrom: 12, verseTo: 12 });
    expect(refs[12]).toMatchObject({ bookNum: 610, chapter: 2, verseFrom: 1, verseTo: 3 });
    expect(refs[13]).toMatchObject({ bookNum: 610, chapter: 4, verseFrom: 2, verseTo: 2 });
    expect(refs[14]).toMatchObject({ bookNum: 50, chapter: 2, verseFrom: 4, verseTo: 4 });
  });

  it('parses long chained semicolon lists and repeated book headers', () => {
    const text =
      'Jer 31:18-20  Psa 1:1; 2:12; 32:1-2; 41:1; 84:12; 112:1 Psa 119:1-2; 128:1; 146:5 Zeph 3:12 Gal 5:23 Isa 25:6; 41:17; 44:3 Isa 49:9-10; 55:1-3; 65:13; 66:11';
    const refs = broadMatcher.findMatches(text);
    expect(refs).toHaveLength(19);
    expect(refs[0]).toMatchObject({ bookNum: 300, chapter: 31, verseFrom: 18, verseTo: 20 });
    expect(refs[1]).toMatchObject({ bookNum: 230, chapter: 1, verseFrom: 1, verseTo: 1 });
    expect(refs[2]).toMatchObject({ bookNum: 230, chapter: 2, verseFrom: 12, verseTo: 12 });
    expect(refs[3]).toMatchObject({ bookNum: 230, chapter: 32, verseFrom: 1, verseTo: 2 });
    expect(refs[4]).toMatchObject({ bookNum: 230, chapter: 41, verseFrom: 1, verseTo: 1 });
    expect(refs[5]).toMatchObject({ bookNum: 230, chapter: 84, verseFrom: 12, verseTo: 12 });
    expect(refs[6]).toMatchObject({ bookNum: 230, chapter: 112, verseFrom: 1, verseTo: 1 });
    expect(refs[7]).toMatchObject({ bookNum: 230, chapter: 119, verseFrom: 1, verseTo: 2 });
    expect(refs[8]).toMatchObject({ bookNum: 230, chapter: 128, verseFrom: 1, verseTo: 1 });
    expect(refs[9]).toMatchObject({ bookNum: 230, chapter: 146, verseFrom: 5, verseTo: 5 });
    expect(refs[10]).toMatchObject({ bookNum: 360, chapter: 3, verseFrom: 12, verseTo: 12 });
    expect(refs[11]).toMatchObject({ bookNum: 550, chapter: 5, verseFrom: 23, verseTo: 23 });
    expect(refs[12]).toMatchObject({ bookNum: 290, chapter: 25, verseFrom: 6, verseTo: 6 });
    expect(refs[13]).toMatchObject({ bookNum: 290, chapter: 41, verseFrom: 17, verseTo: 17 });
    expect(refs[14]).toMatchObject({ bookNum: 290, chapter: 44, verseFrom: 3, verseTo: 3 });
    expect(refs[15]).toMatchObject({ bookNum: 290, chapter: 49, verseFrom: 9, verseTo: 10 });
    expect(refs[16]).toMatchObject({ bookNum: 290, chapter: 55, verseFrom: 1, verseTo: 3 });
    expect(refs[17]).toMatchObject({ bookNum: 290, chapter: 65, verseFrom: 13, verseTo: 13 });
    expect(refs[18]).toMatchObject({ bookNum: 290, chapter: 66, verseFrom: 11, verseTo: 11 });
  });

  it('parses split-node continuation style like "Prov 8:6" + "31:8-9"', () => {
    const first = broadMatcher.findMatches('Prov 8:6');
    expect(first).toHaveLength(1);
    const refs = broadMatcher.findContinuations('31:8-9', {
      bookNum: first[0].bookNum,
      chapter: first[0].chapter,
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ bookNum: 200, chapter: 31, verseFrom: 8, verseTo: 9 });
  });

  it('supports common English aliases even when canonical short differs', () => {
    const canonicalEnNames = {
      en: [
        { short: 'Exo', long: 'Exodus' },
        { short: 'Deu', long: 'Deuteronomy' },
        { short: 'Jos', long: 'Joshua' },
        { short: 'Jdg', long: 'Judges' },
        { short: 'Pro', long: 'Proverbs' },
        { short: 'Sol', long: 'Song of Solomon' },
      ],
    };
    const canonicalEnNums = [20, 50, 60, 70, 200, 220];
    const m = parser.buildReferenceMatcher(canonicalEnNames, canonicalEnNums);
    const refs = m.findMatches('Exod 20:3 Deut 2:4 Josh 2:14 Judg 7:9 Prov 8:6 Song 1:3');
    expect(refs).toHaveLength(6);
    expect(refs[0]).toMatchObject({ bookNum: 20, chapter: 20, verseFrom: 3, verseTo: 3 });
    expect(refs[1]).toMatchObject({ bookNum: 50, chapter: 2, verseFrom: 4, verseTo: 4 });
    expect(refs[2]).toMatchObject({ bookNum: 60, chapter: 2, verseFrom: 14, verseTo: 14 });
    expect(refs[3]).toMatchObject({ bookNum: 70, chapter: 7, verseFrom: 9, verseTo: 9 });
    expect(refs[4]).toMatchObject({ bookNum: 200, chapter: 8, verseFrom: 6, verseTo: 6 });
    expect(refs[5]).toMatchObject({ bookNum: 220, chapter: 1, verseFrom: 3, verseTo: 3 });
  });

  it('parses legacy Portuguese-like aliases and chapter-only chained refs', () => {
    const refs = broadMatcher.findMatches('2 Sam 7:12-16;. Salmo 89; 132;');
    expect(refs).toHaveLength(3);
    expect(refs[0]).toMatchObject({ bookNum: 100, chapter: 7, verseFrom: 12, verseTo: 16 });
    expect(refs[1]).toMatchObject({ bookNum: 230, chapter: 89, verseFrom: null, verseTo: null });
    expect(refs[2]).toMatchObject({ bookNum: 230, chapter: 132, verseFrom: null, verseTo: null });
  });

  it('requires explicit separator for continuation-only chunks when requested', () => {
    const refs = broadMatcher.findContinuations('01:05 A missão de Paulo', { bookNum: 470, chapter: 28 }, {
      requireSeparator: true,
    });
    expect(refs).toHaveLength(0);
  });
});

describe('leading reference parser', () => {
  it('parses chapter/verse with dot separator after abbreviation', () => {
    expect(parser.parseLeadingReferenceFromPlainText('Mt.2:11 texto')).toEqual({
      chapter: 2,
      verseFrom: 11,
      verseTo: 11,
    });
  });

  it('parses ranges at line start', () => {
    expect(parser.parseLeadingReferenceFromPlainText('1Co 13:4-7 amor')).toEqual({
      chapter: 13,
      verseFrom: 4,
      verseTo: 7,
    });
  });

  it('handles leading bracket markers', () => {
    expect(parser.parseLeadingReferenceFromPlainText('(Lc.1:1) introducao')).toEqual({
      chapter: 1,
      verseFrom: 1,
      verseTo: 1,
    });
  });

  it('returns null when no leading reference is present', () => {
    expect(parser.parseLeadingReferenceFromPlainText('Sem referencia aqui')).toBeNull();
  });

  it('parses chapter-only leading reference and defaults verse to 1', () => {
    expect(parser.parseLeadingReferenceFromPlainText('Mt.23 comentario')).toEqual({
      chapter: 23,
      verseFrom: 1,
      verseTo: 1,
    });
  });
});

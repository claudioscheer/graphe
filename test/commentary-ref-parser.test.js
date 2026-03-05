import { describe, it, expect } from 'vitest';
import * as parser from '../src/renderer/js/commentary-ref-parser.mjs';

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

describe('commentary reference matcher - noisy Portuguese references', () => {
  const ptBookNames = {
    pt: [
      { short: 'Gn', long: 'Gênesis' },
      { short: 'Êx', long: 'Êxodo' },
      { short: 'Lv', long: 'Levítico' },
      { short: 'Nm', long: 'Números' },
      { short: 'Dt', long: 'Deuteronômio' },
      { short: 'Js', long: 'Josué' },
      { short: 'Jz', long: 'Juízes' },
      { short: 'Rt', long: 'Rute' },
      { short: '1Sm', long: '1 Samuel' },
      { short: '2Sm', long: '2 Samuel' },
      { short: '1Rs', long: '1 Reis' },
      { short: '2Rs', long: '2 Reis' },
      { short: '1Cr', long: '1 Crônicas' },
      { short: '2Cr', long: '2 Crônicas' },
      { short: 'Ed', long: 'Esdras' },
      { short: 'Ne', long: 'Neemias' },
      { short: 'Et', long: 'Ester' },
      { short: 'Jó', long: 'Jó' },
      { short: 'Sl', long: 'Salmos' },
      { short: 'Pv', long: 'Provérbios' },
      { short: 'Ec', long: 'Eclesiastes' },
      { short: 'Ct', long: 'Cantares' },
      { short: 'Is', long: 'Isaías' },
      { short: 'Jr', long: 'Jeremias' },
      { short: 'Lm', long: 'Lamentações' },
      { short: 'Ez', long: 'Ezequiel' },
      { short: 'Dn', long: 'Daniel' },
      { short: 'Os', long: 'Oséias' },
      { short: 'Jl', long: 'Joel' },
      { short: 'Am', long: 'Amós' },
      { short: 'Ob', long: 'Obadias' },
      { short: 'Jn', long: 'Jonas' },
      { short: 'Mq', long: 'Miquéias' },
      { short: 'Na', long: 'Naum' },
      { short: 'Hc', long: 'Habacuque' },
      { short: 'Sf', long: 'Sofonias' },
      { short: 'Ag', long: 'Ageu' },
      { short: 'Zc', long: 'Zacarias' },
      { short: 'Ml', long: 'Malaquias' },
      { short: 'Mt', long: 'Mateus' },
      { short: 'Mc', long: 'Marcos' },
      { short: 'Lc', long: 'Lucas' },
      { short: 'Jo', long: 'João' },
      { short: 'At', long: 'Atos' },
      { short: 'Rm', long: 'Romanos' },
      { short: '1Co', long: '1 Coríntios' },
      { short: '2Co', long: '2 Coríntios' },
      { short: 'Gl', long: 'Gálatas' },
      { short: 'Ef', long: 'Efésios' },
      { short: 'Fp', long: 'Filipenses' },
      { short: 'Cl', long: 'Colossenses' },
      { short: '1Ts', long: '1 Tessalonicenses' },
      { short: '2Ts', long: '2 Tessalonicenses' },
      { short: '1Tm', long: '1 Timóteo' },
      { short: '2Tm', long: '2 Timóteo' },
      { short: 'Tt', long: 'Tito' },
      { short: 'Fm', long: 'Filemom' },
      { short: 'Hb', long: 'Hebreus' },
      { short: 'Tg', long: 'Tiago' },
      { short: '1Pe', long: '1 Pedro' },
      { short: '2Pe', long: '2 Pedro' },
      { short: '1Jo', long: '1 João' },
      { short: '2Jo', long: '2 João' },
      { short: '3Jo', long: '3 João' },
      { short: 'Jd', long: 'Judas' },
      { short: 'Ap', long: 'Apocalipse' },
    ],
  };
  const ptBookNumbers = [
    10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 190, 220, 230, 240,
    250, 260, 290, 300, 310, 330, 340, 350, 360, 370, 380, 390, 400, 410, 420, 430, 440, 450, 460,
    470, 480, 490, 500, 510, 520, 530, 540, 550, 560, 570, 580, 590, 600, 610, 620, 630, 640, 650,
    660, 670, 680, 690, 700, 710, 720, 730,
  ];
  const ptMatcher = parser.buildReferenceMatcher(ptBookNames, ptBookNumbers);

  it('parses the noisy examples from patristic commentary text', () => {
    expect(ptMatcher.findMatches('1Timóteo 4:10')).toMatchObject([
      { bookNum: 610, chapter: 4, verseFrom: 10, verseTo: 10 },
    ]);

    expect(ptMatcher.findMatches('foi feito. [ João 1:1-3.] Homilias sobre o Gênesis 1.1. [FC 71:47.]')).toMatchObject([
      { bookNum: 500, chapter: 1, verseFrom: 1, verseTo: 3 },
      { bookNum: 10, chapter: 1, verseFrom: 1, verseTo: 1 },
    ]);

    expect(ptMatcher.findMatches('Colossenses 1:16 ]')).toMatchObject([
      { bookNum: 580, chapter: 1, verseFrom: 16, verseTo: 16 },
    ]);

    expect(ptMatcher.findMatches('sobre Gênesis 1.8.3; 9.2. [FC 91:81.]')).toMatchObject([
      { bookNum: 10, chapter: 1, verseFrom: 8, verseTo: 8 },
      { bookNum: 10, chapter: 9, verseFrom: 2, verseTo: 2 },
    ]);

    expect(ptMatcher.findMatches('sobre Gênesis 1.14.1; 15.1. [FC')).toMatchObject([
      { bookNum: 10, chapter: 1, verseFrom: 14, verseTo: 14 },
      { bookNum: 10, chapter: 15, verseFrom: 1, verseTo: 1 },
    ]);

    expect(ptMatcher.findMatches('sobre João 18. [')).toMatchObject([
      { bookNum: 500, chapter: 18, verseFrom: null, verseTo: null },
    ]);

    expect(ptMatcher.findMatches('João 51.6.')).toMatchObject([
      { bookNum: 500, chapter: 51, verseFrom: 6, verseTo: 6 },
    ]);
  });

  it('accepts unaccented forms for accented Portuguese book names', () => {
    const refs = ptMatcher.findMatches('Genesis 1:1 Joao 3:16 1Timoteo 4:10');
    expect(refs).toHaveLength(3);
    expect(refs[0]).toMatchObject({ bookNum: 10, chapter: 1, verseFrom: 1, verseTo: 1 });
    expect(refs[1]).toMatchObject({ bookNum: 500, chapter: 3, verseFrom: 16, verseTo: 16 });
    expect(refs[2]).toMatchObject({ bookNum: 610, chapter: 4, verseFrom: 10, verseTo: 10 });
  });

  it('supports long-name references across the full Portuguese canon', () => {
    const refs = ptMatcher.findMatches(
      'Gênesis 1:1 Êxodo 2:2 Levítico 3:3 Números 4:4 Deuteronômio 5:5 Josué 6:6 Juízes 7:7 Rute 1:1 1Samuel 2:2 2Samuel 3:3 1Reis 4:4 2Reis 5:5 1Crônicas 6:6 2Crônicas 7:7 Esdras 8:8 Neemias 9:9 Ester 1:1 Jó 2:2 Salmos 3:3 Provérbios 4:4 Eclesiastes 5:5 Cantares 6:6 Isaías 7:7 Jeremias 8:8 Lamentações 9:9 Ezequiel 10:10 Daniel 11:11 Oséias 12:12 Joel 1:1 Amós 2:2 Obadias 1:1 Jonas 2:2 Miquéias 3:3 Naum 1:1 Habacuque 2:2 Sofonias 3:3 Ageu 1:1 Zacarias 2:2 Malaquias 3:3 Mateus 4:4 Marcos 5:5 Lucas 6:6 João 7:7 Atos 8:8 Romanos 9:9 1Coríntios 10:10 2Coríntios 11:11 Gálatas 1:1 Efésios 2:2 Filipenses 3:3 Colossenses 4:4 1Tessalonicenses 5:5 2Tessalonicenses 1:1 1Timóteo 2:2 2Timóteo 3:3 Tito 1:1 Filemom 1 Hebreus 2:2 Tiago 3:3 1Pedro 4:4 2Pedro 5:5 1João 1:1 2João 1:1 3João 1:1 Judas 1 Apocalipse 2:2'
    );
    expect(refs).toHaveLength(66);
    expect(refs[0]).toMatchObject({ bookNum: 10, chapter: 1, verseFrom: 1, verseTo: 1 });
    expect(refs[42]).toMatchObject({ bookNum: 500, chapter: 7, verseFrom: 7, verseTo: 7 });
    expect(refs[53]).toMatchObject({ bookNum: 610, chapter: 2, verseFrom: 2, verseTo: 2 });
    expect(refs[65]).toMatchObject({ bookNum: 730, chapter: 2, verseFrom: 2, verseTo: 2 });
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

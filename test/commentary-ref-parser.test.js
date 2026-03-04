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

  it('parses ranges', () => {
    const refs = matcher.findMatches('Leia Mt.5:3-10.');
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ bookNum: 470, chapter: 5, verseFrom: 3, verseTo: 10 });
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

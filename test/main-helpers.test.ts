import { describe, expect, it } from 'vitest';

import {
  BOOK_NAMES,
  GRAPHE_BOOK_NUMBERS,
  NT_BOOK_OFFSET,
  VERSES_PER_CHAPTER,
  buildVerseIndex,
  grapheToTwBook,
  twBookToGraphe,
} from '../src/main/modules/book-map.ts';
import {
  normalizeStrongNumber,
  sanitizeStrongTags,
  sanitizeSupportedTags,
} from '../src/main/modules/converters/tag-sanitizer.ts';
import { convertFile, getSupportedExtensions } from '../src/main/modules/converters/index.ts';

describe('book map helpers', () => {
  it('maps TheWord and Graphe book numbers in both directions', () => {
    expect(GRAPHE_BOOK_NUMBERS).toHaveLength(66);
    expect(VERSES_PER_CHAPTER).toHaveLength(66);
    expect(BOOK_NAMES[0]).toEqual({ short: 'Gen', long: 'Genesis' });
    expect(NT_BOOK_OFFSET).toBe(39);
    expect(twBookToGraphe(1)).toBe(10);
    expect(twBookToGraphe(66)).toBe(730);
    expect(twBookToGraphe(67)).toBeUndefined();
    expect(grapheToTwBook(10)).toBe(1);
    expect(grapheToTwBook(730)).toBe(66);
    expect(grapheToTwBook(999)).toBe(-1);
  });

  it('builds full and New Testament-only verse indexes', () => {
    const full = buildVerseIndex(false);
    const ntOnly = buildVerseIndex(true);

    expect(full.get(10)?.get(1)).toEqual({ startLine: 0, verseCount: 31 });
    expect(full.get(470)?.get(1)).toEqual({ startLine: 23145, verseCount: 25 });
    expect(ntOnly.has(10)).toBe(false);
    expect(ntOnly.get(470)?.get(1)).toEqual({ startLine: 0, verseCount: 25 });
    expect(ntOnly.get(730)?.get(22)).toEqual({ startLine: 7936, verseCount: 21 });
  });
});

describe('converter tag sanitizer helpers', () => {
  it('normalizes Strong numbers and removes malformed Strong tags', () => {
    expect(normalizeStrongNumber('H0430')).toBe('0430');
    expect(normalizeStrongNumber(3056)).toBe('3056');
    expect(normalizeStrongNumber(null)).toBe('');
    expect(sanitizeStrongTags('a<S>H0430</S>b<S><i>G3056</i></S>c<S>abc</S>d<S>orphan')).toBe(
      'a<S>0430</S>b<S>3056</S>cdorphan'
    );
  });

  it('keeps supported tags in canonical form and strips unsupported tags', () => {
    expect(
      sanitizeSupportedTags(
        '<pb><pb/><E><e><O><o><T><t><OG><og><OH><oh><TG><tg><TH><th><X><x>' +
          '<s></s><j>Jesus</j><i>x</i><f>n</f><h>h</h><m>m</m><l>l</l>' +
          '<span data-x="1">bad</span><bad/>'
      )
    ).toBe(
      '<pb/><pb/><E><e><O><o><T><t><OG><og><OH><oh><TG><tg><TH><th><X><x>' +
        '<S></S><J>Jesus</J><i>x</i><f>n</f><h>h</h><m>m</m><l>l</l>bad'
    );
  });
});

describe('converter registry', () => {
  it('lists supported extensions and rejects unknown input', async () => {
    expect(getSupportedExtensions()).toEqual([
      '.ont',
      '.ontx',
      '.nt',
      '.ntx',
      '.ot',
      '.otx',
      '.twm',
      '.mybible',
    ]);
    await expect(convertFile('/tmp/module.unknown', '/tmp')).rejects.toThrow(
      'Unsupported format: .unknown'
    );
  });
});

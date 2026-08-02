import { describe, expect, it } from 'vitest';

import {
  mapCanonicalIndexToGraphe,
  GRAPHE_BOOK_NUMBERS,
  CHAPTER_COUNTS,
} from '../../src/renderer/app/book-ids.js';
import { parseBibleHref } from '../../src/renderer/app/bible-ref.js';
import { GRAPHE_BOOK_NUMBERS as MAIN_BOOK_NUMBERS } from '../../src/main/modules/book-map.ts';

describe('book-ids', () => {
  it('maps canonical 1..66 indices to graphe book numbers', () => {
    expect(mapCanonicalIndexToGraphe(1)).toBe(10);
    expect(mapCanonicalIndexToGraphe(40)).toBe(470);
    expect(mapCanonicalIndexToGraphe(66)).toBe(730);
    expect(mapCanonicalIndexToGraphe(0)).toBeNull();
    expect(mapCanonicalIndexToGraphe(67)).toBeNull();
    expect(mapCanonicalIndexToGraphe(1.5)).toBeNull();
  });

  it('has 66 book numbers and chapter counts', () => {
    expect(GRAPHE_BOOK_NUMBERS).toHaveLength(66);
    expect(CHAPTER_COUNTS).toHaveLength(66);
  });

  it('stays in sync with main book-map GRAPHE_BOOK_NUMBERS', () => {
    expect([...GRAPHE_BOOK_NUMBERS]).toEqual([...MAIN_BOOK_NUMBERS]);
  });
});

describe('parseBibleHref', () => {
  it('parses B: refs with required verse when requireVerse is true', () => {
    expect(parseBibleHref('B:50 7:7', { requireVerse: true })).toEqual({
      bookNumber: 50,
      chapter: 7,
      verse: 7,
    });
    expect(parseBibleHref('B:50 7', { requireVerse: true })).toBeNull();
  });

  it('parses B: refs with optional verse when requireVerse is false', () => {
    expect(parseBibleHref('B:50 7:7')).toEqual({
      bookNumber: 50,
      chapter: 7,
      verse: 7,
    });
    expect(parseBibleHref('B:50 7')).toEqual({
      bookNumber: 50,
      chapter: 7,
      verse: null,
    });
  });

  it('parses MySword-style #b hash refs with canonical book index mapping', () => {
    expect(parseBibleHref('#b1.10.16')).toEqual({
      bookNumber: 10,
      chapter: 10,
      verse: 16,
    });
    expect(parseBibleHref('#b40.3.16')).toEqual({
      bookNumber: 470,
      chapter: 3,
      verse: 16,
    });
  });

  it('returns null for empty or invalid input', () => {
    expect(parseBibleHref(null)).toBeNull();
    expect(parseBibleHref('')).toBeNull();
    expect(parseBibleHref('not-a-ref')).toBeNull();
    expect(parseBibleHref('#b99.1.1')).toBeNull();
  });
});

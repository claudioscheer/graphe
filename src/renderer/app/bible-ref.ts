/**
 * Shared Bible reference href parsing (MyBible B: and MySword #b forms).
 */
import { mapCanonicalIndexToGraphe } from './book-ids.js';

export interface ParsedBibleRef {
  bookNumber: number;
  chapter: number;
  verse: number | null;
}

export interface ParseBibleHrefOptions {
  /** When true, B: refs must include a verse (dict-panel behavior). Default false. */
  requireVerse?: boolean;
}

/**
 * Parse a bible reference href.
 * Supports:
 *   B:50 7:7
 *   B:50 7        (when requireVerse is false)
 *   b:50 7:7-8    (verse ranges → first verse)
 *   #b1.10.16     (canonical 1..66 book index → Graphe book_number)
 */
export function parseBibleHref(
  rawHref: string | null | undefined,
  options: ParseBibleHrefOptions = {}
): ParsedBibleRef | null {
  if (!rawHref) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(String(rawHref).trim());
  } catch {
    decoded = String(rawHref).trim();
  }
  if (!decoded) return null;

  if (options.requireVerse) {
    const strict = decoded.match(/^B:(\d+)\s+(\d+):(\d+)/i);
    if (strict) {
      return {
        bookNumber: parseInt(strict[1], 10),
        chapter: parseInt(strict[2], 10),
        verse: parseInt(strict[3], 10),
      };
    }
  } else {
    const loose = decoded.match(/^B:(\d+)\s+(\d+)(?::(\d+))?/i);
    if (loose) {
      return {
        bookNumber: parseInt(loose[1], 10),
        chapter: parseInt(loose[2], 10),
        verse: loose[3] ? parseInt(loose[3], 10) : null,
      };
    }
  }

  const hashMatch = decoded.match(/^#b(\d+)\.(\d+)\.(\d+)/i);
  if (!hashMatch) return null;
  const mappedBook = mapCanonicalIndexToGraphe(parseInt(hashMatch[1], 10));
  if (!mappedBook) return null;
  return {
    bookNumber: mappedBook,
    chapter: parseInt(hashMatch[2], 10),
    verse: parseInt(hashMatch[3], 10),
  };
}

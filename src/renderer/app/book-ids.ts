/**
 * Canonical Graphe book numbers and chapter counts (Protestant 66-book order).
 * Single renderer source of truth — keep in sync with main book-map GRAPHE_BOOK_NUMBERS.
 */

/** Graphe book_number for each of the 66 books (index 0 = Genesis). */
export const GRAPHE_BOOK_NUMBERS: readonly number[] = [
  10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 190, 220, 230, 240, 250,
  260, 290, 300, 310, 330, 340, 350, 360, 370, 380, 390, 400, 410, 420, 430, 440, 450, 460, 470,
  480, 490, 500, 510, 520, 530, 540, 550, 560, 570, 580, 590, 600, 610, 620, 630, 640, 650, 660,
  670, 680, 690, 700, 710, 720, 730,
];

/** Standard chapter counts per book (index 0 = Genesis). */
export const CHAPTER_COUNTS: readonly number[] = [
  50, 40, 27, 36, 34, 24, 21, 4, 31, 24, 22, 25, 29, 36, 10, 13, 10, 42, 150, 31, 12, 8, 66, 52, 5,
  48, 12, 14, 3, 9, 1, 4, 7, 3, 3, 3, 2, 14, 4, 28, 16, 24, 21, 28, 16, 16, 13, 6, 6, 4, 4, 5, 3, 6,
  4, 3, 1, 13, 5, 5, 3, 5, 1, 1, 1, 22,
];

/**
 * Map canonical Protestant book index (1..66) to Graphe book_number.
 * Returns null when the index is out of range.
 */
export function mapCanonicalIndexToGraphe(bookIndex: number): number | null {
  if (!Number.isInteger(bookIndex) || bookIndex < 1 || bookIndex > GRAPHE_BOOK_NUMBERS.length) {
    return null;
  }
  return GRAPHE_BOOK_NUMBERS[bookIndex - 1];
}

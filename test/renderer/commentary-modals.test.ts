/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';

import { buildCoverageCell } from '../../src/renderer/app/commentary-modals.js';
import { I18n } from '../../src/renderer/app/i18n.js';

describe('buildCoverageCell', () => {
  it('classifies full, partial, and none coverage', () => {
    const genesis = I18n._BOOK_NUMBERS[0];

    const none = buildCoverageCell(genesis, 0, {});
    expect(none.classList.contains('coverage-none')).toBe(true);

    const full = buildCoverageCell(genesis, 0, {
      [genesis]: Array.from({ length: 50 }, (_, i) => i + 1),
    });
    expect(full.classList.contains('coverage-full')).toBe(true);

    const partial = buildCoverageCell(genesis, 0, { [genesis]: [1, 2, 3] });
    expect(partial.classList.contains('coverage-partial')).toBe(true);
    expect(partial.title).toContain('3/50');
  });
});

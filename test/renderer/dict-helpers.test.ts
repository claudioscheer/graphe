import { describe, expect, it } from 'vitest';

import {
  buildNestedList,
  buildSubList,
  formatDefinition,
  getLevel,
} from '../../src/renderer/js/dict-definition-format.js';
import { isExternalHref, normalizeTopicCandidate } from '../../src/renderer/js/dict-topic.js';

describe('dictionary definition formatting', () => {
  const restore = (value: string): string => value;

  it('formats preamble-only definitions', () => {
    expect(formatDefinition('<b>λόγος</b><p/>word speech')).toBe(
      '<div class="dict-def-preamble">word speech</div>'
    );
  });

  it('formats top-level and nested numbered definitions while preserving anchors', () => {
    expect(
      formatDefinition(
        'from root <a href="S:G3056">link</a> 1 first meaning 1a sub meaning 1a1 deep meaning 2 second meaning'
      )
    ).toBe(
      '<div class="dict-def-preamble">from root <a href="S:G3056">link</a></div>' +
        '<ol class="dict-def-list">' +
        '<li><span class="dict-def-label">1</span> first meaning' +
        '<ol class="dict-def-sublist">' +
        '<li><span class="dict-def-label">1a</span> sub meaning' +
        '<ol class="dict-def-sublist">' +
        '<li><span class="dict-def-label">1a1</span> deep meaning</li>' +
        '</ol></li></ol></li>' +
        '<li><span class="dict-def-label">2</span> second meaning</li>' +
        '</ol>'
    );
  });

  it('formats orphan sub-items as list items', () => {
    expect(buildNestedList([{ label: '1a', text: 'orphan' }], restore)).toBe(
      '<ol class="dict-def-list"><li><span class="dict-def-label">1a</span> orphan</li></ol>'
    );
  });

  it('formats sublists and levels directly', () => {
    expect(
      buildSubList(
        [
          { label: '1a', text: 'sub' },
          { label: '1a1', text: 'deep' },
        ],
        restore
      )
    ).toBe(
      '<ol class="dict-def-sublist">' +
        '<li><span class="dict-def-label">1a</span> sub' +
        '<ol class="dict-def-sublist"><li><span class="dict-def-label">1a1</span> deep</li></ol>' +
        '</li></ol>'
    );
    expect(getLevel('1')).toBe(0);
    expect(getLevel('1a')).toBe(1);
    expect(getLevel('1a1')).toBe(2);
  });
});

describe('dictionary topic helpers', () => {
  it('recognizes external links', () => {
    expect(isExternalHref('https://example.test')).toBe(true);
    expect(isExternalHref('mailto:test@example.test')).toBe(true);
    expect(isExternalHref('tel:555')).toBe(true);
    expect(isExternalHref('B:1 1:1')).toBe(false);
    expect(isExternalHref(null)).toBe(false);
  });

  it('normalizes topic candidates without changing bible anchors', () => {
    expect(normalizeTopicCandidate(null)).toBe('');
    expect(normalizeTopicCandidate('')).toBe('');
    expect(normalizeTopicCandidate('#Grace?x=1')).toBe('Grace');
    expect(normalizeTopicCandidate('#b1')).toBe('');
    expect(normalizeTopicCandidate('d:Faith')).toBe('Faith');
    expect(normalizeTopicCandidate('d-Love')).toBe('Love');
    expect(normalizeTopicCandidate('%E1%BC%80%CE%B3%CE%AC%CF%80%CE%B7')).toBe('ἀγάπη');
    expect(normalizeTopicCandidate('%E0%A4%A')).toBe('%E0%A4%A');
  });
});

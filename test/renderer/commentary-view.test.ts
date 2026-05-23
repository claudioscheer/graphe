// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommentaryView } from '../../src/renderer/js/commentary-view.js';
import { I18n } from '../../src/renderer/js/i18n.js';

describe('CommentaryView', () => {
  beforeEach(() => {
    localStorage.clear();
    I18n.setLang('en');
    document.body.innerHTML = '';
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof window.requestAnimationFrame;
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('renders commentary entries with sanitized references and body anchor metadata', () => {
    const container = document.createElement('div');

    CommentaryView.renderChapter(
      container,
      [
        {
          verseFrom: 1,
          verseTo: 3,
          text:
            '<strong>Gen 1:1-2</strong> God created. ' +
            '<a href="B:10 1:3" onclick="bad()">Gen 1:3</a>' +
            '<script>bad()</script>',
        },
        {
          verseFrom: 5,
          text: '<p>5 Continued note</p><p>See Gen 1:6 also.</p><div></div>',
        },
      ],
      10,
      1
    );

    const entries = container.querySelectorAll<HTMLElement>('.commentary-entry');
    expect(entries).toHaveLength(2);
    expect(entries[0].dataset.verseFrom).toBe('1');
    expect(entries[0].dataset.verseTo).toBe('3');
    expect(entries[0].querySelector('.commentary-verse-header')?.textContent).toBe('1-3');
    expect(entries[0].querySelector('script')).toBeNull();
    expect(entries[0].querySelector('a')).toBeNull();
    expect(
      Array.from(entries[0].querySelectorAll('.commentary-ref')).map((el) =>
        el.getAttribute('data-bhref')
      )
    ).toContain('B:10 1:3');
    expect(entries[0].querySelector('strong')?.dataset.bodyVerseFrom).toBe('1');
    expect(entries[0].querySelector('strong')?.dataset.bodyVerseTo).toBe('2');
    expect(entries[1].querySelector('.commentary-verse-header')?.textContent).toBe('5');
  });

  it('scrolls to exact body anchors, ranged entries, text references, and ignores misses', () => {
    const container = document.createElement('div');
    CommentaryView.renderChapter(
      container,
      [
        { verseFrom: 1, verseTo: 4, text: '<strong>Gen 1:2</strong> Exact body note' },
        { verseFrom: 5, verseTo: 7, text: 'Range note' },
        { verseFrom: 9, text: 'Gen 1:10 Text reference' },
      ],
      10,
      1
    );

    CommentaryView.scrollToVerse(container, 2);
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenLastCalledWith({
      behavior: 'auto',
      block: 'start',
    });

    CommentaryView.scrollToVerse(container, 6);
    CommentaryView.scrollToVerse(container, 10);
    CommentaryView.scrollToVerse(container, 99);
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(3);
  });
});

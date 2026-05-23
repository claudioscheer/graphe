// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BibleView } from '../../src/renderer/app/bible-view.js';

describe('BibleView', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    HTMLElement.prototype.scrollIntoView = vi.fn();
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof window.requestAnimationFrame;
  });

  it('parses MyBible and TheWord verse markup with optional Strong display', () => {
    const footnotes: string[] = [];
    const html = BibleView.parseVerseText(
      '<pb/><J>Jesus</J> <i>said</i> word <S>123</S><m>N-NSM</m><l>lemma</l>' +
        '<f>foot note</f><h>Heading</h><e>em</e><t>poem</t><n>hidden</n>',
      true,
      'H',
      footnotes
    );

    expect(footnotes).toEqual(['foot note']);
    expect(html).toContain('verse-jesus');
    expect(html).toContain('verse-italic');
    expect(html).toContain('verse-footnote-marker');
    expect(html).toContain('data-morph="N-NSM"');
    expect(html).toContain('data-lemma="lemma"');
    expect(html).toContain('title="lemma · N-NSM"');
    expect(html).toContain('>H123<');
    expect(html).not.toContain('hidden');

    expect(BibleView.parseVerseText('word <S>123</S>', false, 'G')).toBe('word');
    expect(BibleView.normalizeTheWordWordAnnotations('plain <RX 1><wt>', 'H')).toBe('plain ');
    expect(
      BibleView.normalizeTheWordWordAnnotations(
        '<E>Word<e><O>λόγος<o><T>logos<t><X>pr=lo|pbr=word|og=orig|es=meaning|ln=1|gk=2<x><S>3056</S>',
        'G'
      )
    ).toContain('verse-word-pronunciation');
    expect(BibleView.normalizeTheWordWordAnnotations('<E>broken', 'H')).toBe('<E>broken');
  });

  it('renders verses, cross references, footnotes, selections, scrolling, and selected text', () => {
    const container = document.createElement('div');
    BibleView.renderChapter(
      container,
      [
        {
          verse: 1,
          text: '<n>1-2</n> In the beginning <S>7225</S><f>first note</f>',
        },
        {
          verse: 2,
          text: '<E>God<e><O>אלהים<o><T>elohim<t><S>H430</S> created',
        },
        { verse: 3, text: '   ' },
      ],
      true,
      10,
      {
        crossRefMode: 'inline',
        bookNameResolver: (bookNumber) => `Book${bookNumber}`,
        crossRefs: [
          {
            book: 10,
            chapter: 1,
            verse: 1,
            bookTo: 20,
            chapterTo: 2,
            verseToStart: 3,
            verseToEnd: 4,
            votes: 1,
          },
          {
            book: 10,
            chapter: 1,
            verse: 1,
            bookTo: 20,
            chapterTo: 2,
            verseToStart: 3,
            verseToEnd: 4,
            votes: 2,
          },
          {
            book: 10,
            chapter: 1,
            verse: 1,
            bookTo: 20,
            chapterTo: 2,
            verseToStart: 5,
            votes: 1,
          },
          { book: 10, chapter: 1, verse: 2, bookTo: 30, chapterTo: 1, votes: 1 },
        ],
      }
    );

    const wrapper = container.querySelector<HTMLElement>('.verse-text') as HTMLElement;
    wrapper.dataset.bookShort = 'Gen';
    wrapper.dataset.chapter = '1';
    const lines = container.querySelectorAll<HTMLElement>('.verse-line');
    expect(lines).toHaveLength(2);
    expect(lines[0].querySelector('.verse-number')?.textContent).toBe('1-2');
    expect(lines[0].querySelectorAll('.crossref-link')).toHaveLength(2);
    expect(lines[0].querySelector('.crossref-link')?.textContent).toBe('Book20 2:3-4');
    expect(lines[1].querySelector('.crossref-link')?.textContent).toBe('Book30 1');

    BibleView.toggleVerseRefs(lines[0]);
    expect(lines[0].querySelector('.crossref-refs')).toBeNull();
    BibleView.toggleVerseRefs(lines[0]);
    expect(lines[0].querySelectorAll('.crossref-link')).toHaveLength(2);

    const marker = lines[0].querySelector<HTMLElement>('.verse-footnote-marker') as HTMLElement;
    marker.getBoundingClientRect = () =>
      ({ left: 20, top: 20, right: 30, bottom: 30, width: 10, height: 10 } as DOMRect);
    wrapper.getBoundingClientRect = () =>
      ({ left: 10, top: 10, right: 200, bottom: 200, width: 190, height: 190 } as DOMRect);
    marker.click();
    expect(container.querySelector('.verse-footnote-popover')?.innerHTML).toBe('first note');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(container.querySelector('.verse-footnote-popover')).toBeNull();

    lines[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(lines[0].classList.contains('verse-selected')).toBe(true);
    lines[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    expect(lines[1].classList.contains('verse-selected')).toBe(true);
    lines[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, shiftKey: true }));
    lines[0].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    expect(Array.from(lines).every((line) => line.classList.contains('verse-selected'))).toBe(true);

    expect(BibleView.getSelectedText(container)).toBe(
      '[Gen 1:1] In the beginning\n[Gen 1:2] God created'
    );

    BibleView.scrollToVerse(container, 1);
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'center',
    });
    BibleView.scrollToVerse(container, 99);

    lines.forEach((line) => line.classList.remove('verse-selected'));
    BibleView.selectAdjacentVerse(container, -1, false);
    expect(lines[1].classList.contains('verse-selected')).toBe(true);
    BibleView.selectAdjacentVerse(container, -1, true);
    expect(lines[0].classList.contains('verse-selected')).toBe(true);
    BibleView.selectAdjacentVerse(container, 1, false);
    expect(lines[1].classList.contains('verse-selected')).toBe(true);

    const empty = document.createElement('div');
    BibleView.selectAdjacentVerse(empty, 1, false);
    expect(BibleView.getSelectedText(empty)).toBe('');
  });

  it('handles hidden cross references and verses without toggleable references', () => {
    const container = document.createElement('div');
    BibleView.renderChapter(
      container,
      [{ verse: 1, text: 'No refs <S>G1</S>' }],
      false,
      470,
      { crossRefs: [{ book: 470, chapter: 1, verse: 2, bookTo: 10, chapterTo: 1, verseToStart: 1 }] }
    );
    const line = container.querySelector<HTMLElement>('.verse-line') as HTMLElement;

    expect(line.querySelector('.strongs')).toBeNull();
    expect(line.querySelector('.crossref-refs')).toBeNull();
    BibleView.toggleVerseRefs(line);
    expect(line.querySelector('.crossref-refs')).toBeNull();
  });
});

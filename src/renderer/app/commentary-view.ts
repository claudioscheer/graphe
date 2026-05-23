/**
 * commentary-view.js — Commentary rendering for commentary panes
 */
import {
  buildReferenceMatcher,
  parseLeadingReferenceFromPlainText,
} from './commentary-ref-parser.js';
import { I18n } from './i18n.js';
import { Sanitize } from './sanitize.js';

interface ParsedCommentaryReference {
  bookNum?: number;
  chapter: number;
  verseFrom?: number;
  verseTo?: number;
  raw?: string;
  index?: number;
  endIndex?: number;
}

interface ReferenceMatcherApi {
  findMatches(text: string | null | undefined): ParsedCommentaryReference[];
  findContinuations(
    text: string | null | undefined,
    context: ParsedCommentaryReference,
    opts?: { requireSeparator?: boolean }
  ): ParsedCommentaryReference[];
}

interface CommentaryViewApi {
  renderChapter(
    container: HTMLElement,
    entries: CommentaryEntry[],
    bookNumber: number,
    chapter: number
  ): void;
  scrollToVerse(container: HTMLElement, verseNum: number): void;
}

interface CommentaryRefContext {
  bookNum: number;
  chapter: number;
}

export const CommentaryView: CommentaryViewApi = (() => {
  const _refMatcher = buildReferenceMatcher(I18n._bookNames, I18n._BOOK_NUMBERS);

  function parseLeadingReference(text: string | null | undefined): ParsedCommentaryReference | null {
    if (!text) return null;
    const plain = new DOMParser().parseFromString(String(text), 'text/html').body.textContent || '';
    return parseLeadingReferenceFromPlainText(plain);
  }

  function parseVerseNumber(value: string | number | null | undefined): number | null {
    const n = parseInt(String(value ?? ''), 10);
    return Number.isFinite(n) ? n : null;
  }

  function parseRefFromString(value: string | null | undefined): ParsedCommentaryReference | null {
    return parseLeadingReference(value || '');
  }

  function matchesVerse(
    entryEl: HTMLElement,
    verseNum: number,
    fromAttr: string,
    toAttr: string
  ): boolean {
    const from = parseVerseNumber(entryEl.dataset[fromAttr]);
    if (!from) return false;
    const to = parseVerseNumber(entryEl.dataset[toAttr]) || from;
    return verseNum >= from && verseNum <= to;
  }

  function getLeadingText(node: Node): string {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const t = (child.textContent || '').trim();
        if (t) return t;
      }
      if (child.nodeType === Node.ELEMENT_NODE) {
        const t = (child.textContent || '').trim();
        if (t) return t;
      }
    }
    return '';
  }

  function setBodyAnchorMetadata(
    el: HTMLElement,
    ref: ParsedCommentaryReference | null,
    chapter: number
  ): void {
    if (!ref || ref.chapter !== chapter) return;
    el.dataset.bodyVerseFrom = String(ref.verseFrom);
    el.dataset.bodyVerseTo = String(ref.verseTo);
  }

  function annotateBodyVerseAnchors(body: HTMLElement, chapter: number): void {
    setBodyAnchorMetadata(body, parseRefFromString(getLeadingText(body)), chapter);

    for (const el of body.querySelectorAll<HTMLElement>('strong, b')) {
      setBodyAnchorMetadata(el, parseRefFromString(el.textContent || ''), chapter);
    }

    for (const el of body.querySelectorAll<HTMLElement>('p, li, div')) {
      if (el.querySelector('[data-body-verse-from]')) continue;
      setBodyAnchorMetadata(el, parseRefFromString(getLeadingText(el)), chapter);
    }
  }

  /**
   * Render commentary entries for a chapter.
   * @param {HTMLElement} container
   * @param {Array} entries - [{verseFrom, verseTo, chapterTo, text}]
   * @param {number} bookNumber
   * @param {number} chapter
   */
  function renderChapter(
    container: HTMLElement,
    entries: CommentaryEntry[],
    bookNumber: number,
    chapter: number
  ): void {
    container.innerHTML = '';
    const fragment = document.createDocumentFragment();
    const wrapper = document.createElement('div');
    wrapper.className = 'commentary-text px-6 py-4';

    for (const entry of entries) {
      const section = document.createElement('div');
      section.className = 'commentary-entry';
      section.dataset.verseFrom = String(entry.verseFrom || 1);
      if (entry.verseTo != null) section.dataset.verseTo = String(entry.verseTo);

      const leadingRef = parseLeadingReference(entry.text || '');
      if (leadingRef && leadingRef.chapter === chapter) {
        section.dataset.textVerseFrom = String(leadingRef.verseFrom);
        section.dataset.textVerseTo = String(leadingRef.verseTo);
      }

      const header = document.createElement('div');
      header.className = 'commentary-verse-header';
      if (entry.verseTo && entry.verseTo > entry.verseFrom) {
        header.textContent = `${entry.verseFrom}-${entry.verseTo}`;
      } else {
        header.textContent = String(entry.verseFrom);
      }

      const body = document.createElement('div');
      body.className = 'commentary-body';
      body.innerHTML = sanitizeCommentaryHtml(entry.text || '');
      annotateBodyVerseAnchors(body, chapter);

      section.appendChild(header);
      section.appendChild(body);
      wrapper.appendChild(section);
    }

    fragment.appendChild(wrapper);
    container.appendChild(fragment);
  }

  /**
   * Sanitize commentary HTML — full sanitization then convert bible reference links.
   */
  function sanitizeCommentaryHtml(html: string): string {
    function contextFromBhref(href: string | null | undefined): CommentaryRefContext | null {
      const m = String(href || '').match(/^B:(\d+)\s+(\d+)/i);
      if (!m) return null;
      return { bookNum: parseInt(m[1], 10), chapter: parseInt(m[2], 10) };
    }

    const safe = Sanitize.sanitizeHtml(html);
    // Convert bible reference <a> tags to <span> using DOM manipulation
    // to avoid attribute-injection risks from string interpolation.
    const doc = new DOMParser().parseFromString(safe, 'text/html');
    for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
      const href = a.getAttribute('href') || '';
      if (/^(?:[Bb]:|#b)/.test(href)) {
        const span = doc.createElement('span');
        span.className = 'commentary-ref';
        span.dataset.bhref = href;
        span.innerHTML = a.innerHTML;
        a.replaceWith(span);
      }
    }

    // Detect plain-text bible references in text nodes
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    while (walker.nextNode()) {
      if (walker.currentNode instanceof Text) textNodes.push(walker.currentNode);
    }

    let lastRefContext: ParsedCommentaryReference | CommentaryRefContext | null = null;
    for (const node of textNodes) {
      const refAncestor = node.parentElement && node.parentElement.closest('.commentary-ref');
      if (refAncestor) {
        const refContext = contextFromBhref((refAncestor as HTMLElement).dataset.bhref);
        if (refContext) lastRefContext = refContext;
        continue;
      }

      const text = node.textContent || '';
      let matches = (_refMatcher as ReferenceMatcherApi).findMatches(text);
      if (matches.length === 0 && lastRefContext) {
        matches = (_refMatcher as ReferenceMatcherApi).findContinuations(text, lastRefContext, {
          requireSeparator: true,
        });
      }
      if (matches.length === 0) continue;

      const frag = doc.createDocumentFragment();
      let lastIdx = 0;
      for (const match of matches) {
        if (match.index > lastIdx) {
          frag.appendChild(doc.createTextNode(text.slice(lastIdx, match.index)));
        }
        const span = doc.createElement('span');
        span.className = 'commentary-ref';
        span.dataset.bhref =
          match.verseFrom == null
            ? `B:${match.bookNum} ${match.chapter}`
            : `B:${match.bookNum} ${match.chapter}:${match.verseFrom}`;
        span.textContent = match.raw;
        frag.appendChild(span);
        lastIdx = match.endIndex;
      }
      if (lastIdx > 0) {
        if (lastIdx < text.length) {
          frag.appendChild(doc.createTextNode(text.slice(lastIdx)));
        }
        node.parentNode?.replaceChild(frag, node);
        const last = matches[matches.length - 1];
        if (last && Number.isFinite(last.bookNum) && Number.isFinite(last.chapter)) {
          lastRefContext = {
            bookNum: last.bookNum,
            chapter: last.chapter,
            verseFrom: last.verseFrom,
            verseTo: last.verseTo,
          };
        }
      }
    }

    return doc.body.innerHTML;
  }

  /**
   * Scroll to a specific verse commentary entry.
   */
  function scrollToVerse(container: HTMLElement, verseNum: number): void {
    const bodyAnchors = Array.from(
      container.querySelectorAll<HTMLElement>(
        '.commentary-body[data-body-verse-from], .commentary-body [data-body-verse-from]'
      )
    );
    let bodyAnchor = bodyAnchors.find(
      (el) =>
        parseVerseNumber(el.dataset.bodyVerseFrom) === verseNum &&
        (parseVerseNumber(el.dataset.bodyVerseTo) || parseVerseNumber(el.dataset.bodyVerseFrom)) ===
          verseNum
    );
    if (!bodyAnchor) {
      bodyAnchor = bodyAnchors.find((el) =>
        matchesVerse(el, verseNum, 'bodyVerseFrom', 'bodyVerseTo')
      );
    }
    if (bodyAnchor) {
      requestAnimationFrame(() => {
        bodyAnchor.scrollIntoView({ behavior: 'auto', block: 'start' });
      });
      return;
    }

    const entries = Array.from(container.querySelectorAll<HTMLElement>('.commentary-entry'));
    let entry = entries.find((el) => parseVerseNumber(el.dataset.verseFrom) === verseNum);
    if (!entry) entry = entries.find((el) => matchesVerse(el, verseNum, 'verseFrom', 'verseTo'));
    if (!entry)
      entry = entries.find((el) => parseVerseNumber(el.dataset.textVerseFrom) === verseNum);
    if (!entry)
      entry = entries.find((el) => matchesVerse(el, verseNum, 'textVerseFrom', 'textVerseTo'));
    if (!entry) return;
    requestAnimationFrame(() => {
      entry.scrollIntoView({ behavior: 'auto', block: 'start' });
    });
  }

  return { renderChapter, scrollToVerse };
})();

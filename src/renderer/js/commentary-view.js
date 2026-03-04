/**
 * commentary-view.js — Commentary rendering for commentary panes
 */
const CommentaryView = (() => {
  const _refMatcher = CommentaryRefParser.buildReferenceMatcher(I18n._bookNames, I18n._BOOK_NUMBERS);

  function parseLeadingReference(text) {
    if (!text) return null;
    const plain = new DOMParser().parseFromString(String(text), 'text/html').body.textContent || '';
    return CommentaryRefParser.parseLeadingReferenceFromPlainText(plain);
  }

  function parseVerseNumber(value) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
  }

  function parseRefFromString(value) {
    return parseLeadingReference(value || '');
  }

  function matchesVerse(entryEl, verseNum, fromAttr, toAttr) {
    const from = parseVerseNumber(entryEl.dataset[fromAttr]);
    if (!from) return false;
    const to = parseVerseNumber(entryEl.dataset[toAttr]) || from;
    return verseNum >= from && verseNum <= to;
  }

  function getLeadingText(node) {
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

  function setBodyAnchorMetadata(el, ref, chapter) {
    if (!ref || ref.chapter !== chapter) return;
    el.dataset.bodyVerseFrom = String(ref.verseFrom);
    el.dataset.bodyVerseTo = String(ref.verseTo);
  }

  function annotateBodyVerseAnchors(body, chapter) {
    setBodyAnchorMetadata(body, parseRefFromString(getLeadingText(body)), chapter);

    for (const el of body.querySelectorAll('strong, b')) {
      setBodyAnchorMetadata(el, parseRefFromString(el.textContent || ''), chapter);
    }

    for (const el of body.querySelectorAll('p, li, div')) {
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
  function renderChapter(container, entries, bookNumber, chapter) {
    container.innerHTML = '';
    const fragment = document.createDocumentFragment();
    const wrapper = document.createElement('div');
    wrapper.className = 'commentary-text px-6 py-4';

    for (const entry of entries) {
      const section = document.createElement('div');
      section.className = 'commentary-entry';
      section.dataset.verseFrom = entry.verseFrom;
      if (entry.verseTo != null) section.dataset.verseTo = entry.verseTo;

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
  function sanitizeCommentaryHtml(html) {
    function contextFromBhref(href) {
      const m = String(href || '').match(/^B:(\d+)\s+(\d+)/i);
      if (!m) return null;
      return { bookNum: parseInt(m[1], 10), chapter: parseInt(m[2], 10) };
    }

    const safe = Sanitize.sanitizeHtml(html);
    // Convert bible reference <a> tags to <span> using DOM manipulation
    // to avoid attribute-injection risks from string interpolation.
    const doc = new DOMParser().parseFromString(safe, 'text/html');
    for (const a of [...doc.querySelectorAll('a[href]')]) {
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
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    let lastRefContext = null;
    for (const node of textNodes) {
      const refAncestor = node.parentElement && node.parentElement.closest('.commentary-ref');
      if (refAncestor) {
        const refContext = contextFromBhref(refAncestor.dataset.bhref);
        if (refContext) lastRefContext = refContext;
        continue;
      }

      const text = node.textContent;
      let matches = _refMatcher.findMatches(text);
      if (matches.length === 0 && lastRefContext) {
        matches = _refMatcher.findContinuations(text, lastRefContext);
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
        node.parentNode.replaceChild(frag, node);
        const last = matches[matches.length - 1];
        if (last && Number.isFinite(last.bookNum) && Number.isFinite(last.chapter)) {
          lastRefContext = { bookNum: last.bookNum, chapter: last.chapter };
        }
      }
    }

    return doc.body.innerHTML;
  }

  /**
   * Scroll to a specific verse commentary entry.
   */
  function scrollToVerse(container, verseNum) {
    const bodyAnchors = Array.from(
      container.querySelectorAll('.commentary-body[data-body-verse-from], .commentary-body [data-body-verse-from]')
    );
    let bodyAnchor = bodyAnchors.find(
      (el) =>
        parseVerseNumber(el.dataset.bodyVerseFrom) === verseNum &&
        (parseVerseNumber(el.dataset.bodyVerseTo) || parseVerseNumber(el.dataset.bodyVerseFrom)) ===
          verseNum
    );
    if (!bodyAnchor) {
      bodyAnchor = bodyAnchors.find((el) => matchesVerse(el, verseNum, 'bodyVerseFrom', 'bodyVerseTo'));
    }
    if (bodyAnchor) {
      requestAnimationFrame(() => {
        bodyAnchor.scrollIntoView({ behavior: 'auto', block: 'start' });
      });
      return;
    }

    const entries = Array.from(container.querySelectorAll('.commentary-entry'));
    let entry = entries.find((el) => parseVerseNumber(el.dataset.verseFrom) === verseNum);
    if (!entry) entry = entries.find((el) => matchesVerse(el, verseNum, 'verseFrom', 'verseTo'));
    if (!entry) entry = entries.find((el) => parseVerseNumber(el.dataset.textVerseFrom) === verseNum);
    if (!entry) entry = entries.find((el) => matchesVerse(el, verseNum, 'textVerseFrom', 'textVerseTo'));
    if (!entry) return;
    requestAnimationFrame(() => {
      entry.scrollIntoView({ behavior: 'auto', block: 'start' });
    });
  }

  return { renderChapter, scrollToVerse };
})();

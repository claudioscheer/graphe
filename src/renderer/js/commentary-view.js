/**
 * commentary-view.js — Commentary rendering for commentary panes
 */
const CommentaryView = (() => {
  // --- Plain-text bible reference detection ---
  // Build abbreviation → book number lookup from all languages in I18n
  const _refAbbrToBookNum = new Map();
  const _refBaseSet = new Set();
  {
    const names = I18n._bookNames;
    const nums = I18n._BOOK_NUMBERS;
    for (const lang of Object.keys(names)) {
      for (let i = 0; i < names[lang].length; i++) {
        const bookNum = nums[i];
        for (const form of [names[lang][i].short, names[lang][i].long]) {
          const lower = form.toLowerCase();
          if (!_refAbbrToBookNum.has(lower)) _refAbbrToBookNum.set(lower, bookNum);
          // Register without spaces for numbered books: "1 samuel" → "1samuel"
          const compact = lower.replace(/\s+/g, '');
          if (compact !== lower && !_refAbbrToBookNum.has(compact))
            _refAbbrToBookNum.set(compact, bookNum);
          // Extract base abbreviation (strip leading digit + optional space)
          const m = lower.match(/^[123]\s*(.*)/);
          _refBaseSet.add(m ? m[1] : lower);
        }
      }
    }
  }
  // Build regex — sort longest first to avoid partial matches
  const _refBases = [..._refBaseSet].sort((a, b) => b.length - a.length);
  const _refPattern = _refBases.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const _refRegex = new RegExp(
    `([123])?\\s*(${_refPattern})\\s+(\\d{1,3})[.:](\\d{1,3})(?:\\s*[-–]\\s*(\\d{1,3}))?`,
    'gi'
  );

  function _resolveRefBook(prefix, abbrev) {
    const base = abbrev.toLowerCase();
    if (prefix) {
      return (
        _refAbbrToBookNum.get(prefix + base) ||
        _refAbbrToBookNum.get(prefix + ' ' + base) ||
        null
      );
    }
    return _refAbbrToBookNum.get(base) || null;
  }
  // --- end plain-text bible reference detection ---

  function parseLeadingReference(text) {
    if (!text) return null;
    const plain = new DOMParser().parseFromString(String(text), 'text/html').body.textContent || '';
    const firstLine = plain.trimStart().split(/\r?\n/, 1)[0].trim();
    const match = firstLine.match(
      /^(?:[\[({]\s*)?(?:(?:[1-3]\s*)?[A-Za-zÀ-ÖØ-öø-ÿ.]+\s+)?(\d{1,3})\s*[:.]\s*(\d{1,3})(?:\s*-\s*(\d{1,3}))?\b/
    );
    if (!match) return null;

    const chapter = parseInt(match[1], 10);
    const verseFrom = parseInt(match[2], 10);
    const verseTo = match[3] ? parseInt(match[3], 10) : verseFrom;
    if (!Number.isFinite(chapter) || !Number.isFinite(verseFrom) || !Number.isFinite(verseTo)) {
      return null;
    }
    return { chapter, verseFrom, verseTo };
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

    for (const node of textNodes) {
      if (node.parentElement && node.parentElement.closest('.commentary-ref')) continue;
      const text = node.textContent;
      _refRegex.lastIndex = 0;
      if (!_refRegex.test(text)) continue;
      _refRegex.lastIndex = 0;

      const frag = doc.createDocumentFragment();
      let lastIdx = 0;
      let m;
      while ((m = _refRegex.exec(text)) !== null) {
        const prefix = m[1] || '';
        const abbrev = m[2];
        const ch = m[3];
        const vs = m[4];
        const bookNum = _resolveRefBook(prefix, abbrev);
        if (!bookNum) continue;
        if (m.index > lastIdx) {
          frag.appendChild(doc.createTextNode(text.slice(lastIdx, m.index)));
        }
        const span = doc.createElement('span');
        span.className = 'commentary-ref';
        span.dataset.bhref = `B:${bookNum} ${ch}:${vs}`;
        span.textContent = m[0];
        frag.appendChild(span);
        lastIdx = m.index + m[0].length;
      }
      if (lastIdx > 0) {
        if (lastIdx < text.length) {
          frag.appendChild(doc.createTextNode(text.slice(lastIdx)));
        }
        node.parentNode.replaceChild(frag, node);
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

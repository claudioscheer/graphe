/**
 * bible-view.js — Verse rendering with Strong's number parsing
 */
const BibleView = (() => {
  /**
   * Parse verse text into HTML.
   * Handles: <S>number</S>, <pb/>, <f>...</f>, <i>...</i>
   */
  /**
   * Extract <n>X-Y</n> verse-range tag from the beginning of text.
   * Returns { range: 'X-Y' | null, text: remaining text }
   */
  function extractVerseRange(text) {
    const match = text.match(/^<n>([\d]+-[\d]+)<\/n>\s*/i);
    if (match) return { range: match[1], text: text.slice(match[0].length) };
    return { range: null, text };
  }

  function parseVerseText(text, showStrongs, strongsPrefix) {
    // Remove <f>...</f> footnotes
    let html = text.replace(/<f>[\s\S]*?<\/f>/gi, '');

    // Strip leading <pb/> so it doesn't push the first line away from the verse number
    html = html.replace(/^\s*(<pb\s*\/?>)+/i, '');

    // <pb/> → paragraph break
    html = html.replace(/<pb\s*\/?>/gi, '<span class="verse-pb"></span>');

    // <i>...</i> → italic
    html = html.replace(/<i>([\s\S]*?)<\/i>/gi, '<span class="verse-italic">$1</span>');

    // <n>...</n> → strip original-language annotations (dictionary lookup via Strong's is sufficient)
    html = html.replace(/<n>[\s\S]*?<\/n>/gi, '');

    // Strong's numbers — strip space between a word and its <S> tag (ARA+ has this, ACF+ doesn't)
    html = html.replace(/(\w) (?=<S>)/g, '$1');
    // Add space between consecutive Strong's tags so numbers don't merge
    html = html.replace(/<\/S><S>/gi, '</S> <S>');
    if (showStrongs) {
      html = html.replace(/<S>([GH]?\d+\w*)<\/S>/gi, (_, num) => {
        const display = /^[GH]/i.test(num) ? num.toUpperCase() : `${strongsPrefix}${num}`;
        return `<span class="strongs">${display}</span>`;
      });
    } else {
      html = html.replace(/<S>[\s\S]*?<\/S>/gi, '');
    }

    // Collapse multiple spaces left after tag removal
    html = html.replace(/ {2,}/g, ' ');

    return html;
  }

  /**
   * Render a full chapter into a container element.
   * @param {HTMLElement} container
   * @param {Array} verses - [{verse, text}]
   * @param {boolean} showStrongs
   */
  function formatRefLabel(ref, bookNameResolver) {
    const bookName = bookNameResolver ? bookNameResolver(ref.bookTo) : String(ref.bookTo);
    if (ref.verseToStart && ref.verseToEnd && ref.verseToEnd > ref.verseToStart) {
      return `${bookName} ${ref.chapterTo}:${ref.verseToStart}-${ref.verseToEnd}`;
    }
    if (ref.verseToStart) {
      return `${bookName} ${ref.chapterTo}:${ref.verseToStart}`;
    }
    return `${bookName} ${ref.chapterTo}`;
  }

  function createRefLink(ref, bookNameResolver) {
    const link = document.createElement('span');
    link.className = 'crossref-link';
    link.textContent = formatRefLabel(ref, bookNameResolver);
    link.dataset.bookTo = ref.bookTo;
    link.dataset.chapterTo = ref.chapterTo;
    link.dataset.verseTo = ref.verseToStart != null ? ref.verseToStart : '';
    return link;
  }

  function buildCrossRefsByVerse(crossRefs) {
    const map = new Map();
    for (const ref of crossRefs) {
      const key = ref.verse;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(ref);
    }
    return map;
  }

  function renderCrossRefsInline(container, crossRefsByVerse, bookNameResolver) {
    if (!crossRefsByVerse || crossRefsByVerse.size === 0) return;
    const lines = container.querySelectorAll('.verse-line');
    for (const line of lines) {
      const verse = parseInt(line.dataset.verse, 10);
      const refs = crossRefsByVerse.get(verse);
      if (!refs || refs.length === 0) continue;
      const span = document.createElement('span');
      span.className = 'crossref-refs';
      for (let i = 0; i < refs.length; i++) {
        if (i > 0) span.appendChild(document.createTextNode(' '));
        span.appendChild(createRefLink(refs[i], bookNameResolver));
      }
      line.appendChild(span);
    }
  }

  function renderChapter(container, verses, showStrongs, bookNumber, opts) {
    const { crossRefs, crossRefMode, bookNameResolver } = opts || {};
    const strongsPrefix = bookNumber < 470 ? 'H' : 'G';
    container.innerHTML = '';
    const fragment = document.createDocumentFragment();
    const wrapper = document.createElement('div');
    wrapper.className = 'verse-text px-6 py-4';

    const crossRefsByVerse =
      crossRefs && crossRefs.length > 0 ? buildCrossRefsByVerse(crossRefs) : null;

    // Store cross-ref data on the wrapper for right-click access
    if (crossRefsByVerse) {
      wrapper._crossRefsByVerse = crossRefsByVerse;
      wrapper._bookNameResolver = bookNameResolver;
    }

    let lastClickedVerse = null;

    for (const v of verses) {
      const trimmed = v.text.trim();

      // Skip empty verses (part of a verse range handled by another verse)
      if (!trimmed) continue;

      const { range, text: cleanText } = extractVerseRange(trimmed);

      const line = document.createElement('div');
      line.className = 'verse-line';
      line.dataset.verse = v.verse;

      // Verse number (use range like "2-6" if present)
      const numSpan = document.createElement('span');
      numSpan.className = 'verse-number';
      numSpan.textContent = range || v.verse;
      numSpan.id = `v-${v.verse}`;

      // Verse content
      const textSpan = document.createElement('span');
      textSpan.className = 'verse-content';
      textSpan.innerHTML = parseVerseText(cleanText, showStrongs, strongsPrefix);

      line.appendChild(numSpan);
      line.appendChild(textSpan);

      line.addEventListener('click', (e) => {
        if (e.target.closest('.crossref-link')) return;
        const all = Array.from(wrapper.querySelectorAll('.verse-line'));

        if (e.shiftKey && lastClickedVerse !== null) {
          const lastIdx = all.findIndex((el) => el.dataset.verse === String(lastClickedVerse));
          const curIdx = all.indexOf(line);
          if (lastIdx !== -1 && curIdx !== -1) {
            const from = Math.min(lastIdx, curIdx);
            const to = Math.max(lastIdx, curIdx);
            all.forEach((el) => el.classList.remove('verse-selected'));
            for (let i = from; i <= to; i++) all[i].classList.add('verse-selected');
          }
        } else if (e.ctrlKey || e.metaKey) {
          line.classList.toggle('verse-selected');
          lastClickedVerse = v.verse;
        } else {
          const wasSelected = line.classList.contains('verse-selected');
          all.forEach((el) => el.classList.remove('verse-selected'));
          if (!wasSelected) line.classList.add('verse-selected');
          lastClickedVerse = v.verse;
        }
      });

      wrapper.appendChild(line);
    }

    // Render inline cross-references if enabled
    if (crossRefMode === 'inline' && crossRefsByVerse) {
      renderCrossRefsInline(wrapper, crossRefsByVerse, bookNameResolver);
    }

    fragment.appendChild(wrapper);
    container.appendChild(fragment);
  }

  /**
   * Toggle cross-reference display for a specific verse line.
   */
  function toggleVerseRefs(verseLine) {
    const existing = verseLine.querySelector('.crossref-refs');
    if (existing) {
      existing.remove();
      return;
    }
    const wrapper = verseLine.closest('.verse-text');
    if (!wrapper || !wrapper._crossRefsByVerse) return;
    const verse = parseInt(verseLine.dataset.verse, 10);
    const refs = wrapper._crossRefsByVerse.get(verse);
    if (!refs || refs.length === 0) return;
    const span = document.createElement('span');
    span.className = 'crossref-refs';
    for (let i = 0; i < refs.length; i++) {
      if (i > 0) span.appendChild(document.createTextNode(' '));
      span.appendChild(createRefLink(refs[i], wrapper._bookNameResolver));
    }
    verseLine.appendChild(span);
  }

  /**
   * Scroll to a specific verse and highlight it briefly.
   */
  function scrollToVerse(container, verseNum) {
    const el = container.querySelector(`#v-${verseNum}`);
    if (!el) return;
    const line = el.closest('.verse-line');
    const target = line || el;
    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: 'auto', block: 'center' });
      container
        .querySelectorAll('.verse-selected')
        .forEach((v) => v.classList.remove('verse-selected'));
      target.classList.add('verse-selected');
    });
  }

  function selectAdjacentVerse(container, direction, shiftHeld) {
    const verses = container.querySelectorAll('.verse-line');
    if (verses.length === 0) return;

    const selected = Array.from(container.querySelectorAll('.verse-selected'));
    if (selected.length === 0) {
      const target = direction === 1 ? verses[0] : verses[verses.length - 1];
      target.classList.add('verse-selected');
      target.scrollIntoView({ block: 'nearest' });
      return;
    }

    const list = Array.from(verses);
    // Use the last selected verse in direction of movement as the anchor
    const anchor = direction === 1 ? selected[selected.length - 1] : selected[0];
    const idx = list.indexOf(anchor);
    const nextIdx = idx + direction;
    if (nextIdx < 0 || nextIdx >= list.length) return;

    if (shiftHeld) {
      list[nextIdx].classList.add('verse-selected');
    } else {
      list.forEach((el) => el.classList.remove('verse-selected'));
      list[nextIdx].classList.add('verse-selected');
    }
    list[nextIdx].scrollIntoView({ block: 'nearest' });
  }

  function getSelectedText(container) {
    const wrapper = container.querySelector('.verse-text');
    if (!wrapper) return '';
    const bookShort = wrapper.dataset.bookShort || '';
    const chapter = wrapper.dataset.chapter || '';
    const selected = wrapper.querySelectorAll('.verse-selected');
    if (selected.length === 0) return '';
    const lines = [];
    for (const el of selected) {
      const verse = el.dataset.verse;
      const content = el.querySelector('.verse-content');
      let text = '';
      if (content) {
        const clone = content.cloneNode(true);
        clone.querySelectorAll('.strongs, .verse-annotation').forEach((s) => s.remove());
        text = clone.textContent.trim();
      }
      lines.push(`[${bookShort} ${chapter}:${verse}] ${text}`);
    }
    return lines.join('\n');
  }

  return { renderChapter, scrollToVerse, selectAdjacentVerse, getSelectedText, toggleVerseRefs };
})();

/**
 * bible-view.js — Verse rendering with Strong's number parsing
 */
const BibleView = (() => {
  /**
   * Parse verse text into HTML.
   * Handles: <S>number</S>, <pb/>, <f>...</f>, <i>...</i>
   */
  function parseVerseText(text, showStrongs) {
    // Remove <f>...</f> footnotes
    let html = text.replace(/<f>[\s\S]*?<\/f>/gi, '');

    // Strip leading <pb/> so it doesn't push the first line away from the verse number
    html = html.replace(/^\s*(<pb\s*\/?>)+/i, '');

    // <pb/> → paragraph break
    html = html.replace(/<pb\s*\/?>/gi, '<span class="verse-pb"></span>');

    // <i>...</i> → italic
    html = html.replace(/<i>([\s\S]*?)<\/i>/gi, '<span class="verse-italic">$1</span>');

    // Strong's numbers — strip space between a word and its <S> tag (ARA+ has this, ACF+ doesn't)
    html = html.replace(/(\w) (?=<S>)/g, '$1');
    // Add space between consecutive Strong's tags so numbers don't merge
    html = html.replace(/<\/S><S>/gi, '</S> <S>');
    if (showStrongs) {
      html = html.replace(/<S>(\d+\w*)<\/S>/gi, '<span class="strongs">$1</span>');
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
  function renderChapter(container, verses, showStrongs) {
    container.innerHTML = '';
    const fragment = document.createDocumentFragment();
    const wrapper = document.createElement('div');
    wrapper.className = 'verse-text px-6 py-4';

    let lastClickedVerse = null;

    for (const v of verses) {
      const line = document.createElement('div');
      line.className = 'verse-line';
      line.dataset.verse = v.verse;

      // Verse number
      const numSpan = document.createElement('span');
      numSpan.className = 'verse-number';
      numSpan.textContent = v.verse;
      numSpan.id = `v-${v.verse}`;

      // Verse content
      const textSpan = document.createElement('span');
      textSpan.className = 'verse-content';
      textSpan.innerHTML = parseVerseText(v.text.trim(), showStrongs);

      line.appendChild(numSpan);
      line.appendChild(textSpan);

      line.addEventListener('click', (e) => {
        const all = Array.from(wrapper.querySelectorAll('.verse-line'));

        if (e.shiftKey && lastClickedVerse !== null) {
          // Shift+click: select range from lastClickedVerse to this verse
          const lastIdx = all.findIndex(el => el.dataset.verse === String(lastClickedVerse));
          const curIdx = all.indexOf(line);
          if (lastIdx !== -1 && curIdx !== -1) {
            const from = Math.min(lastIdx, curIdx);
            const to = Math.max(lastIdx, curIdx);
            // Clear previous selection, then select range
            all.forEach(el => el.classList.remove('verse-selected'));
            for (let i = from; i <= to; i++) all[i].classList.add('verse-selected');
          }
        } else if (e.ctrlKey || e.metaKey) {
          // Ctrl/Cmd+click: toggle this verse
          line.classList.toggle('verse-selected');
          lastClickedVerse = v.verse;
        } else {
          // Plain click: deselect all, select this verse
          all.forEach(el => el.classList.remove('verse-selected'));
          line.classList.toggle('verse-selected');
          lastClickedVerse = v.verse;
        }
      });

      wrapper.appendChild(line);
    }

    fragment.appendChild(wrapper);
    container.appendChild(fragment);
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
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('verse-highlight');
      setTimeout(() => target.classList.remove('verse-highlight'), 2000);
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
      list.forEach(el => el.classList.remove('verse-selected'));
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
      const text = content ? content.textContent.trim() : '';
      lines.push(`[${bookShort} ${chapter}:${verse}] ${text}`);
    }
    return lines.join('\n');
  }

  return { renderChapter, scrollToVerse, selectAdjacentVerse, getSelectedText };
})();

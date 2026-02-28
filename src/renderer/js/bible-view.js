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

    // <pb/> → paragraph break
    html = html.replace(/<pb\s*\/?>/gi, '<span class="verse-pb"></span>');

    // <i>...</i> → italic
    html = html.replace(/<i>([\s\S]*?)<\/i>/gi, '<span class="verse-italic">$1</span>');

    // Strong's numbers
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

      // Click to select (one at a time per container)
      line.addEventListener('click', () => {
        const prev = wrapper.querySelector('.verse-selected');
        if (prev && prev !== line) prev.classList.remove('verse-selected');
        line.classList.toggle('verse-selected');
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

  return { renderChapter, scrollToVerse };
})();

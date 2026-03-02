/**
 * commentary-view.js — Commentary rendering for commentary panes
 */
const CommentaryView = (() => {
  /**
   * Render commentary entries for a chapter.
   * @param {HTMLElement} container
   * @param {Array} entries - [{verseFrom, verseTo, chapterTo, text}]
   * @param {number} bookNumber
   */
  function renderChapter(container, entries, bookNumber) {
    container.innerHTML = '';
    const fragment = document.createDocumentFragment();
    const wrapper = document.createElement('div');
    wrapper.className = 'commentary-text px-6 py-4';

    for (const entry of entries) {
      const section = document.createElement('div');
      section.className = 'commentary-entry';
      section.dataset.verseFrom = entry.verseFrom;

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
    return doc.body.innerHTML;
  }

  /**
   * Scroll to a specific verse commentary entry.
   */
  function scrollToVerse(container, verseNum) {
    const entry = container.querySelector(`.commentary-entry[data-verse-from="${verseNum}"]`);
    if (!entry) return;
    requestAnimationFrame(() => {
      entry.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  return { renderChapter, scrollToVerse };
})();

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
   * Sanitize commentary HTML — adjust internal links and clean up.
   */
  function sanitizeCommentaryHtml(html) {
    // Remove script tags for safety
    let safe = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    // Convert <a class='B' href='B:...'> links to non-navigating spans
    safe = safe.replace(/<a\b[^>]*class=['"]B['"][^>]*>([\s\S]*?)<\/a>/gi, '<span class="commentary-ref">$1</span>');
    return safe;
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

/**
 * Cross-reference preview modal.
 */
import { BibleView } from './bible-view.js';
import { I18n } from './i18n.js';

interface CrossRefPreviewOptions {
  moduleId: string;
  hasStrongs?: boolean;
  bookNumber: number;
  chapter: number;
  verse: number | null;
}

export const CrossRefPreview = (() => {
  const overlay = document.getElementById('crossref-preview-overlay');
  const closeBtn = document.getElementById('crossref-preview-close');
  const titleEl = document.getElementById('crossref-preview-title');
  const subtitleEl = document.getElementById('crossref-preview-subtitle');
  const contentEl = document.getElementById('crossref-preview-content');
  let requestToken = 0;

  function isOpen(): boolean {
    return !!overlay && !overlay.classList.contains('hidden');
  }

  function close(): void {
    if (!overlay) return;
    overlay.classList.add('hidden');
  }

  function renderMessage(message: string): void {
    if (!contentEl) return;
    contentEl.innerHTML = '';
    const msg = document.createElement('div');
    msg.className = 'crossref-preview-empty';
    msg.textContent = message;
    contentEl.appendChild(msg);
  }

  async function open({
    moduleId,
    hasStrongs,
    bookNumber,
    chapter,
    verse,
  }: CrossRefPreviewOptions): Promise<void> {
    if (!overlay || !titleEl || !contentEl) return;
    const token = ++requestToken;
    overlay.classList.remove('hidden');
    titleEl.textContent = '...';
    if (subtitleEl) subtitleEl.textContent = moduleId || '';
    renderMessage('...');

    try {
      const verses = await window.api.getChapter(moduleId, bookNumber, chapter);
      if (token !== requestToken) return;

      titleEl.textContent = `${I18n.bookName(bookNumber).short} ${chapter}`;
      if (subtitleEl) subtitleEl.textContent = moduleId || '';

      BibleView.renderChapter(contentEl, verses || [], !!hasStrongs, bookNumber, {
        crossRefs: null,
        crossRefMode: 'none',
      });

      if (verse != null) {
        BibleView.scrollToVerse(contentEl, verse);
      } else {
        contentEl.scrollTop = 0;
      }
    } catch (_err) {
      if (token !== requestToken) return;
      renderMessage(I18n.t('refUnavailable'));
    }
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', close);
  }
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }

  return { open, close, isOpen };
})();

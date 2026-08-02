/**
 * Commentary coverage and all-commentaries modals.
 */
import { CHAPTER_COUNTS } from './book-ids.js';
import { compactRanges } from './commentary-coverage.js';
import { I18n } from './i18n.js';
import { Icons } from './icons.js';
import { Sanitize } from './sanitize.js';

export async function openAllCommentariesModal(opts: {
  bookNumber: number;
  chapter: number;
  verse: number;
  commentaryModules: ModuleRecord[];
}): Promise<void> {
  const { bookNumber, chapter, verse, commentaryModules } = opts;

  const bookName = I18n.bookName(bookNumber);
  const refLabel = `${bookName.short} ${chapter}:${verse}`;

  const results = await Promise.all(
    commentaryModules.map(
      async (mod): Promise<{ module: ModuleRecord; entries: CommentaryEntry[] }> => {
        try {
          const entries = await window.api.getCommentary(mod.id, bookNumber, chapter);
          const matching = entries.filter(
            (e) => e.verseFrom <= verse && (e.verseTo >= verse || e.verseTo === 0)
          );
          return { module: mod, entries: matching };
        } catch {
          return { module: mod, entries: [] };
        }
      }
    )
  );

  const withEntries = results.filter((r) => r.entries.length > 0);

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-40 bg-black/50 flex items-center justify-center';
  overlay.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.target === overlay) overlay.remove();
  });

  const modal = document.createElement('div');
  modal.className =
    'bg-brand-50 dark:bg-night-800 shadow-2xl w-[720px] max-w-[92vw] max-h-[85vh] flex flex-col overflow-hidden break-words';

  const header = document.createElement('div');
  header.className =
    'p-4 border-b border-brand-300 dark:border-night-600 flex items-center justify-between min-w-0';
  const title = document.createElement('h2');
  title.className = 'text-lg font-semibold min-w-0 truncate';
  title.textContent = `${I18n.t('allCommentaries')} — ${refLabel}`;
  const closeBtn = document.createElement('button');
  closeBtn.className =
    'px-2 py-1 rounded-sm hover:bg-brand-200 dark:hover:bg-night-700 text-brand-500 dark:text-night-400 cursor-pointer transition-colors inline-flex items-center justify-center';
  closeBtn.appendChild(Icons.create('x'));
  closeBtn.addEventListener('click', () => overlay.remove());
  header.append(title, closeBtn);

  const body = document.createElement('div');
  body.className = 'p-4 overflow-y-auto flex-1 min-w-0 overflow-x-hidden';

  if (withEntries.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'text-brand-500 dark:text-night-400 text-sm italic';
    msg.textContent = I18n.t('allCommentariesNoResults');
    body.appendChild(msg);
  } else {
    for (const { module: mod, entries } of withEntries) {
      const section = document.createElement('div');
      section.className = 'mb-6 last:mb-0';

      const heading = document.createElement('h3');
      heading.className =
        'text-sm font-semibold text-brand-700 dark:text-night-200 mb-2 pb-1 border-b border-brand-200 dark:border-night-600 cursor-pointer flex items-center gap-1.5 select-none';

      const chevron = Icons.create('chevron-right');
      chevron.style.transition = 'transform 0.15s';
      chevron.style.transform = 'rotate(0deg)';
      chevron.style.flexShrink = '0';
      heading.appendChild(chevron);
      heading.appendChild(document.createTextNode(mod.displayName || mod.id));
      section.appendChild(heading);

      const contentWrapper = document.createElement('div');
      contentWrapper.style.display = 'none';

      for (const entry of entries) {
        const entryDiv = document.createElement('div');
        entryDiv.className = 'commentary-body text-sm mb-2';
        entryDiv.innerHTML = Sanitize.sanitizeHtml(entry.text || '');
        contentWrapper.appendChild(entryDiv);
      }

      heading.addEventListener('click', () => {
        const collapsed = contentWrapper.style.display === 'none';
        contentWrapper.style.display = collapsed ? 'block' : 'none';
        chevron.style.transform = collapsed ? 'rotate(90deg)' : 'rotate(0deg)';
      });

      section.appendChild(contentWrapper);
      body.appendChild(section);
    }
  }

  modal.append(header, body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);
}

export async function openCommentaryCoverageModal(opts: { moduleId: string }): Promise<void> {
  const coverage = await window.api.getCommentaryCoverage(opts.moduleId);
  const bookNumbers = I18n._BOOK_NUMBERS;

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-40 bg-black/50 flex items-center justify-center';
  overlay.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.target === overlay) overlay.remove();
  });

  const modal = document.createElement('div');
  modal.className =
    'bg-brand-50 dark:bg-night-800 shadow-2xl w-[620px] max-w-[92vw] max-h-[85vh] flex flex-col overflow-hidden';

  const header = document.createElement('div');
  header.className =
    'p-4 border-b border-brand-300 dark:border-night-600 flex items-center justify-between';
  const title = document.createElement('h2');
  title.className = 'text-lg font-semibold';
  title.textContent = I18n.t('commentaryCoverage');
  const closeBtn = document.createElement('button');
  closeBtn.className =
    'px-2 py-1 rounded-sm hover:bg-brand-200 dark:hover:bg-night-700 text-brand-500 dark:text-night-400 cursor-pointer transition-colors inline-flex items-center justify-center';
  closeBtn.appendChild(Icons.create('x'));
  closeBtn.addEventListener('click', () => overlay.remove());
  header.append(title, closeBtn);

  const legend = document.createElement('div');
  legend.className = 'px-4 pt-3 pb-1 flex gap-4 text-xs text-brand-600 dark:text-night-300';
  for (const [cls, key] of [
    ['coverage-full', 'coverageFull'],
    ['coverage-partial', 'coveragePartial'],
    ['coverage-none', 'coverageNone'],
  ]) {
    const item = document.createElement('span');
    item.className = 'flex items-center gap-1.5';
    const dot = document.createElement('span');
    dot.className = `inline-block w-3 h-3 ${cls}`;
    item.append(dot, I18n.t(key));
    legend.appendChild(item);
  }

  const grid = document.createElement('div');
  grid.className = 'p-4 overflow-y-auto coverage-grid';

  const otLabel = document.createElement('div');
  otLabel.className = 'text-xs font-semibold text-brand-500 dark:text-night-400 mb-1.5';
  otLabel.textContent = I18n.t('oldTestament');
  grid.appendChild(otLabel);

  const otGrid = document.createElement('div');
  otGrid.className = 'grid gap-1.5 mb-4';
  otGrid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(52px, 1fr))';

  for (let i = 0; i < 39; i++) {
    otGrid.appendChild(buildCoverageCell(bookNumbers[i], i, coverage));
  }
  grid.appendChild(otGrid);

  const ntLabel = document.createElement('div');
  ntLabel.className = 'text-xs font-semibold text-brand-500 dark:text-night-400 mb-1.5';
  ntLabel.textContent = I18n.t('newTestament');
  grid.appendChild(ntLabel);

  const ntGrid = document.createElement('div');
  ntGrid.className = 'grid gap-1.5';
  ntGrid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(52px, 1fr))';

  for (let i = 39; i < 66; i++) {
    ntGrid.appendChild(buildCoverageCell(bookNumbers[i], i, coverage));
  }
  grid.appendChild(ntGrid);

  modal.append(header, legend, grid);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);
}

function buildCoverageCell(
  bookNumber: number,
  bookIndex: number,
  coverage: CommentaryCoverage
): HTMLElement {
  const totalChapters = CHAPTER_COUNTS[bookIndex];
  const coveredChapters = coverage[bookNumber] || [];
  const name = I18n.bookName(bookNumber);
  const ratio = coveredChapters.length / totalChapters;

  const cell = document.createElement('div');
  cell.className = 'coverage-cell';

  if (ratio === 0) {
    cell.classList.add('coverage-none');
    cell.title = `${name.long}: ${I18n.t('coverageNone')}`;
  } else if (ratio >= 1) {
    cell.classList.add('coverage-full');
    cell.title = `${name.long}: ${I18n.t('coverageFull')} (${totalChapters} ${I18n.t('coverageChapters')})`;
  } else {
    cell.classList.add('coverage-partial');
    const coveredSet = new Set(coveredChapters);
    const missing: number[] = [];
    for (let ch = 1; ch <= totalChapters; ch++) {
      if (!coveredSet.has(ch)) missing.push(ch);
    }
    const missingStr = compactRanges(missing);
    cell.title = `${name.long}: ${coveredChapters.length}/${totalChapters} ${I18n.t('coverageChapters')}\n${I18n.t('coverageMissingChapters')}: ${missingStr}`;
  }

  cell.textContent = name.short;
  return cell;
}

/** Exported for unit tests. */
export { buildCoverageCell };

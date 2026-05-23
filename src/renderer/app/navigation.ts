/**
 * navigation.js — Navigation dialog with book/chapter grids + quick input
 */
import { I18n } from './i18n.js';

interface NavigationPane {
  moduleId: string;
}

interface NavigationPaneManagerApi {
  getPane(paneId: string | null): NavigationPane | null;
  navigatePane(
    paneId: string | null,
    bookNumber: number,
    chapter: number,
    verse?: number | null
  ): Promise<boolean>;
}

interface NavigationApi {
  init(): void;
  open(paneId: string, books: BookRecord[]): void;
  close(): void;
}

let paneManagerApi: NavigationPaneManagerApi | null = null;

export function setNavigationPaneManager(api: NavigationPaneManagerApi): void {
  paneManagerApi = api;
}

export const Navigation: NavigationApi = (() => {
  let activePaneId: string | null = null;
  let currentBooks: BookRecord[] = [];
  let selectedBook: BookRecord | null = null;
  let selectedChapter: number | null = null;

  const overlay = (): HTMLElement => document.getElementById('nav-overlay') as HTMLElement;
  const grid = (): HTMLElement => document.getElementById('nav-grid') as HTMLElement;
  const input = (): HTMLInputElement => document.getElementById('nav-input') as HTMLInputElement;
  const backBtn = (): HTMLButtonElement => document.getElementById('nav-back') as HTMLButtonElement;
  const closeBtn = (): HTMLButtonElement => document.getElementById('nav-close') as HTMLButtonElement;

  function init(): void {
    closeBtn().addEventListener('click', close);
    backBtn().addEventListener('click', handleBack);
    overlay().addEventListener('click', (e: MouseEvent) => {
      if (e.target === overlay()) close();
    });
    input().addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') handleQuickInput();
    });
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !overlay().classList.contains('hidden')) {
        close();
      }
    });
  }

  function open(paneId: string, books: BookRecord[]): void {
    activePaneId = paneId;
    currentBooks = books;
    selectedBook = null;
    selectedChapter = null;
    overlay().classList.remove('hidden');
    input().value = '';
    input().focus();
    showBooks();
  }

  function close(): void {
    overlay().classList.add('hidden');
    activePaneId = null;
    selectedBook = null;
    selectedChapter = null;
  }

  function showBooks(): void {
    selectedBook = null;
    selectedChapter = null;
    backBtn().classList.add('hidden');
    const g = grid();
    g.innerHTML = '';

    // Group books into OT and NT
    const ot = currentBooks.filter((b) => b.bookNumber < 470);
    const nt = currentBooks.filter((b) => b.bookNumber >= 470);

    if (ot.length > 0) {
      g.appendChild(createSectionLabel(I18n.t('oldTestament')));
      g.appendChild(createBookGrid(ot));
    }
    if (nt.length > 0) {
      g.appendChild(createSectionLabel(I18n.t('newTestament')));
      g.appendChild(createBookGrid(nt));
    }
  }

  function createSectionLabel(text: string): HTMLElement {
    const label = document.createElement('div');
    label.className =
      'text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-night-300 mb-2 mt-2';
    label.textContent = text;
    return label;
  }

  function createBookGrid(books: BookRecord[]): HTMLElement {
    const container = document.createElement('div');
    container.className = 'grid grid-cols-5 gap-1.5 mb-3';

    for (const book of books) {
      const btn = document.createElement('button');
      btn.className =
        'nav-book-btn rounded-sm bg-brand-100 dark:bg-night-700 hover:bg-brand-200 dark:hover:bg-night-600 ' +
        'text-brand-800 dark:text-night-100 font-medium cursor-pointer transition-colors truncate px-2';
      btn.textContent = I18n.bookName(book.bookNumber).short;
      btn.title = I18n.bookName(book.bookNumber).long;
      btn.addEventListener('click', () => selectBook(book));
      container.appendChild(btn);
    }
    return container;
  }

  async function selectBook(book: BookRecord): Promise<void> {
    selectedBook = book;
    selectedChapter = null;
    backBtn().classList.remove('hidden');

    const pane = paneManagerApi?.getPane(activePaneId);
    if (!pane) return;

    const count = await window.api.getChapterCount(pane.moduleId, book.bookNumber);
    if (selectedBook?.bookNumber !== book.bookNumber || selectedChapter !== null) return;

    const g = grid();
    g.innerHTML = '';

    const label = document.createElement('div');
    label.className = 'text-sm font-semibold text-brand-700 dark:text-night-200 mb-3';
    label.textContent = I18n.bookName(book.bookNumber).long;
    g.appendChild(label);

    const container = document.createElement('div');
    container.className = 'grid grid-cols-8 gap-1.5';

    for (let ch = 1; ch <= count; ch++) {
      const btn = document.createElement('button');
      btn.className =
        'nav-chapter-btn rounded-sm bg-brand-100 dark:bg-night-700 hover:bg-brand-200 dark:hover:bg-night-600 ' +
        'text-brand-800 dark:text-night-100 font-medium cursor-pointer transition-colors';
      btn.textContent = String(ch);
      btn.addEventListener('click', () => selectChapter(book, ch));
      container.appendChild(btn);
    }
    g.appendChild(container);
  }

  async function selectChapter(book: BookRecord, chapter: number): Promise<void> {
    selectedBook = book;
    selectedChapter = chapter;
    backBtn().classList.remove('hidden');

    const pane = paneManagerApi?.getPane(activePaneId);
    if (!pane) return;

    const verses = await window.api.getChapter(pane.moduleId, book.bookNumber, chapter);
    if (selectedBook?.bookNumber !== book.bookNumber || selectedChapter !== chapter) return;

    const verseNumbers = [
      ...new Set(
        (verses || [])
          .map((v) => Number(v.verse))
          .filter((verse) => Number.isFinite(verse))
      ),
    ];

    if (verseNumbers.length === 0) {
      paneManagerApi?.navigatePane(activePaneId, book.bookNumber, chapter);
      close();
      return;
    }

    const g = grid();
    g.innerHTML = '';

    const label = document.createElement('div');
    label.className = 'text-sm font-semibold text-brand-700 dark:text-night-200 mb-3';
    label.textContent = `${I18n.bookName(book.bookNumber).long} ${chapter}`;
    g.appendChild(label);

    const container = document.createElement('div');
    container.className = 'grid grid-cols-8 gap-1.5';

    for (const verse of verseNumbers) {
      const btn = document.createElement('button');
      btn.className =
        'nav-verse-btn rounded-sm bg-brand-100 dark:bg-night-700 hover:bg-brand-200 dark:hover:bg-night-600 ' +
        'text-brand-800 dark:text-night-100 font-medium cursor-pointer transition-colors';
      btn.textContent = String(verse);
      btn.addEventListener('click', () => {
        paneManagerApi?.navigatePane(activePaneId, book.bookNumber, chapter, verse);
        close();
      });
      container.appendChild(btn);
    }
    g.appendChild(container);
  }

  function handleBack(): void {
    if (selectedBook && selectedChapter !== null) {
      selectBook(selectedBook);
      return;
    }
    showBooks();
  }

  async function handleQuickInput(): Promise<void> {
    const raw = input().value.trim();
    if (!raw) return;

    const pane = paneManagerApi?.getPane(activePaneId);
    if (!pane) return;

    // Parse: "BookName Chapter:Verse" or "BookName Chapter"
    // Examples: "Gn 1:3", "2Co 2:2", "Mt 5", "Jo 3:16"
    const match = raw.match(/^(\d?\s*[A-Za-zÀ-ÿ]+)\s*(\d+)(?::(\d+))?$/);
    if (!match) return;

    const abbrev = match[1].trim().toLowerCase();
    const chapter = parseInt(match[2], 10);
    const verse = match[3] ? parseInt(match[3], 10) : null;

    // Find book by localized abbreviation
    const bookNumber = I18n.findBookByAbbrev(abbrev);
    const book = bookNumber != null ? currentBooks.find((b) => b.bookNumber === bookNumber) : null;

    if (!book) return;

    paneManagerApi?.navigatePane(activePaneId, book.bookNumber, chapter, verse);
    close();
  }

  return { init, open, close };
})();

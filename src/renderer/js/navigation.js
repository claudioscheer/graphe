/**
 * navigation.js — Navigation dialog with book/chapter grids + quick input
 */
const Navigation = (() => {
  let activePaneId = null;
  let currentBooks = [];
  let selectedBook = null;

  const overlay = () => document.getElementById('nav-overlay');
  const grid = () => document.getElementById('nav-grid');
  const input = () => document.getElementById('nav-input');
  const backBtn = () => document.getElementById('nav-back');
  const closeBtn = () => document.getElementById('nav-close');

  function init() {
    closeBtn().addEventListener('click', close);
    backBtn().addEventListener('click', showBooks);
    overlay().addEventListener('click', (e) => {
      if (e.target === overlay()) close();
    });
    input().addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleQuickInput();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !overlay().classList.contains('hidden')) {
        close();
      }
    });
  }

  function open(paneId, books) {
    activePaneId = paneId;
    currentBooks = books;
    selectedBook = null;
    overlay().classList.remove('hidden');
    input().value = '';
    input().focus();
    showBooks();
  }

  function close() {
    overlay().classList.add('hidden');
    activePaneId = null;
  }

  function showBooks() {
    selectedBook = null;
    backBtn().classList.add('hidden');
    const g = grid();
    g.innerHTML = '';

    // Group books into OT and NT
    const ot = currentBooks.filter(b => b.bookNumber < 470);
    const nt = currentBooks.filter(b => b.bookNumber >= 470);

    if (ot.length > 0) {
      g.appendChild(createSectionLabel(I18n.t('oldTestament')));
      g.appendChild(createBookGrid(ot));
    }
    if (nt.length > 0) {
      g.appendChild(createSectionLabel(I18n.t('newTestament')));
      g.appendChild(createBookGrid(nt));
    }
  }

  function createSectionLabel(text) {
    const label = document.createElement('div');
    label.className = 'text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-night-300 mb-2 mt-2';
    label.textContent = text;
    return label;
  }

  function createBookGrid(books) {
    const container = document.createElement('div');
    container.className = 'grid grid-cols-5 gap-1.5 mb-3';

    for (const book of books) {
      const btn = document.createElement('button');
      btn.className = 'nav-book-btn rounded-lg bg-brand-100 dark:bg-night-700 hover:bg-brand-200 dark:hover:bg-night-600 ' +
        'text-brand-800 dark:text-night-100 font-medium cursor-pointer transition-colors truncate px-2';
      btn.textContent = book.shortName;
      btn.title = book.longName;
      btn.addEventListener('click', () => selectBook(book));
      container.appendChild(btn);
    }
    return container;
  }

  async function selectBook(book) {
    selectedBook = book;
    backBtn().classList.remove('hidden');

    const pane = PaneManager.getPane(activePaneId);
    if (!pane) return;

    const count = await window.api.getChapterCount(pane.moduleId, book.bookNumber);
    const g = grid();
    g.innerHTML = '';

    const label = document.createElement('div');
    label.className = 'text-sm font-semibold text-brand-700 dark:text-night-200 mb-3';
    label.textContent = book.longName;
    g.appendChild(label);

    const container = document.createElement('div');
    container.className = 'grid grid-cols-8 gap-1.5';

    for (let ch = 1; ch <= count; ch++) {
      const btn = document.createElement('button');
      btn.className = 'nav-chapter-btn rounded-lg bg-brand-100 dark:bg-night-700 hover:bg-brand-200 dark:hover:bg-night-600 ' +
        'text-brand-800 dark:text-night-100 font-medium cursor-pointer transition-colors';
      btn.textContent = ch;
      btn.addEventListener('click', () => {
        PaneManager.navigatePane(activePaneId, book.bookNumber, ch);
        close();
      });
      container.appendChild(btn);
    }
    g.appendChild(container);
  }

  async function handleQuickInput() {
    const raw = input().value.trim();
    if (!raw) return;

    const pane = PaneManager.getPane(activePaneId);
    if (!pane) return;

    // Parse: "BookName Chapter:Verse" or "BookName Chapter"
    // Examples: "Gn 1:3", "2Co 2:2", "Mt 5", "Jo 3:16"
    const match = raw.match(/^(\d?\s*[A-Za-zÀ-ÿ]+)\s*(\d+)(?::(\d+))?$/);
    if (!match) return;

    const abbrev = match[1].trim().toLowerCase();
    const chapter = parseInt(match[2], 10);
    const verse = match[3] ? parseInt(match[3], 10) : null;

    // Find book by abbreviation (case-insensitive prefix match on shortName)
    const book = currentBooks.find(b =>
      b.shortName.toLowerCase() === abbrev ||
      b.shortName.toLowerCase().startsWith(abbrev)
    );

    if (!book) return;

    PaneManager.navigatePane(activePaneId, book.bookNumber, chapter, verse);
    close();
  }

  return { init, open, close };
})();

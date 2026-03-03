/**
 * search-panel.js — Fixed left sidebar for searching Bible verses by word
 */
const SearchPanel = (() => {
  let modules = [];
  let selectedModuleId = null;
  let booksCache = {};
  let onStateChange = null;
  let widthRatio = null;
  let resizeBound = false;

  // DOM refs
  let sidebar, panel, divider, input, select, resultsList, statusEl, searchClearBtn;

  const MIN_WIDTH = 200;
  const MAX_WIDTH_RATIO = 0.6;
  const DEFAULT_WIDTH = 280;

  function init(moduleList, savedState) {
    modules = moduleList;
    selectedModuleId = savedState?.moduleId || (modules[0] && modules[0].id) || null;
    widthRatio = resolveInitialWidthRatio(savedState);
    const width = Math.round(getViewportWidth() * widthRatio);
    buildDOM(width);
    prefetchBooks();
    emitStateChange();
  }

  function getViewportWidth() {
    return Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
  }

  function resolveInitialWidthRatio(savedState) {
    if (savedState && Number.isFinite(savedState.widthRatio)) {
      return Math.min(0.9, Math.max(0.1, Number(savedState.widthRatio)));
    }
    return Math.min(0.9, Math.max(0.1, DEFAULT_WIDTH / getViewportWidth()));
  }

  function setupResizeSync() {
    if (resizeBound) return;
    resizeBound = true;
    window.addEventListener('resize', () => {
      if (!sidebar) return;
      const next = clampWidth(Math.round(getViewportWidth() * (widthRatio || 0.25)));
      sidebar.style.width = next + 'px';
    });
  }

  function getSidebar() {
    return sidebar;
  }

  function buildDOM(width) {
    const paneRoot = document.getElementById('pane-root');
    const body = paneRoot.parentElement;

    // Create layout wrapper
    const layout = document.createElement('div');
    layout.id = 'app-layout';
    layout.className = 'flex flex-row flex-1 overflow-hidden';

    // Create left sidebar wrapper
    sidebar = document.createElement('div');
    sidebar.id = 'left-sidebar';
    sidebar.style.width = clampWidth(width) + 'px';
    setupResizeSync();

    // Build search panel
    panel = document.createElement('div');
    panel.id = 'search-panel';

    // Header
    const header = document.createElement('div');
    header.className = 'search-panel-header';
    const titleRow = document.createElement('div');
    titleRow.className = 'flex items-center gap-2';
    const icon = Icons.create('search', 'w-4 h-4');
    icon.setAttribute('width', '16');
    icon.setAttribute('height', '16');
    icon.style.flexShrink = '0';
    titleRow.appendChild(icon);
    const title = document.createElement('span');
    title.className = 'font-semibold text-sm';
    title.setAttribute('data-i18n', 'search');
    title.textContent = I18n.t('search');
    titleRow.appendChild(title);
    header.appendChild(titleRow);

    // Translation select
    select = document.createElement('select');
    select.className =
      'app-select w-full pl-2 pr-8 py-1 mt-2 rounded-md border border-brand-400 dark:border-night-500 bg-brand-50 dark:bg-night-700 text-sm text-brand-900 dark:text-night-50 cursor-pointer';
    const sortedModules = Utils.sortBibleModules(modules);
    for (const m of sortedModules) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.id;
      opt.title = m.description;
      if (m.id === selectedModuleId) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      selectedModuleId = select.value;
      emitStateChange();
      prefetchBooks();
      runSearch();
    });
    header.appendChild(select);

    // Search input with clear button
    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'input-clear-wrapper mt-2';

    input = document.createElement('input');
    input.type = 'text';
    input.className =
      'w-full px-3 py-1.5 pr-7 rounded-md border border-brand-400 dark:border-night-500 bg-brand-50 dark:bg-night-700 text-sm text-brand-900 dark:text-night-50 focus:outline-none focus:ring-2 focus:ring-brand-500';
    input.setAttribute('data-i18n-placeholder', 'searchPlaceholder');
    input.placeholder = I18n.t('searchPlaceholder');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        runSearch();
      }
      if (e.key === 'Escape') {
        input.blur();
      }
    });

    searchClearBtn = document.createElement('button');
    searchClearBtn.className = 'input-clear-btn';
    searchClearBtn.type = 'button';
    searchClearBtn.innerHTML = '&times;';
    searchClearBtn.addEventListener('click', () => {
      input.value = '';
      searchClearBtn.style.display = 'none';
      statusEl.textContent = '';
      showHint();
      input.focus();
    });
    searchClearBtn.style.display = 'none';

    input.addEventListener('input', () => {
      searchClearBtn.style.display = input.value ? '' : 'none';
    });

    searchWrapper.appendChild(input);
    searchWrapper.appendChild(searchClearBtn);
    header.appendChild(searchWrapper);

    panel.appendChild(header);

    // Status line
    statusEl = document.createElement('div');
    statusEl.className = 'search-panel-status';
    statusEl.textContent = '';
    panel.appendChild(statusEl);

    // Results list
    resultsList = document.createElement('div');
    resultsList.className = 'search-panel-results';
    panel.appendChild(resultsList);

    // Divider (between left sidebar and pane-root)
    divider = document.createElement('div');
    divider.className = 'split-divider split-divider-h';
    setupDividerDrag();

    // Assemble: search panel into sidebar
    sidebar.appendChild(panel);

    // Reparent: remove pane-root from body, put it inside layout
    body.removeChild(paneRoot);
    layout.appendChild(sidebar);
    layout.appendChild(divider);
    layout.appendChild(paneRoot);
    body.appendChild(layout);

    showHint();
  }

  function showHint() {
    resultsList.innerHTML = '';
    const hint = document.createElement('div');
    hint.className = 'search-panel-hint';
    hint.setAttribute('data-i18n', 'searchHint');
    hint.textContent = I18n.t('searchHint');
    resultsList.appendChild(hint);
  }

  function setupDividerDrag() {
    divider.addEventListener('mousedown', (e) => {
      e.preventDefault();
      divider.classList.add('dragging');
      const startX = e.clientX;
      const startWidth = sidebar.offsetWidth;

      const onMove = (e2) => {
        const newWidth = clampWidth(startWidth + (e2.clientX - startX));
        sidebar.style.width = newWidth + 'px';
        widthRatio = Math.min(0.9, Math.max(0.1, newWidth / getViewportWidth()));
      };

      const onUp = () => {
        divider.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        emitStateChange();
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function clampWidth(w) {
    const maxWidth = Math.max(MIN_WIDTH + 40, Math.floor(getViewportWidth() * MAX_WIDTH_RATIO));
    return Math.max(MIN_WIDTH, Math.min(maxWidth, Math.round(w)));
  }

  async function prefetchBooks() {
    if (!selectedModuleId) return;
    if (booksCache[selectedModuleId]) return;
    try {
      booksCache[selectedModuleId] = await window.api.getBooks(selectedModuleId);
    } catch (err) {
      console.warn('Failed to prefetch books:', err);
    }
  }

  function getBookShortName(bookNumber) {
    return I18n.bookName(bookNumber).short;
  }

  async function runSearch() {
    const query = input.value.trim();
    resultsList.innerHTML = '';

    if (!query) {
      statusEl.textContent = '';
      return;
    }

    const hasStrong = /strong:[HhGg]?\d+\w*/i.test(query);
    const textTerms = query
      .replace(/strong:[HhGg]?\d+\w*/gi, '')
      .trim()
      .split(/\s+/)
      .filter((t) => t.length >= 2);
    if (!hasStrong && textTerms.length === 0) {
      statusEl.textContent = I18n.t('searchMinChars');
      return;
    }

    if (!selectedModuleId) return;

    // Ensure books are cached before showing results
    await prefetchBooks();

    statusEl.textContent = I18n.t('searching');

    try {
      const results = await window.api.searchVerses(selectedModuleId, query);

      if (results.length === 0) {
        statusEl.textContent = I18n.t('searchNoResults');
        return;
      }

      statusEl.textContent = I18n.t('searchResultCount').replace('{count}', results.length);

      renderResults(results, query);
    } catch (err) {
      statusEl.textContent = err.message;
    }
  }

  function renderResults(results, query) {
    const frag = document.createDocumentFragment();
    const terms = query
      .replace(/strong:[HhGg]?\d+\w*/gi, '')
      .trim()
      .split(/\s+/)
      .filter((t) => t.length >= 2);

    for (const row of sortResultsCanonical(results)) {
      const item = createResultItem(row, terms);
      frag.appendChild(item);
    }

    resultsList.appendChild(frag);
  }

  function sortResultsCanonical(results) {
    return [...results].sort((a, b) => {
      if (a.bookNumber !== b.bookNumber) return a.bookNumber - b.bookNumber;
      if (a.chapter !== b.chapter) return a.chapter - b.chapter;
      return a.verse - b.verse;
    });
  }

  function createResultItem(row, terms) {
    const item = document.createElement('div');
    item.className = 'search-result-item';
    item.addEventListener('click', () => {
      const paneId = PaneManager.getActivePaneId();
      PaneManager.navigatePane(
        PaneManager.getNavigationTarget(paneId),
        row.bookNumber,
        row.chapter,
        row.verse
      );
    });

    const top = document.createElement('div');
    top.className = 'search-result-top';

    const ref = document.createElement('div');
    ref.className = 'search-result-ref';
    ref.textContent = `${getBookShortName(row.bookNumber)} ${row.chapter}:${row.verse}`;

    top.appendChild(ref);

    const preview = document.createElement('div');
    preview.className = 'search-result-text';
    preview.innerHTML = highlightText(VerseUtils.cleanText(row.text), terms);

    item.appendChild(top);
    item.appendChild(preview);
    return item;
  }

  function highlightText(text, terms) {
    let result = Utils.escapeHtml(text);
    for (const term of terms) {
      const escapedTerm = Utils.escapeHtml(term.toLowerCase());
      const regex = new RegExp(`(${escapeRegex(escapedTerm)})`, 'gi');
      result = result.replace(regex, '<mark>$1</mark>');
    }
    return result;
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function search(query) {
    if (input) {
      input.value = query;
      if (searchClearBtn) searchClearBtn.style.display = query ? '' : 'none';
      runSearch();
    }
  }

  function focusInput() {
    if (input) input.focus();
  }

  function setStateChangeListener(listener) {
    onStateChange = typeof listener === 'function' ? listener : null;
  }

  function emitStateChange() {
    if (!onStateChange) return;
    const width = sidebar ? sidebar.offsetWidth : DEFAULT_WIDTH;
    widthRatio = Math.min(0.9, Math.max(0.1, width / getViewportWidth()));
    onStateChange({
      widthRatio,
      moduleId: selectedModuleId,
    });
  }

  function getState() {
    const width = sidebar ? sidebar.offsetWidth : DEFAULT_WIDTH;
    widthRatio = Math.min(0.9, Math.max(0.1, width / getViewportWidth()));
    return {
      widthRatio,
      moduleId: selectedModuleId,
    };
  }

  return {
    init,
    focusInput,
    search,
    setStateChangeListener,
    getState,
    getSidebar,
  };
})();

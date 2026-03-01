/**
 * search-panel.js — Fixed left sidebar for searching Bible verses by word
 */
const SearchPanel = (() => {
  let modules = [];
  let selectedModuleId = null;
  let booksCache = {};
  let onStateChange = null;
  let semanticEnabled = false;
  let semanticResultCount = 5;

  // DOM refs
  let sidebar, panel, divider, input, select, resultsList, statusEl, searchClearBtn;

  const MIN_WIDTH = 200;
  const MAX_WIDTH = 600;
  const DEFAULT_WIDTH = 280;

  function init(moduleList, savedState) {
    modules = moduleList;
    selectedModuleId = savedState?.moduleId || (modules[0] && modules[0].id) || null;
    const width = savedState?.width || DEFAULT_WIDTH;
    buildDOM(width);
    prefetchBooks();
    emitStateChange();
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
    select.className = 'app-select w-full pl-2 pr-8 py-1 mt-2 rounded-md border border-brand-400 dark:border-night-500 bg-brand-50 dark:bg-night-700 text-sm text-brand-900 dark:text-night-50 cursor-pointer';
    const sortedModules = [...modules].filter(m => m.type === 'bible').sort((a, b) =>
      a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' })
    );
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
    input.className = 'w-full px-3 py-2 pr-7 rounded-md border border-brand-400 dark:border-night-500 bg-brand-50 dark:bg-night-700 text-sm text-brand-900 dark:text-night-50 focus:outline-none focus:ring-2 focus:ring-brand-500';
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
      resultsList.innerHTML = '';
      statusEl.textContent = '';
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
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(w)));
  }

  async function prefetchBooks() {
    if (!selectedModuleId) return;
    if (booksCache[selectedModuleId]) return;
    try {
      booksCache[selectedModuleId] = await window.api.getBooks(selectedModuleId);
    } catch (_) {}
  }

  function getBookShortName(bookNumber) {
    const books = booksCache[selectedModuleId];
    if (!books) return `#${bookNumber}`;
    const book = books.find(b => b.bookNumber === bookNumber);
    return book ? book.shortName : `#${bookNumber}`;
  }

  async function runSearch() {
    const query = input.value.trim();
    resultsList.innerHTML = '';

    if (!query) {
      statusEl.textContent = '';
      return;
    }

    const hasStrong = /strong:[HhGg]?\d+\w*/i.test(query);
    const textTerms = query.replace(/strong:[HhGg]?\d+\w*/gi, '').trim().split(/\s+/).filter(t => t.length >= 2);
    if (!hasStrong && textTerms.length === 0) {
      statusEl.textContent = I18n.t('searchMinChars');
      return;
    }

    if (!selectedModuleId) return;

    // Ensure books are cached before showing results
    await prefetchBooks();

    statusEl.textContent = I18n.t('searching');

    try {
      const textPart = query.replace(/strong:[HhGg]?\d+\w*/gi, '').trim();
      const semanticResponse = semanticEnabled && textTerms.length > 0
        ? await window.api.searchVersesSemantic(selectedModuleId, textPart, { limit: semanticResultCount })
        : { ready: false, mode: 'disabled', results: [] };

      const lexicalResults = await window.api.searchVerses(selectedModuleId, query);
      const semanticResults = semanticResponse && semanticResponse.ready ? (semanticResponse.results || []) : [];

      const semanticKeys = new Set(semanticResults.map(r => `${r.bookNumber}:${r.chapter}:${r.verse}`));
      const normalResults = lexicalResults.filter(r => !semanticKeys.has(`${r.bookNumber}:${r.chapter}:${r.verse}`));
      const useSemanticLabels = semanticEnabled && textTerms.length > 0;

      if (semanticResults.length === 0 && normalResults.length === 0) {
        statusEl.textContent = I18n.t('searchNoResults');
        return;
      }

      const parts = [];
      if (useSemanticLabels) {
        parts.push(I18n.t('searchSemanticCount').replace('{count}', semanticResults.length));
        parts.push(I18n.t('searchKeywordCount').replace('{count}', normalResults.length));
      } else {
        parts.push(I18n.t('searchResultCount').replace('{count}', lexicalResults.length));
      }
      statusEl.textContent = parts.join(' | ');

      if (useSemanticLabels && semanticResponse && !semanticResponse.ready) {
        statusEl.textContent += ` - ${I18n.t('semanticFallbackKeyword')}`;
      }

      renderResults(semanticResults, normalResults, query, useSemanticLabels);
    } catch (err) {
      statusEl.textContent = err.message;
    }
  }

  function createSectionTitle(title) {
    const h = document.createElement('div');
    h.className = 'search-results-section-title';
    h.textContent = title;
    return h;
  }

  function renderResults(semanticResults, normalResults, query, useSemanticLabels = false) {
    const frag = document.createDocumentFragment();
    const terms = query.replace(/strong:[HhGg]?\d+\w*/gi, '').trim().split(/\s+/).filter(t => t.length >= 2);

    if (semanticResults.length > 0) {
      if (useSemanticLabels) {
        frag.appendChild(createSectionTitle(I18n.t('searchSemanticResults')));
      }
      for (const row of sortResultsCanonical(semanticResults)) {
        const item = createResultItem(row, terms, true);
        frag.appendChild(item);
      }
    }

    if (normalResults.length > 0) {
      if (useSemanticLabels) {
        frag.appendChild(createSectionTitle(I18n.t('searchKeywordResults')));
      }
      for (const row of sortResultsCanonical(normalResults)) {
        const item = createResultItem(row, terms, false);
        frag.appendChild(item);
      }
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

  function createResultItem(row, terms, semantic) {
    const item = document.createElement('div');
    item.className = 'search-result-item';
    item.addEventListener('click', () => {
      const paneId = PaneManager.getActivePaneId();
      PaneManager.navigatePane(PaneManager.getNavigationTarget(paneId), row.bookNumber, row.chapter, row.verse);
    });

    const top = document.createElement('div');
    top.className = 'search-result-top';

    const ref = document.createElement('div');
    ref.className = 'search-result-ref';
    ref.textContent = `${getBookShortName(row.bookNumber)} ${row.chapter}:${row.verse}`;

    if (semantic) {
      const badge = document.createElement('span');
      badge.className = 'semantic-result-badge';
      badge.textContent = I18n.t('searchSemanticBadge');
      top.appendChild(badge);
    }
    top.appendChild(ref);

    const preview = document.createElement('div');
    preview.className = 'search-result-text';
    preview.innerHTML = highlightText(VerseUtils.cleanText(row.text), terms);

    item.appendChild(top);
    item.appendChild(preview);
    return item;
  }

  function highlightText(text, terms) {
    let result = escapeHtml(text);
    for (const term of terms) {
      const escapedTerm = escapeHtml(term.toLowerCase());
      const regex = new RegExp(`(${escapeRegex(escapedTerm)})`, 'gi');
      result = result.replace(regex, '<mark>$1</mark>');
    }
    return result;
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

  function setSemanticOptions(opts) {
    semanticEnabled = !!(opts && opts.enabled === true);
    const count = parseInt(opts && opts.resultCount, 10);
    semanticResultCount = Number.isFinite(count) && count > 0 ? count : 5;
  }

  function emitStateChange() {
    if (!onStateChange) return;
    onStateChange({
      width: sidebar ? sidebar.offsetWidth : DEFAULT_WIDTH,
      moduleId: selectedModuleId,
    });
  }

  function getState() {
    return {
      width: sidebar ? sidebar.offsetWidth : DEFAULT_WIDTH,
      moduleId: selectedModuleId,
    };
  }

  return { init, focusInput, search, setStateChangeListener, getState, getSidebar, setSemanticOptions };
})();

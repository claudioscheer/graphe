/**
 * search-panel.js — Fixed left sidebar for searching Bible verses by word
 */
const SearchPanel = (() => {
  let modules = [];
  let selectedModuleId = null;
  let booksCache = {};
  let onStateChange = null;

  // DOM refs
  let panel, divider, input, select, resultsList, statusEl;

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

  function buildDOM(width) {
    const paneRoot = document.getElementById('pane-root');
    const body = paneRoot.parentElement;

    // Create layout wrapper
    const layout = document.createElement('div');
    layout.id = 'app-layout';
    layout.className = 'flex flex-row flex-1 overflow-hidden';

    // Build search panel
    panel = document.createElement('div');
    panel.id = 'search-panel';
    panel.style.width = clampWidth(width) + 'px';

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
    select.className = 'app-select w-full pl-2 pr-8 py-1 mt-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 cursor-pointer';
    const sortedModules = [...modules].sort((a, b) =>
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

    // Search input
    input = document.createElement('input');
    input.type = 'text';
    input.className = 'w-full px-3 py-2 mt-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500';
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
    header.appendChild(input);

    panel.appendChild(header);

    // Status line
    statusEl = document.createElement('div');
    statusEl.className = 'search-panel-status';
    statusEl.textContent = I18n.t('searchMinChars');
    panel.appendChild(statusEl);

    // Results list
    resultsList = document.createElement('div');
    resultsList.className = 'search-panel-results';
    panel.appendChild(resultsList);

    // Divider
    divider = document.createElement('div');
    divider.className = 'split-divider split-divider-h';
    setupDividerDrag();

    // Reparent: remove pane-root from body, put it inside layout
    body.removeChild(paneRoot);
    layout.appendChild(panel);
    layout.appendChild(divider);
    layout.appendChild(paneRoot);
    body.appendChild(layout);
  }

  function setupDividerDrag() {
    divider.addEventListener('mousedown', (e) => {
      e.preventDefault();
      divider.classList.add('dragging');
      const startX = e.clientX;
      const startWidth = panel.offsetWidth;

      const onMove = (e2) => {
        const newWidth = clampWidth(startWidth + (e2.clientX - startX));
        panel.style.width = newWidth + 'px';
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

    if (query.length < 2) {
      statusEl.textContent = I18n.t('searchMinChars');
      return;
    }

    if (!selectedModuleId) return;

    // Ensure books are cached before showing results
    await prefetchBooks();

    statusEl.textContent = '...';

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
    const lowerQuery = query.toLowerCase();

    for (const row of results) {
      const item = document.createElement('div');
      item.className = 'search-result-item';
      item.addEventListener('click', () => {
        const paneId = PaneManager.getActivePaneId();
        PaneManager.navigatePane(paneId, row.bookNumber, row.chapter, row.verse);
      });

      const ref = document.createElement('div');
      ref.className = 'search-result-ref';
      ref.textContent = `${getBookShortName(row.bookNumber)} ${row.chapter}:${row.verse}`;

      const preview = document.createElement('div');
      preview.className = 'search-result-text';
      preview.innerHTML = highlightText(stripTags(row.text), lowerQuery);

      item.appendChild(ref);
      item.appendChild(preview);
      frag.appendChild(item);
    }

    resultsList.appendChild(frag);
  }

  function stripTags(html) {
    return html.replace(/<[^>]+>/g, '');
  }

  function highlightText(text, lowerQuery) {
    const escaped = escapeHtml(text);
    const escapedQuery = escapeHtml(lowerQuery);
    const regex = new RegExp(`(${escapeRegex(escapedQuery)})`, 'gi');
    return escaped.replace(regex, '<mark>$1</mark>');
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function focusInput() {
    if (input) input.focus();
  }

  function setStateChangeListener(listener) {
    onStateChange = typeof listener === 'function' ? listener : null;
  }

  function emitStateChange() {
    if (!onStateChange) return;
    onStateChange({
      width: panel.offsetWidth,
      moduleId: selectedModuleId,
    });
  }

  function getState() {
    return {
      width: panel ? panel.offsetWidth : DEFAULT_WIDTH,
      moduleId: selectedModuleId,
    };
  }

  return { init, focusInput, setStateChangeListener, getState };
})();

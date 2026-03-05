/**
 * search-panel.js — Fixed left sidebar for searching Bible verses by word
 */
import { Icons } from './icons.js';
import { I18n } from './i18n.js';
import { ModulePicker } from './module-picker.js';
import { PaneManager } from './pane-manager.js';
import { Utils } from './utils.js';
import { VerseUtils } from './verse-utils.js';

export const SearchPanel = (() => {
  let modules = [];
  let selectedModuleId = null;
  let booksCache = {};
  let onStateChange = null;
  let widthRatio = null;
  let resizeBound = false;

  // DOM refs
  let sidebar, panel, divider, input, select, resultsList, statusEl, searchClearBtn, pickerInstance;

  const MIN_WIDTH = 200;
  const MAX_WIDTH_RATIO = 0.6;
  const DEFAULT_WIDTH = 280;
  const PREVIEW_MAX_CHARS = 160;

  function init(moduleList, savedState) {
    modules = moduleList;
    selectedModuleId = savedState?.moduleId || (modules[0] && modules[0].id) || null;
    widthRatio = resolveInitialWidthRatio(savedState);
    const width = Math.round(getViewportWidth() * widthRatio);
    buildDOM(width);
    prefetchBooks();
    // Restore last search query
    const savedQuery = savedState?.query || '';
    if (savedQuery && input) {
      input.value = savedQuery;
      if (searchClearBtn) searchClearBtn.style.display = '';
      runSearch();
    }
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
    const searchPicker = ModulePicker.create({
      modules: Utils.sortBibleModules(modules),
      selectedId: selectedModuleId,
      moduleType: 'bible',
      className: 'panel-select mt-2',
      onChange: (moduleId) => {
        selectedModuleId = moduleId;
        emitStateChange();
        prefetchBooks();
        runSearch();
      },
    });
    pickerInstance = searchPicker;
    select = searchPicker.el;
    header.appendChild(select);

    // Search input with clear button
    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'input-clear-wrapper mt-2';

    input = document.createElement('input');
    input.type = 'text';
    input.className = 'panel-search-input';
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
    const textTerms = extractSearchTerms(query);
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

      const strongTerms = extractStrongTerms(query);
      renderResults(results, textTerms, strongTerms);
    } catch (err) {
      statusEl.textContent = err.message;
    }
    emitStateChange();
  }

  function renderResults(results, terms, strongTerms) {
    const frag = document.createDocumentFragment();

    for (const row of sortResultsCanonical(results)) {
      const item = createResultItem(row, terms, strongTerms);
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

  function createResultItem(row, terms, strongTerms) {
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
    item.appendChild(top);

    const preview = document.createElement('div');
    preview.className = 'search-result-text';

    if (strongTerms.length > 0) {
      // For Strong's searches: render with inline Strong's numbers
      const richHtml = VerseUtils.cleanTextWithStrongs(row.text, strongTerms);
      // Extract matched words for snippet centering
      const matchedWords = extractMatchedWords(row.text, strongTerms);
      const allTerms = terms.concat(matchedWords);
      const plainText = VerseUtils.cleanText(row.text);
      const snippet = buildPreviewSnippet(plainText, allTerms, PREVIEW_MAX_CHARS);
      // Build the rich snippet: take the snippet range from clean text and apply Strong's rendering
      const richSnippet = buildRichSnippet(richHtml, snippet, PREVIEW_MAX_CHARS);
      // richSnippet already contains trusted HTML (<mark>, <sup>), so highlight text terms in-place
      preview.innerHTML = highlightRichText(richSnippet, terms);
    } else {
      preview.innerHTML = highlightText(
        buildPreviewSnippet(VerseUtils.cleanText(row.text), terms, PREVIEW_MAX_CHARS),
        terms
      );
    }

    item.appendChild(preview);
    return item;
  }

  function extractStrongTerms(query) {
    const terms = [];
    const regex = /strong:([HhGg]?)(\d+\w*)/gi;
    let match;
    while ((match = regex.exec(query)) !== null) {
      const prefix = (match[1] || '').toUpperCase();
      const number = match[2];
      terms.push({ prefix, number });
    }
    return terms;
  }

  function extractMatchedWords(rawText, strongTerms) {
    if (!rawText || strongTerms.length === 0) return [];
    const matchSet = new Set();
    for (const sn of strongTerms) {
      const full = (sn.prefix + sn.number).toUpperCase();
      matchSet.add(full);
      matchSet.add(sn.number.toUpperCase());
    }
    const words = [];
    const regex = /(\S+)\s*<S>([\s\S]*?)<\/S>/gi;
    let match;
    while ((match = regex.exec(rawText)) !== null) {
      const code = match[2].trim().toUpperCase();
      if (matchSet.has(code)) {
        // Clean any remaining tags from the word
        const word = match[1].replace(/<[^>]+>/g, '').trim();
        if (word) words.push(word);
      }
    }
    return words;
  }

  function buildRichSnippet(richHtml, snippet, maxChars) {
    // The richHtml contains <mark> and <sup> tags from cleanTextWithStrongs.
    // We need to produce a clipped version that preserves those tags.
    // Strategy: strip tags from richHtml to get plain text, find snippet range, then slice with tags.

    const plainFromRich = richHtml.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const cleanSnippet = snippet.replace(/^\.\.\./, '').replace(/\.\.\.$/, '').trim();

    if (!cleanSnippet) return snippet;

    // Find where the snippet starts in the plain text
    const idx = plainFromRich.toLowerCase().indexOf(cleanSnippet.toLowerCase().slice(0, 30));
    if (idx < 0) {
      // Fallback: just clip the rich HTML by text length
      return clipRichHtml(richHtml, maxChars);
    }

    // Map plain-text positions to richHtml positions
    const result = sliceRichHtml(richHtml, idx, idx + cleanSnippet.length);
    let out = result;
    if (snippet.startsWith('...')) out = '...' + out;
    if (snippet.endsWith('...')) out = out + '...';
    return out;
  }

  function sliceRichHtml(html, startPlain, endPlain) {
    // Walk through html, tracking plain-text position, and extract the range [startPlain, endPlain)
    let plainPos = 0;
    let i = 0;
    let collecting = false;
    let result = '';
    let openTags = [];

    while (i < html.length) {
      if (html[i] === '<') {
        const tagEnd = html.indexOf('>', i);
        if (tagEnd === -1) break;
        const tag = html.slice(i, tagEnd + 1);
        if (collecting || (plainPos >= startPlain && plainPos < endPlain)) {
          result += tag;
        }
        // Track open/close tags
        const closeMatch = tag.match(/^<\/(\w+)/);
        const openMatch = tag.match(/^<(\w+)/);
        if (closeMatch) {
          if (collecting) openTags.pop();
        } else if (openMatch && !tag.endsWith('/>')) {
          if (collecting) openTags.push(openMatch[1]);
          else if (plainPos >= startPlain) {
            collecting = true;
            openTags.push(openMatch[1]);
          }
        }
        i = tagEnd + 1;
      } else if (html[i] === '&') {
        // Handle HTML entities
        const entEnd = html.indexOf(';', i);
        const entity = entEnd > i ? html.slice(i, entEnd + 1) : html[i];
        if (plainPos >= startPlain && plainPos < endPlain) {
          collecting = true;
          result += entity;
        }
        plainPos++;
        i = entEnd > i ? entEnd + 1 : i + 1;
      } else {
        // Regular character (including whitespace)
        if (plainPos >= startPlain && plainPos < endPlain) {
          collecting = true;
          result += html[i];
        }
        if (plainPos >= endPlain && collecting) {
          // Close any open tags
          while (openTags.length > 0) {
            result += '</' + openTags.pop() + '>';
          }
          break;
        }
        plainPos++;
        i++;
      }
    }
    // Close any remaining open tags
    while (openTags.length > 0) {
      result += '</' + openTags.pop() + '>';
    }
    return result;
  }

  function clipRichHtml(html, maxChars) {
    let plainCount = 0;
    let i = 0;
    let result = '';
    while (i < html.length && plainCount < maxChars) {
      if (html[i] === '<') {
        const tagEnd = html.indexOf('>', i);
        if (tagEnd === -1) break;
        result += html.slice(i, tagEnd + 1);
        i = tagEnd + 1;
      } else {
        result += html[i];
        plainCount++;
        i++;
      }
    }
    if (plainCount >= maxChars) result += '...';
    return result;
  }

  function extractSearchTerms(query) {
    const seen = new Set();
    const terms = [];
    const rawTerms = query
      .replace(/strong:[HhGg]?\d+\w*/gi, ' ')
      .trim()
      .split(/\s+/)
      .filter((t) => t.length >= 2);
    for (const term of rawTerms) {
      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      terms.push(term);
    }
    return terms;
  }

  function buildPreviewSnippet(text, terms, maxChars) {
    const compact = (text || '').replace(/\s+/g, ' ').trim();
    if (!compact) return '';
    if (compact.length <= maxChars) return compact;

    const firstMatch = findFirstMatchIndex(compact, terms);
    if (firstMatch < 0) return compact.slice(0, maxChars).trimEnd() + '...';

    let start = Math.max(0, firstMatch - Math.floor(maxChars / 2));
    let end = Math.min(compact.length, start + maxChars);
    if (end - start < maxChars && start > 0) {
      start = Math.max(0, end - maxChars);
    }

    start = moveToWordBoundary(compact, start, -1);
    end = moveToWordBoundary(compact, end, 1);

    let snippet = compact.slice(start, end).trim();
    if (start > 0) snippet = '...' + snippet;
    if (end < compact.length) snippet = snippet + '...';
    return snippet;
  }

  function findFirstMatchIndex(text, terms) {
    if (!terms || terms.length === 0) return -1;
    const lowerText = text.toLowerCase();
    let first = -1;
    for (const term of terms) {
      const idx = lowerText.indexOf(term.toLowerCase());
      if (idx === -1) continue;
      if (first === -1 || idx < first) first = idx;
    }
    return first;
  }

  function moveToWordBoundary(text, pos, direction) {
    if (direction < 0) {
      let i = Math.max(0, pos);
      while (i > 0 && !/\s/.test(text[i - 1])) i--;
      return i;
    }
    let i = Math.min(text.length, pos);
    while (i < text.length && !/\s/.test(text[i])) i++;
    return i;
  }

  function highlightText(text, terms) {
    let result = Utils.escapeHtml(text);
    for (const term of terms) {
      const escapedTerm = Utils.escapeHtml(term);
      const regex = new RegExp(`(${escapeRegex(escapedTerm)})`, 'gi');
      result = result.replace(regex, '<mark>$1</mark>');
    }
    return result;
  }

  function highlightRichText(html, terms) {
    if (!terms || terms.length === 0) return html;
    // Split on HTML tags, only highlight in text nodes
    const parts = html.split(/(<[^>]+>)/);
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith('<')) continue; // skip tags
      let text = Utils.escapeHtml(parts[i]);
      for (const term of terms) {
        const escapedTerm = Utils.escapeHtml(term);
        const regex = new RegExp(`(${escapeRegex(escapedTerm)})`, 'gi');
        text = text.replace(regex, '<mark>$1</mark>');
      }
      parts[i] = text;
    }
    return parts.join('');
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function setSelectedModule(moduleId) {
    if (!moduleId) return;
    const mod = modules.find((m) => m.id === moduleId);
    if (!mod) return;
    selectedModuleId = moduleId;
    if (pickerInstance) pickerInstance.setSelected(moduleId);
    prefetchBooks();
    emitStateChange();
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
      query: input ? input.value.trim() : '',
    });
  }

  function getState() {
    const width = sidebar ? sidebar.offsetWidth : DEFAULT_WIDTH;
    widthRatio = Math.min(0.9, Math.max(0.1, width / getViewportWidth()));
    return {
      widthRatio,
      moduleId: selectedModuleId,
      query: input ? input.value.trim() : '',
    };
  }

  return {
    init,
    focusInput,
    search,
    setSelectedModule,
    setStateChangeListener,
    getState,
    getSidebar,
  };
})();

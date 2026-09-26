/**
 * search-panel.js — Fixed left sidebar for searching Bible verses by word
 */
import { Icons } from './icons.js';
import { I18n } from './i18n.js';
import { ModulePicker, type ModulePickerInstance } from './module-picker.js';
import { Utils } from './utils.js';
import { VerseUtils } from './verse-utils.js';
import { WorkbenchShell } from './workbench-shell.js';

interface SearchPanelOpenResult {
  moduleId: string | null;
  bookNumber: number;
  chapter: number;
  verse: number;
  openInNewWorkspace: boolean;
}

interface SearchPanelOptions {
  onOpenResult?: (result: SearchPanelOpenResult) => void | Promise<void>;
}

interface StrongSearchTerm {
  prefix: string;
  number: string;
}

type SearchPanelStateListener = (state: SearchPanelPersistedState) => void;
type SearchPanelOpenResultHandler = (result: SearchPanelOpenResult) => void | Promise<void>;

export const SearchPanel = (() => {
  let modules: ModuleRecord[] = [];
  let selectedModuleId: string | null = null;
  let booksCache: Record<string, BookRecord[]> = {};
  let onStateChange: SearchPanelStateListener | null = null;
  let onOpenResult: SearchPanelOpenResultHandler | null = null;

  // DOM refs
  let panel: HTMLDivElement | null = null;
  let input: HTMLInputElement | null = null;
  let select: HTMLDivElement | null = null;
  let resultsList: HTMLDivElement | null = null;
  let statusEl: HTMLDivElement | null = null;
  let searchClearBtn: HTMLButtonElement | null = null;
  let pickerInstance: ModulePickerInstance | null = null;
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let searchSequence = 0;

  const PREVIEW_MAX_CHARS = 160;
  const SEARCH_DEBOUNCE_MS = 300;

  function init(
    moduleList: ModuleRecord[],
    savedState: SearchPanelPersistedState | null,
    mountEl: HTMLElement | null,
    options: SearchPanelOptions = {}
  ): void {
    modules = moduleList;
    onOpenResult = typeof options.onOpenResult === 'function' ? options.onOpenResult : null;
    selectedModuleId =
      savedState?.moduleId && modules.some((m) => m.id === savedState.moduleId)
        ? savedState.moduleId
        : (modules[0] && modules[0].id) || null;
    buildDOM(mountEl);
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

  function buildDOM(mountEl: HTMLElement | null): void {
    const host = mountEl || document.getElementById('pane-root')?.parentElement;
    if (!host) return;
    host.innerHTML = '';

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
      onChange: (moduleId: string | null) => {
        cancelPendingSearch();
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
    input.addEventListener('keydown', (e: KeyboardEvent) => {
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
      cancelPendingSearch();
      input.value = '';
      searchClearBtn.style.display = 'none';
      statusEl.textContent = '';
      showHint();
      input.focus();
      emitStateChange();
    });
    searchClearBtn.style.display = 'none';

    input.addEventListener('input', () => {
      searchClearBtn.style.display = input.value ? '' : 'none';
      scheduleSearch();
      emitStateChange();
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

    host.appendChild(panel);

    showHint();
  }

  function showHint(): void {
    resultsList.innerHTML = '';
    const hint = document.createElement('div');
    hint.className = 'search-panel-hint';
    hint.setAttribute('data-i18n', 'searchHint');
    hint.textContent = I18n.t('searchHint');
    resultsList.appendChild(hint);
  }

  async function prefetchBooks(): Promise<void> {
    if (!selectedModuleId) return;
    if (booksCache[selectedModuleId]) return;
    try {
      booksCache[selectedModuleId] = await window.api.getBooks(selectedModuleId);
    } catch (err) {
      console.warn('Failed to prefetch books:', err);
    }
  }

  function getBookShortName(bookNumber: number): string {
    return I18n.bookName(bookNumber).short;
  }

  async function runSearch(): Promise<void> {
    cancelPendingSearch(false);
    const searchId = ++searchSequence;
    const query = input.value.trim();
    resultsList.innerHTML = '';

    if (!query) {
      statusEl.textContent = '';
      showHint();
      emitStateChange();
      return;
    }

    const hasStrong = /strong:[HhGg]?\d+\w*/i.test(query);
    const textTerms = extractSearchTerms(query);
    if (!hasStrong && textTerms.length === 0) {
      statusEl.textContent = I18n.t('searchMinChars');
      emitStateChange();
      return;
    }

    if (!selectedModuleId) return;

    // Ensure books are cached before showing results
    await prefetchBooks();
    if (searchId !== searchSequence) return;

    statusEl.textContent = I18n.t('searching');

    try {
      const results = await window.api.searchVerses(selectedModuleId, query);
      if (searchId !== searchSequence) return;

      if (results.length === 0) {
        statusEl.textContent = I18n.t('searchNoResults');
        emitStateChange();
        return;
      }

      statusEl.textContent = I18n.t('searchResultCount').replace('{count}', String(results.length));

      const strongTerms = extractStrongTerms(query);
      renderResults(results, textTerms, strongTerms);
    } catch (err) {
      if (searchId !== searchSequence) return;
      statusEl.textContent = getErrorMessage(err);
    }
    emitStateChange();
  }

  function scheduleSearch(): void {
    cancelPendingSearch(false);
    searchDebounceTimer = setTimeout(() => {
      searchDebounceTimer = null;
      runSearch();
    }, SEARCH_DEBOUNCE_MS);
  }

  function cancelPendingSearch(invalidateInFlight = true): void {
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }
    if (invalidateInFlight) searchSequence++;
  }

  function renderResults(
    results: SearchResult[],
    terms: string[],
    strongTerms: StrongSearchTerm[]
  ): void {
    const frag = document.createDocumentFragment();

    for (const row of sortResultsCanonical(results)) {
      const item = createResultItem(row, terms, strongTerms);
      frag.appendChild(item);
    }

    resultsList.appendChild(frag);
  }

  function sortResultsCanonical(results: SearchResult[]): SearchResult[] {
    return [...results].sort((a, b) => {
      if (a.bookNumber !== b.bookNumber) return a.bookNumber - b.bookNumber;
      if (a.chapter !== b.chapter) return a.chapter - b.chapter;
      return a.verse - b.verse;
    });
  }

  function createResultItem(
    row: SearchResult,
    terms: string[],
    strongTerms: StrongSearchTerm[]
  ): HTMLDivElement {
    const item = document.createElement('div');
    item.className = 'search-result-item';
    item.addEventListener('click', (event) => {
      if (onOpenResult) {
        onOpenResult({
          moduleId: selectedModuleId,
          bookNumber: row.bookNumber,
          chapter: row.chapter,
          verse: row.verse,
          openInNewWorkspace: event.ctrlKey || event.metaKey,
        });
      }
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
      // Render from the Strong's HTML. cleanText() inserts spaces where <S> tags
      // were, so a window taken from that string does not line up with this HTML
      // and the fallback clip hides hits past the first preview width.
      const richHtml = VerseUtils.cleanTextWithStrongs(row.text, strongTerms);
      const plainFromRich = htmlPlainText(richHtml);
      const matchedWords = extractMatchedWords(row.text, strongTerms);
      const markAnchors = extractMarkAnchors(richHtml);
      const allTerms = terms.concat(markAnchors.length > 0 ? markAnchors : matchedWords);
      const range = previewRange(plainFromRich, allTerms, PREVIEW_MAX_CHARS);
      let richSnippet = sliceRichHtml(richHtml, range.start, range.end);
      if (range.start > 0) richSnippet = '...' + richSnippet;
      if (range.end < plainFromRich.length) richSnippet += '...';
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

  function extractStrongTerms(query: string): StrongSearchTerm[] {
    const terms: StrongSearchTerm[] = [];
    const regex = /strong:([HhGg]?)(\d+\w*)/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(query)) !== null) {
      const prefix = (match[1] || '').toUpperCase();
      const number = match[2];
      terms.push({ prefix, number });
    }
    return terms;
  }

  function extractMatchedWords(rawText: string, strongTerms: StrongSearchTerm[]): string[] {
    if (!rawText || strongTerms.length === 0) return [];
    const matchSet = new Set<string>();
    for (const sn of strongTerms) {
      const full = (sn.prefix + sn.number).toUpperCase();
      matchSet.add(full);
      matchSet.add(sn.number.toUpperCase());
    }
    const words: string[] = [];
    const regex = /(\S+)\s*<S>([\s\S]*?)<\/S>/gi;
    let match: RegExpExecArray | null;
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

  function extractMarkAnchors(richHtml: string): string[] {
    const anchors: string[] = [];
    const regex = /<mark>([\s\S]*?)<\/mark>/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(richHtml)) !== null) {
      const plain = htmlPlainText(match[1]).trim();
      if (plain) anchors.push(plain);
    }
    return anchors;
  }

  function decodeHtmlEntity(entity: string): string {
    switch (entity.toLowerCase()) {
      case '&amp;':
        return '&';
      case '&lt;':
        return '<';
      case '&gt;':
        return '>';
      case '&quot;':
        return '"';
      case '&nbsp;':
        return ' ';
      default: {
        const decimal = /^&#(\d+);$/.exec(entity);
        if (decimal) return String.fromCodePoint(Number(decimal[1]));
        const hex = /^&#x([0-9a-f]+);$/i.exec(entity);
        if (hex) return String.fromCodePoint(parseInt(hex[1], 16));
        return ' ';
      }
    }
  }

  /** Plain text with the same character indexes sliceRichHtml walks. */
  function htmlPlainText(html: string): string {
    let plain = '';
    let i = 0;
    while (i < html.length) {
      if (html[i] === '<') {
        const tagEnd = html.indexOf('>', i);
        if (tagEnd === -1) break;
        i = tagEnd + 1;
        continue;
      }
      if (html[i] === '&') {
        const entEnd = html.indexOf(';', i);
        if (entEnd > i) {
          plain += decodeHtmlEntity(html.slice(i, entEnd + 1));
          i = entEnd + 1;
          continue;
        }
      }
      plain += html[i];
      i++;
    }
    return plain;
  }

  function sliceRichHtml(html: string, startPlain: number, endPlain: number): string {
    // Walk through html, tracking plain-text position, and extract the range [startPlain, endPlain)
    let plainPos = 0;
    let i = 0;
    let collecting = false;
    let result = '';
    let openTags: string[] = [];

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

  function extractSearchTerms(query: string): string[] {
    const seen = new Set<string>();
    const terms: string[] = [];
    const withoutStrongs = query.replace(/strong:[HhGg]?\d+\w*/gi, ' ');
    const withoutQuotedPhrases = withoutStrongs.replace(/"([^"]+)"/g, (_full, phrase: string) => {
      const normalized = phrase.replace(/\s+/g, ' ').trim();
      if (normalized.length >= 2) terms.push(normalized);
      return ' ';
    });
    const rawTerms = withoutQuotedPhrases
      .trim()
      .split(/\s+/)
      .filter((t: string) => t.length >= 2);
    for (const term of rawTerms) {
      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      terms.push(term);
    }
    return terms;
  }

  function previewRange(
    text: string,
    terms: string[],
    maxChars: number
  ): { start: number; end: number } {
    if (!text) return { start: 0, end: 0 };
    if (text.length <= maxChars) return { start: 0, end: text.length };

    const firstMatch = findFirstMatchIndex(text, terms);
    if (firstMatch < 0) {
      return { start: 0, end: moveToWordBoundary(text, maxChars, 1) };
    }

    let start = Math.max(0, firstMatch - Math.floor(maxChars / 2));
    let end = Math.min(text.length, start + maxChars);
    if (end - start < maxChars && start > 0) {
      start = Math.max(0, end - maxChars);
    }

    start = moveToWordBoundary(text, start, -1);
    end = moveToWordBoundary(text, end, 1);
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    return { start, end };
  }

  function buildPreviewSnippet(text: string, terms: string[], maxChars: number): string {
    const compact = (text || '').replace(/\s+/g, ' ').trim();
    if (!compact) return '';
    const { start, end } = previewRange(compact, terms, maxChars);
    let snippet = compact.slice(start, end);
    if (start > 0) snippet = '...' + snippet;
    if (end < compact.length) snippet = snippet + '...';
    return snippet;
  }

  function findFirstMatchIndex(text: string, terms: string[]): number {
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

  function moveToWordBoundary(text: string, pos: number, direction: number): number {
    if (direction < 0) {
      let i = Math.max(0, pos);
      while (i > 0 && !/\s/.test(text[i - 1])) i--;
      return i;
    }
    let i = Math.min(text.length, pos);
    while (i < text.length && !/\s/.test(text[i])) i++;
    return i;
  }

  function highlightText(text: string, terms: string[]): string {
    let result = Utils.escapeHtml(text);
    for (const term of terms) {
      const escapedTerm = Utils.escapeHtml(term);
      const regex = new RegExp(`(${escapeRegex(escapedTerm)})`, 'gi');
      result = result.replace(regex, '<mark>$1</mark>');
    }
    return result;
  }

  function highlightRichText(html: string, terms: string[]): string {
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

  function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function setSelectedModule(moduleId: string | null): void {
    if (!moduleId) return;
    const mod = modules.find((m) => m.id === moduleId);
    if (!mod) return;
    cancelPendingSearch();
    selectedModuleId = moduleId;
    if (pickerInstance) pickerInstance.setSelected(moduleId);
    prefetchBooks();
    emitStateChange();
  }

  function setModules(moduleList: ModuleRecord[] | null): void {
    cancelPendingSearch();
    modules = moduleList || [];
    booksCache = {};
    if (!modules.some((m) => m.id === selectedModuleId)) {
      selectedModuleId = modules[0]?.id || null;
    }
    if (pickerInstance) {
      pickerInstance.setModules(Utils.sortBibleModules(modules));
      pickerInstance.setSelected(selectedModuleId);
    }
    prefetchBooks();
    emitStateChange();
  }

  function search(query: string): void {
    WorkbenchShell.activateSidebar('search', { focus: true });
    if (input) {
      cancelPendingSearch();
      input.value = query;
      if (searchClearBtn) searchClearBtn.style.display = query ? '' : 'none';
      runSearch();
    }
  }

  function focusInput(): void {
    WorkbenchShell.activateSidebar('search', { focus: true });
    if (input) input.focus();
  }

  function getErrorMessage(error: Error | string | object | null | undefined): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    if (error && 'message' in error) return String(error.message);
    return String(error || '');
  }

  function setStateChangeListener(listener: SearchPanelStateListener | null): void {
    onStateChange = typeof listener === 'function' ? listener : null;
  }

  function emitStateChange(): void {
    if (!onStateChange) return;
    onStateChange({
      moduleId: selectedModuleId,
      query: input ? input.value.trim() : '',
    });
  }

  function getState(): SearchPanelPersistedState {
    return {
      moduleId: selectedModuleId,
      query: input ? input.value.trim() : '',
    };
  }

  return {
    init,
    focusInput,
    search,
    setSelectedModule,
    setModules,
    setStateChangeListener,
    getState,
  };
})();

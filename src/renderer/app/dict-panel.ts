/**
 * dict-panel.js — Dictionary panel for Strong's number and word lookups
 */
import { AppStateStore } from './app-state-store.js';
import {
  bindBibleRefs,
  bindDictionaryTopicLinks,
  bindStrongsCrossRefs,
  bindVCrossRefs,
  setDictLinkHandlers,
} from './dict-link-binding.js';
import { formatDefinition } from './dict-definition-format.js';
import { I18n } from './i18n.js';
import { Icons } from './icons.js';
import { ModulePicker, type ModulePickerInstance } from './module-picker.js';
import { PaneManager } from './pane-manager.js';
import { Sanitize } from './sanitize.js';
import { Settings } from './settings-dialog.js';
import { Utils } from './utils.js';
import { WorkbenchShell } from './workbench-shell.js';

interface DictPanelState {
  selectedModuleId?: string | null;
  moduleSearchCache?: Record<string, string>;
}

interface DictPanelSnapshot {
  selectedModuleId: string | null;
  moduleSearchCache: Record<string, string>;
}

interface LookupContextInput {
  sourceModuleId?: string | null;
  morphCode?: string | null;
  lemma?: string | null;
  paneId?: string | null;
}

interface NormalizedLookupContext {
  sourceModuleId: string | null;
  morphCode: string | null;
  lemma: string | null;
  paneId: string | null;
}

interface LookupWordOptions {
  preserveActivity?: boolean;
}

interface StrongLookupEntry {
  type: 'strong';
  topic: string;
  context: NormalizedLookupContext | null;
  moduleId?: string | null;
}

interface WordLookupEntry {
  type: 'word';
  topic: string;
  moduleId: string | null;
  context?: NormalizedLookupContext | null;
}

type LookupHistoryEntry = StrongLookupEntry | WordLookupEntry;
type CurrentLookup = LookupHistoryEntry;

interface DictHistory {
  entries: LookupHistoryEntry[];
  idx: number;
}




type StateChangeListener = (state: DictPanelSnapshot) => void;
type TimerHandle = ReturnType<typeof setTimeout>;

export const DictPanel = (() => {
  let dictModules: ModuleRecord[] = [];
  let selectedModuleId: string | null = null;
  const moduleSearchCache = new Map<string, string>();
  let currentLookup: CurrentLookup | null = null;
  let onStateChange: StateChangeListener | null = null;
  let autocompleteTimer: TimerHandle | null = null;
  let activeAutocompleteIdx = -1;

  // Navigation history (single unified list)
  let history: DictHistory = { entries: [], idx: -1 };
  let navBackBtn: HTMLButtonElement | null = null;
  let navForwardBtn: HTMLButtonElement | null = null;

  // DOM refs
  let panel: HTMLDivElement | null = null;
  let contentEl: HTMLDivElement | null = null;
  let searchInput: HTMLInputElement | null = null;
  let autocompleteEl: HTMLDivElement | null = null;
  let dictClearBtn: HTMLButtonElement | null = null;
  let moduleSelect: HTMLDivElement | null = null;
  let dictPickerInstance: ModulePickerInstance | null = null;

  function init(
    modules: ModuleRecord[],
    savedState: DictPanelState | null = null,
    mountEl: HTMLElement | null = null
  ): void {
    dictModules = modules;
    moduleSearchCache.clear();
    if (
      savedState &&
      savedState.moduleSearchCache &&
      typeof savedState.moduleSearchCache === 'object'
    ) {
      for (const [moduleId, topic] of Object.entries(savedState.moduleSearchCache)) {
        if (typeof topic === 'string' && topic.trim()) moduleSearchCache.set(moduleId, topic);
      }
    }
    selectedModuleId = resolveSelectedModuleId(savedState?.selectedModuleId);
    setDictLinkHandlers({
      ensureCurrentInHistory,
      lookup,
      lookupWord,
    });
    buildDOM(mountEl);
    restoreSelectedModuleSearch();
    emitStateChange();
  }

  function resolveSelectedModuleId(candidate: string | null | undefined): string | null {
    if (candidate && dictModules.some((m) => m.id === candidate)) return candidate;
    return dictModules[0]?.id || null;
  }

  function setModules(modules: ModuleRecord[] | null): void {
    dictModules = modules || [];
    for (const moduleId of Array.from(moduleSearchCache.keys())) {
      if (!dictModules.some((m) => m.id === moduleId)) moduleSearchCache.delete(moduleId);
    }
    selectedModuleId = resolveSelectedModuleId(selectedModuleId);
    if (dictPickerInstance) {
      dictPickerInstance.setModules(dictModules);
      dictPickerInstance.setSelected(selectedModuleId);
    }
    emitStateChange();
  }

  function getModuleById(moduleId: string | null): ModuleRecord | null {
    return dictModules.find((m) => m.id === moduleId) || null;
  }

  function buildDOM(mountEl: HTMLElement | null): void {
    const host = mountEl || document.getElementById('pane-root')?.parentElement;
    if (!host) return;
    host.innerHTML = '';

    // Dict panel
    panel = document.createElement('div');
    panel.id = 'dict-panel';

    // Header
    const header = document.createElement('div');
    header.className = 'dict-panel-header';

    const titleRow = document.createElement('div');
    titleRow.className = 'flex items-center gap-2';
    const icon = Icons.create('book-open', 'w-4 h-4');
    icon.setAttribute('width', '16');
    icon.setAttribute('height', '16');
    icon.style.flexShrink = '0';
    titleRow.appendChild(icon);
    const title = document.createElement('span');
    title.className = 'font-semibold text-sm';
    title.setAttribute('data-i18n', 'dictionary');
    title.textContent = I18n.t('dictionary');
    titleRow.appendChild(title);

    const navGroup = document.createElement('div');
    navGroup.className = 'dict-nav-group';
    navBackBtn = document.createElement('button');
    navBackBtn.className = 'dict-nav-btn';
    navBackBtn.type = 'button';
    navBackBtn.disabled = true;
    navBackBtn.appendChild(Icons.create('chevron-left', 'w-3.5 h-3.5'));
    navBackBtn.addEventListener('click', navBack);
    navForwardBtn = document.createElement('button');
    navForwardBtn.className = 'dict-nav-btn';
    navForwardBtn.type = 'button';
    navForwardBtn.disabled = true;
    navForwardBtn.appendChild(Icons.create('chevron-right', 'w-3.5 h-3.5'));
    navForwardBtn.addEventListener('click', navForward);
    const infoBtn = document.createElement('button');
    infoBtn.type = 'button';
    infoBtn.className = 'dict-info-btn';
    infoBtn.title = I18n.t('dictInfoTitle');
    infoBtn.setAttribute('aria-label', I18n.t('dictInfoTitle'));
    infoBtn.appendChild(Icons.create('info', 'w-3.5 h-3.5'));
    infoBtn.addEventListener('click', () => openDictionaryInfoModal());

    navGroup.append(navBackBtn, navForwardBtn, infoBtn);
    titleRow.appendChild(navGroup);

    header.appendChild(titleRow);

    const controlsRow = document.createElement('div');
    controlsRow.className = 'dict-controls-row mt-2';

    const dictPicker = ModulePicker.create({
      modules: dictModules,
      selectedId: selectedModuleId,
      moduleType: 'dictionary',
      truncateLength: 60,
      className: 'panel-select',
      onChange: (moduleId: string | null) => {
        const prevModuleId = selectedModuleId;
        persistCurrentModuleSearch(prevModuleId);
        selectedModuleId = moduleId || resolveSelectedModuleId(null);
        restoreSelectedModuleSearch();
        updateNavButtons();
        emitStateChange();
      },
    });
    dictPickerInstance = dictPicker;
    moduleSelect = dictPicker.el;

    controlsRow.append(moduleSelect);
    header.appendChild(controlsRow);

    // Search input with autocomplete wrapper
    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'dict-search-wrapper mt-2';

    searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'panel-search-input';
    searchInput.setAttribute('data-i18n-placeholder', 'dictSearchPlaceholder');
    searchInput.placeholder = I18n.t('dictSearchPlaceholder');
    searchInput.addEventListener('input', onSearchInput);
    searchInput.addEventListener('keydown', onSearchKeydown);

    dictClearBtn = document.createElement('button');
    dictClearBtn.className = 'input-clear-btn';
    dictClearBtn.type = 'button';
    dictClearBtn.innerHTML = '&times;';
    dictClearBtn.addEventListener('click', () => {
      searchInput.value = '';
      dictClearBtn.style.display = 'none';
      hideAutocomplete();
      if (selectedModuleId) moduleSearchCache.delete(selectedModuleId);
      currentLookup = null;
      contentEl.innerHTML =
        '<div class="dict-placeholder">' + Utils.escapeHtml(I18n.t('dictSelectTopic')) + '</div>';
      searchInput.focus();
    });
    dictClearBtn.style.display = 'none';

    searchInput.addEventListener('input', () => {
      dictClearBtn.style.display = searchInput.value ? '' : 'none';
    });

    autocompleteEl = document.createElement('div');
    autocompleteEl.className = 'dict-autocomplete';
    autocompleteEl.style.display = 'none';

    searchWrapper.appendChild(searchInput);
    searchWrapper.appendChild(dictClearBtn);
    searchWrapper.appendChild(autocompleteEl);
    header.appendChild(searchWrapper);
    panel.appendChild(header);

    // Content area
    contentEl = document.createElement('div');
    contentEl.className = 'dict-panel-content';
    contentEl.innerHTML =
      '<div class="dict-placeholder">' + Utils.escapeHtml(I18n.t('dictSelectTopic')) + '</div>';
    panel.appendChild(contentEl);

    host.appendChild(panel);

    // Close autocomplete when clicking outside
    document.addEventListener('click', (e: MouseEvent) => {
      if (!(e.target instanceof Node)) return;
      if (!searchWrapper.contains(e.target)) hideAutocomplete();
    });
  }

  // --- Autocomplete for word-keyed dictionaries ---

  function onSearchInput(): void {
    const val = searchInput.value.trim();
    if (autocompleteTimer) clearTimeout(autocompleteTimer);

    const moduleId = selectedModuleId || resolveSelectedModuleId(null);
    if (val.length < 2 || !moduleId) {
      hideAutocomplete();
      return;
    }

    autocompleteTimer = setTimeout(async () => {
      try {
        const topics = await window.api.searchDictionaryTopics(moduleId, val, 20);
        if (!Array.isArray(topics) || topics.length === 0) {
          hideAutocomplete();
          return;
        }
        showAutocomplete(topics, moduleId);
      } catch (_) {
        hideAutocomplete();
      }
    }, 200);
  }

  function onSearchKeydown(e: KeyboardEvent): void {
    if (autocompleteEl.style.display === 'none') {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = searchInput.value.trim();
        if (!val) return;
        lookupWord(val);
      }
      return;
    }

    const items = autocompleteEl.querySelectorAll<HTMLDivElement>('.dict-autocomplete-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeAutocompleteIdx = Math.min(activeAutocompleteIdx + 1, items.length - 1);
      updateAutocompleteActive(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeAutocompleteIdx = Math.max(activeAutocompleteIdx - 1, 0);
      updateAutocompleteActive(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeAutocompleteIdx >= 0 && items[activeAutocompleteIdx]) {
        items[activeAutocompleteIdx].click();
      } else {
        hideAutocomplete();
        const val = searchInput.value.trim();
        if (!val) return;
        lookupWord(val);
      }
    } else if (e.key === 'Escape') {
      hideAutocomplete();
    }
  }

  function showAutocomplete(results: string[], moduleId: string): void {
    autocompleteEl.innerHTML = '';
    activeAutocompleteIdx = -1;
    for (const topic of results) {
      const item = document.createElement('div');
      item.className = 'dict-autocomplete-item';
      const label = document.createElement('span');
      label.className = 'dict-autocomplete-topic';
      label.textContent = topic;
      item.appendChild(label);
      item.addEventListener('click', () => {
        searchInput.value = topic;
        hideAutocomplete();
        lookupWord(topic, moduleId);
      });
      autocompleteEl.appendChild(item);
    }
    autocompleteEl.style.display = 'block';
  }

  function hideAutocomplete(): void {
    autocompleteEl.style.display = 'none';
    activeAutocompleteIdx = -1;
  }

  function updateAutocompleteActive(items: NodeListOf<HTMLElement>): void {
    for (let i = 0; i < items.length; i++) {
      items[i].classList.toggle('active', i === activeAutocompleteIdx);
    }
  }

  // --- Module header helper ---

  function createModuleHeader(moduleId: string): HTMLDivElement {
    const mod = getModuleById(moduleId);
    const header = document.createElement('div');
    header.className = 'dict-module-header';

    const idSpan = document.createElement('span');
    const displayName = mod ? Utils.getModuleDisplayName(mod) : moduleId;
    idSpan.textContent = Utils.truncateText(displayName, 80);
    idSpan.title = displayName;
    header.appendChild(idSpan);

    if (mod && mod.id && mod.id !== displayName) {
      const tag = document.createElement('span');
      tag.className = 'dict-module-desc';
      tag.textContent = Utils.truncateText(mod.id, 48);
      tag.title = mod.id;
      header.appendChild(tag);
    }

    return header;
  }

  function persistCurrentModuleSearch(moduleId: string | null): void {
    if (!moduleId) return;
    if (
      currentLookup &&
      currentLookup.type === 'word' &&
      currentLookup.moduleId === moduleId &&
      currentLookup.topic
    ) {
      moduleSearchCache.set(moduleId, currentLookup.topic);
    }
  }

  function restoreSelectedModuleSearch(): void {
    const moduleId = selectedModuleId;
    if (!moduleId) return;
    const cachedTopic = moduleSearchCache.get(moduleId);
    if (!cachedTopic) {
      currentLookup = null;
      searchInput.value = '';
      if (dictClearBtn) dictClearBtn.style.display = 'none';
      hideAutocomplete();
      contentEl.innerHTML =
        '<div class="dict-placeholder">' + Utils.escapeHtml(I18n.t('dictSelectTopic')) + '</div>';
      return;
    }
    searchInput.value = cachedTopic;
    if (dictClearBtn) dictClearBtn.style.display = '';
    lookupWord(cachedTopic, moduleId, true, { preserveActivity: true });
  }


  async function openDictionaryInfoModal(): Promise<void> {
    const moduleId = resolveSelectedModuleId(selectedModuleId);
    if (!moduleId) return;
    selectedModuleId = moduleId;
    if (dictPickerInstance) dictPickerInstance.setSelected(moduleId);

    // Keep modal behavior aligned with commentary coverage modal.
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-40 bg-black/50 flex items-center justify-center';
    const modal = document.createElement('div');
    modal.className =
      'bg-brand-50 dark:bg-night-800 shadow-2xl w-[760px] max-w-[92vw] max-h-[85vh] flex flex-col overflow-hidden';

    const header = document.createElement('div');
    header.className =
      'p-4 border-b border-brand-300 dark:border-night-600 flex items-center justify-between gap-3';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'min-w-0';
    const titleEl = document.createElement('h2');
    titleEl.className = 'text-lg font-semibold';
    const subtitleEl = document.createElement('p');
    subtitleEl.className = 'text-xs text-brand-600 dark:text-night-300 mt-1 truncate';
    titleWrap.append(titleEl, subtitleEl);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className =
      'px-2 py-1 rounded-sm hover:bg-brand-200 dark:hover:bg-night-700 text-brand-500 dark:text-night-400 cursor-pointer transition-colors inline-flex items-center justify-center';
    closeBtn.title = I18n.t('close');
    closeBtn.appendChild(Icons.create('x'));
    header.append(titleWrap, closeBtn);

    const body = document.createElement('div');
    body.className = 'dict-info-body';
    body.innerHTML = `
      <section class="dict-info-section">
        <h3 class="dict-info-section-title"></h3>
        <p class="dict-info-usage"></p>
      </section>
      <section class="dict-info-section">
        <h3 class="dict-info-section-title"></h3>
        <p class="dict-info-count"></p>
        <div class="dict-info-random"></div>
      </section>
      <section class="dict-info-section">
        <h3 class="dict-info-section-title"></h3>
        <div class="dict-info-browse-controls">
          <input type="text" class="dict-info-browse-input" />
        </div>
        <div class="dict-info-browse-list"></div>
        <div class="dict-info-browse-pager">
          <button type="button" class="dict-info-page-btn prev">&lsaquo;</button>
          <button type="button" class="dict-info-page-btn next">&rsaquo;</button>
        </div>
      </section>
    `;

    modal.append(header, body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const closeModal = (): void => {
      overlay.remove();
      document.removeEventListener('keydown', onKeyDown);
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeModal();
    };

    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.target === overlay) closeModal();
    });
    document.addEventListener('keydown', onKeyDown);

    const sectionTitles = body.querySelectorAll<HTMLElement>('.dict-info-section-title');
    const usageEl = body.querySelector<HTMLParagraphElement>('.dict-info-usage');
    const countEl = body.querySelector<HTMLParagraphElement>('.dict-info-count');
    const randomEl = body.querySelector<HTMLDivElement>('.dict-info-random');
    const browseInput = body.querySelector<HTMLInputElement>('.dict-info-browse-input');
    const browseList = body.querySelector<HTMLDivElement>('.dict-info-browse-list');
    const prevBtn = body.querySelector<HTMLButtonElement>('.dict-info-page-btn.prev');
    const nextBtn = body.querySelector<HTMLButtonElement>('.dict-info-page-btn.next');

    sectionTitles[0].textContent = I18n.t('dictUsageTitle');
    sectionTitles[1].textContent = I18n.t('dictAvailableTitle');
    sectionTitles[2].textContent = I18n.t('dictBrowseTitle');
    browseInput.placeholder = I18n.t('dictBrowsePlaceholder');

    const mod = getModuleById(moduleId);
    const displayName = mod ? Utils.getModuleDisplayName(mod) : moduleId;
    titleEl.textContent = Utils.truncateText(displayName, 120);
    titleEl.title = displayName;
    subtitleEl.textContent = moduleId;
    subtitleEl.title = moduleId;

    usageEl.textContent = I18n.t('dictUsageBody');
    countEl.textContent = '...';
    randomEl.textContent = '';
    browseList.textContent = '...';

    const PAGE_SIZE = 50;
    let offset = 0;

    const renderPage = async (): Promise<void> => {
      const prefix = (browseInput.value || '').trim();
      const topics = await window.api.getDictionaryTopicsByPrefix(
        moduleId,
        prefix,
        PAGE_SIZE,
        offset
      );
      browseList.innerHTML = '';
      if (!topics.length) {
        const empty = document.createElement('div');
        empty.className = 'dict-placeholder';
        empty.textContent = I18n.t('dictBrowseNoResults');
        browseList.appendChild(empty);
      } else {
        for (const topic of topics) {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'dict-info-topic-item';
          item.textContent = topic;
          item.addEventListener('click', () => {
            closeModal();
            lookupWord(topic, moduleId);
          });
          browseList.appendChild(item);
        }
      }
      prevBtn.disabled = offset <= 0;
      nextBtn.disabled = topics.length < PAGE_SIZE;
    };

    prevBtn.onclick = async () => {
      if (offset <= 0) return;
      offset = Math.max(0, offset - PAGE_SIZE);
      await renderPage();
    };
    nextBtn.onclick = async () => {
      offset += PAGE_SIZE;
      await renderPage();
    };
    browseInput.oninput = async () => {
      offset = 0;
      await renderPage();
    };

    try {
      const [meta, count, randomTopics] = await Promise.all([
        window.api.getDictionaryMeta(moduleId),
        window.api.getDictionaryTopicCount(moduleId),
        window.api.getDictionaryRandomTopics(moduleId, 20),
      ]);
      const typeLabel = meta.isStrongDict ? I18n.t('strongsDictionaries') : I18n.t('dictionary');
      usageEl.textContent = `${I18n.t('dictUsageBody')} (${typeLabel})`;
      countEl.textContent = I18n.t('dictTotalWords').replace('{count}', String(count));
      randomEl.innerHTML = '';
      const randomLabel = document.createElement('div');
      randomLabel.className = 'dict-info-random-label';
      randomLabel.textContent = I18n.t('dictRandomSample');
      randomEl.appendChild(randomLabel);
      const randomList = document.createElement('div');
      randomList.className = 'dict-info-random-list';
      for (const topic of randomTopics || []) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'dict-cognate-tag';
        chip.textContent = topic;
        chip.addEventListener('click', () => {
          closeModal();
          lookupWord(topic, moduleId);
        });
        randomList.appendChild(chip);
      }
      randomEl.appendChild(randomList);
      await renderPage();
    } catch (err) {
      countEl.textContent = getErrorMessage(err);
      browseList.textContent = '';
    }
  }

  // --- Navigation history ---

  function pushHistory(entry: LookupHistoryEntry): void {
    const prev = history.entries[history.idx];
    if (
      prev &&
      prev.type === entry.type &&
      prev.topic === entry.topic &&
      prev.moduleId === entry.moduleId &&
      (prev.context?.morphCode || null) === (entry.context?.morphCode || null) &&
      (prev.context?.lemma || null) === (entry.context?.lemma || null) &&
      (prev.context?.sourceModuleId || null) === (entry.context?.sourceModuleId || null)
    )
      return;
    history.entries.splice(history.idx + 1);
    history.entries.push(entry);
    history.idx = history.entries.length - 1;
    updateNavButtons();
  }

  function updateNavButtons(): void {
    if (navBackBtn) navBackBtn.disabled = history.idx <= 0;
    if (navForwardBtn) navForwardBtn.disabled = history.idx >= history.entries.length - 1;
  }

  function navBack(): void {
    if (history.idx <= 0) return;
    history.idx--;
    replayHistory();
  }

  function navForward(): void {
    if (history.idx >= history.entries.length - 1) return;
    history.idx++;
    replayHistory();
  }

  function replayHistory(): void {
    updateNavButtons();
    const entry = history.entries[history.idx];
    if (!entry) return;
    if (entry.type === 'strong') {
      lookup(entry.topic, true, entry.context || null);
    } else {
      lookupWord(entry.topic, entry.moduleId, true);
    }
  }

  function ensureCurrentInHistory(): void {
    if (!currentLookup) return;
    if (history.idx >= 0 && history.entries.length > 0) {
      const cur = history.entries[history.idx];
      if (cur && cur.type === currentLookup.type && cur.topic === currentLookup.topic) return;
    }
    if (currentLookup.type === 'strong') {
      pushHistory({
        type: 'strong',
        topic: currentLookup.topic,
        context: currentLookup.context || null,
      });
      return;
    }
    pushHistory({
      type: 'word',
      topic: currentLookup.topic,
      moduleId: currentLookup.moduleId || selectedModuleId,
    });
  }

  // --- Strong's lookup (multi-dictionary) ---

  function isPseudoStrongsNumber(strongsNumber: string): boolean {
    const match = String(strongsNumber || '')
      .trim()
      .match(/^([HG])(\d+)(\w*)$/i);
    if (!match) return false;
    return Number.parseInt(match[2], 10) >= 9000;
  }

  function normalizeLookupContext(
    lookupContext: LookupContextInput | null | undefined
  ): NormalizedLookupContext | null {
    if (!lookupContext || typeof lookupContext !== 'object') return null;
    const sourceModuleId =
      typeof lookupContext.sourceModuleId === 'string' && lookupContext.sourceModuleId.trim()
        ? lookupContext.sourceModuleId.trim()
        : null;
    const morphCode =
      typeof lookupContext.morphCode === 'string' && lookupContext.morphCode.trim()
        ? lookupContext.morphCode.trim()
        : null;
    const lemma =
      typeof lookupContext.lemma === 'string' && lookupContext.lemma.trim()
        ? lookupContext.lemma.trim()
        : null;
    const paneId =
      typeof lookupContext.paneId === 'string' && lookupContext.paneId.trim()
        ? lookupContext.paneId.trim()
        : null;
    if (!sourceModuleId && !morphCode && !lemma && !paneId) return null;
    return { sourceModuleId, morphCode, lemma, paneId };
  }

  async function lookup(
    strongsNumber: string,
    skipHistory = false,
    lookupContext: LookupContextInput | null = null
  ): Promise<void> {
    if (!panel) return;
    WorkbenchShell.activateSidebar('dictionary', { focus: true });
    WorkbenchShell.setCurrentLookup(strongsNumber);
    const normalizedContext = normalizeLookupContext(lookupContext);

    searchInput.value = strongsNumber;
    if (dictClearBtn) dictClearBtn.style.display = strongsNumber ? '' : 'none';
    hideAutocomplete();
    contentEl.innerHTML = '';

    if (!skipHistory) {
      pushHistory({ type: 'strong', topic: strongsNumber, context: normalizedContext });
    }
    currentLookup = { type: 'strong', topic: strongsNumber, context: normalizedContext };
    updateNavButtons();

    try {
      if (dictModules.length === 0) {
        contentEl.innerHTML =
          '<div class="dict-placeholder">' +
          Utils.escapeHtml(I18n.t('dictNoModulesInstalled')) +
          '</div>';
        return;
      }
      const strongsDictSetting = AppStateStore.getSettings().strongsDicts;
      const strongsDict = Array.isArray(strongsDictSetting)
        ? strongsDictSetting[0]
        : strongsDictSetting;
      if (!strongsDict) {
        const placeholder = document.createElement('div');
        placeholder.className = 'dict-placeholder';
        placeholder.textContent = I18n.t('dictNoDictsConfigured') + ' ';
        const link = document.createElement('a');
        link.className = 'dict-settings-link';
        link.textContent = I18n.t('settings');
        link.addEventListener('click', () => Settings.open());
        placeholder.appendChild(link);
        contentEl.innerHTML = '';
        contentEl.appendChild(placeholder);
        return;
      }

      if (dictPickerInstance && dictModules.some((m) => m.id === strongsDict)) {
        selectedModuleId = strongsDict;
        dictPickerInstance.setSelected(strongsDict);
      }

      const results = await window.api.lookupAllStrongDicts(strongsNumber, [strongsDict]);
      if (results.length === 0) {
        const message = isPseudoStrongsNumber(strongsNumber)
          ? I18n.t('dictPseudoStrongsNoEntry')
          : I18n.t('dictNoEntry');
        contentEl.innerHTML =
          '<div class="dict-placeholder">' + Utils.escapeHtml(message) + '</div>';
        return;
      }

      for (const { moduleId, entry } of results) {
        const section = document.createElement('div');
        section.className = 'dict-module-section';

        section.appendChild(createModuleHeader(moduleId));

        // Render entry based on module type
        renderModuleEntry(section, moduleId, entry, normalizedContext);
        contentEl.appendChild(section);
      }
    } catch (err) {
      contentEl.innerHTML =
        '<div class="dict-placeholder">' + Utils.escapeHtml(getErrorMessage(err)) + '</div>';
    }
  }

  // --- Word lookup (Almeida-style dictionaries) ---

  async function lookupWord(
    topic: string,
    moduleId: string | null = null,
    skipHistory = false,
    options: LookupWordOptions = {}
  ): Promise<void> {
    if (!panel) return;
    if (!options.preserveActivity) {
      WorkbenchShell.activateSidebar('dictionary', { focus: true });
    }
    WorkbenchShell.setCurrentLookup(topic);

    const resolvedModuleId = resolveSelectedModuleId(moduleId || selectedModuleId);
    if (!resolvedModuleId) {
      contentEl.innerHTML =
        '<div class="dict-placeholder">' +
        Utils.escapeHtml(I18n.t('dictNoModulesInstalled')) +
        '</div>';
      return;
    }
    if (dictPickerInstance) dictPickerInstance.setSelected(resolvedModuleId);
    selectedModuleId = resolvedModuleId;
    currentLookup = { type: 'word', topic, moduleId: resolvedModuleId };
    moduleSearchCache.set(resolvedModuleId, topic);

    searchInput.value = topic;
    if (dictClearBtn) dictClearBtn.style.display = topic ? '' : 'none';
    hideAutocomplete();
    contentEl.innerHTML = '';

    if (!skipHistory) pushHistory({ type: 'word', topic, moduleId: resolvedModuleId });
    updateNavButtons();

    try {
      if (dictModules.length === 0) {
        contentEl.innerHTML =
          '<div class="dict-placeholder">' +
          Utils.escapeHtml(I18n.t('dictNoModulesInstalled')) +
          '</div>';
        return;
      }

      const entry = await window.api.getDictionaryEntry(resolvedModuleId, topic);
      if (!entry) {
        contentEl.innerHTML =
          '<div class="dict-placeholder">' + Utils.escapeHtml(I18n.t('dictNoEntry')) + '</div>';
        return;
      }

      const section = document.createElement('div');
      section.className = 'dict-module-section';
      renderModuleEntry(section, resolvedModuleId, entry, null);
      contentEl.appendChild(section);
      emitStateChange();
    } catch (err) {
      contentEl.innerHTML =
        '<div class="dict-placeholder">' + Utils.escapeHtml(getErrorMessage(err)) + '</div>';
    }
  }

  // --- Per-module rendering dispatch ---

  function renderModuleEntry(
    container: HTMLElement,
    moduleId: string,
    entry: DictionaryEntry,
    lookupContext: NormalizedLookupContext | null
  ): void {
    const mod = dictModules.find((m) => m.id === moduleId);
    const isStrongDict = mod ? mod.isStrongDict : false;

    // Topic heading
    const topicEl = document.createElement('div');
    topicEl.className = 'dict-entry-topic';
    topicEl.textContent = entry.topic;
    container.appendChild(topicEl);

    if (isStrongDict) {
      renderStrongEntry(container, moduleId, entry, lookupContext);
    } else {
      renderWordEntry(container, moduleId, entry);
    }
  }

  function renderStrongEntry(
    container: HTMLElement,
    moduleId: string,
    entry: DictionaryEntry,
    lookupContext: NormalizedLookupContext | null
  ): void {
    // Lexeme
    if (entry.lexeme) {
      const lexEl = document.createElement('div');
      lexEl.className = 'dict-entry-lexeme';
      lexEl.textContent = entry.lexeme;
      container.appendChild(lexEl);
    }

    // Transliteration + pronunciation
    if (entry.transliteration || entry.pronunciation) {
      const metaEl = document.createElement('div');
      metaEl.className = 'dict-entry-meta';
      const parts: string[] = [];
      if (entry.transliteration) parts.push(entry.transliteration);
      if (entry.pronunciation) parts.push(entry.pronunciation);
      metaEl.textContent = parts.join(' — ');
      container.appendChild(metaEl);
    }

    // Short definition
    if (entry.short_definition) {
      const shortEl = document.createElement('div');
      shortEl.className = 'dict-entry-short';
      shortEl.textContent = entry.short_definition;
      container.appendChild(shortEl);
    }

    if (lookupContext?.morphCode) {
      const morphologyAnchor = document.createElement('div');
      container.appendChild(morphologyAnchor);
      loadMorphologyDetails(morphologyAnchor, moduleId, lookupContext);
    }

    // Full definition
    if (entry.definition) {
      const defEl = document.createElement('div');
      defEl.className = 'dict-entry-definition';

      // BDB-T has proper HTML (<ol>, <p class=...>) — render directly
      // Strong-PT has flat text — use formatDefinition parser
      if (hasStructuredHtml(entry.definition)) {
        // Strip redundant prefix (Original/Transliteration/Phonetic) already shown in fields above
        let html = entry.definition;
        const contentStart = html.search(/<(?:p\s+class|ol[\s>])/i);
        if (contentStart > 0) html = html.substring(contentStart);
        defEl.innerHTML = sanitizeHtml(html);
      } else {
        defEl.innerHTML = sanitizeHtml(formatDefinition(entry.definition));
      }

      bindBibleRefs(defEl);
      bindStrongsCrossRefs(defEl);
      bindDictionaryTopicLinks(defEl, moduleId);
      container.appendChild(defEl);
    }

    // Cognates (async, appended after load)
    loadCognates(container, moduleId, entry.topic);
  }

  async function renderMorphologyDetails(
    moduleId: string,
    lookupContext: NormalizedLookupContext
  ): Promise<HTMLElement | null> {
    const morphCode = lookupContext?.morphCode;
    if (!morphCode) return null;

    let resolved: MorphologyResult | null = null;
    try {
      resolved = await window.api.resolveMorphology({
        sourceModuleId: lookupContext.sourceModuleId || null,
        strongDictModuleId: moduleId,
        morphCode,
        uiLanguage: I18n.getCurrentLang(),
      });
    } catch (err) {
      console.warn('Failed to resolve morphology:', err);
    }

    const wrap = document.createElement('div');
    wrap.className = 'dict-morphology-section';

    const label = document.createElement('div');
    label.className = 'dict-morphology-label';
    label.textContent = I18n.t('dictMorphology');
    wrap.appendChild(label);

    const codeRow = document.createElement('div');
    codeRow.className = 'dict-morphology-row';
    codeRow.innerHTML =
      '<span class="dict-morphology-key">' +
      Utils.escapeHtml(I18n.t('dictMorphCode')) +
      ':</span> ' +
      '<span class="dict-morphology-value">' +
      Utils.escapeHtml(morphCode) +
      '</span>';
    wrap.appendChild(codeRow);

    if (lookupContext.lemma) {
      const lemmaRow = document.createElement('div');
      lemmaRow.className = 'dict-morphology-row';
      lemmaRow.innerHTML =
        '<span class="dict-morphology-key">' +
        Utils.escapeHtml(I18n.t('dictMorphLemma')) +
        ':</span> ' +
        '<span class="dict-morphology-value">' +
        Utils.escapeHtml(lookupContext.lemma) +
        '</span>';
      wrap.appendChild(lemmaRow);
    }

    const meaning = resolved?.displayText || morphCode;
    const meaningRow = document.createElement('div');
    meaningRow.className = 'dict-morphology-row';
    meaningRow.innerHTML =
      '<span class="dict-morphology-key">' +
      Utils.escapeHtml(I18n.t('dictMorphMeaning')) +
      ':</span> ' +
      '<span class="dict-morphology-value">' +
      Utils.escapeHtml(meaning) +
      '</span>';
    wrap.appendChild(meaningRow);

    if (resolved?.topicRef) {
      const topicRow = document.createElement('div');
      topicRow.className = 'dict-morphology-row';
      const key = document.createElement('span');
      key.className = 'dict-morphology-key';
      key.textContent = I18n.t('dictionary') + ':';
      const link = document.createElement('a');
      link.className = 'dict-crossref';
      link.textContent = resolved.topicRef;
      link.addEventListener('click', (e) => {
        e.preventDefault();
        ensureCurrentInHistory();
        lookupWord(resolved.topicRef, moduleId);
      });
      topicRow.append(key, document.createTextNode(' '), link);
      wrap.appendChild(topicRow);
    }

    return wrap;
  }

  async function loadMorphologyDetails(
    container: HTMLElement,
    moduleId: string,
    lookupContext: NormalizedLookupContext | null
  ): Promise<void> {
    if (!lookupContext?.morphCode) return;
    try {
      const section = await renderMorphologyDetails(moduleId, lookupContext);
      if (section) {
        container.replaceWith(section);
      } else if (container.parentNode) {
        container.remove();
      }
    } catch (err) {
      if (container.parentNode) container.remove();
      console.warn('Failed to render morphology details:', err);
    }
  }

  function renderWordEntry(container: HTMLElement, moduleId: string, entry: DictionaryEntry): void {
    // Word dictionaries (Almeida): just topic + definition
    if (entry.definition) {
      const defEl = document.createElement('div');
      defEl.className = 'dict-entry-definition';
      defEl.innerHTML = sanitizeHtml(entry.definition);
      bindBibleRefs(defEl);
      bindVCrossRefs(defEl);
      bindStrongsCrossRefs(defEl);
      bindDictionaryTopicLinks(defEl, moduleId);
      container.appendChild(defEl);
    }
  }

  /** Detect whether a definition string contains structured HTML (BDB-T style) */
  function hasStructuredHtml(html: string): boolean {
    return /<ol[\s>]|<p\s+class\s*=\s*"/i.test(html);
  }

  // --- Cognates ---

  async function loadCognates(
    container: HTMLElement,
    moduleId: string,
    topic: string
  ): Promise<void> {
    try {
      const cognates = await window.api.getDictionaryCognates(moduleId, topic);
      if (cognates.length === 0) return;

      const section = document.createElement('div');
      section.className = 'dict-cognates-section';

      const label = document.createElement('div');
      label.className = 'dict-cognates-label';
      label.textContent = I18n.t('dictCognates');
      section.appendChild(label);

      for (const cog of cognates) {
        const tag = document.createElement('span');
        tag.className = 'dict-cognate-tag';
        tag.textContent = cog;
        tag.addEventListener('click', () => lookup(cog));
        section.appendChild(tag);
      }

      container.appendChild(section);
    } catch (err) {
      console.warn('Failed to load cognates:', err);
    }
  }

  // --- Link binding ---

  // --- Strong-PT definition formatter (unchanged logic) ---

  // --- Utilities ---

  const { sanitizeHtml } = Sanitize;

  function getErrorMessage(error: Error | string | object | null | undefined): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    if (error && 'message' in error) return String(error.message);
    return String(error || '');
  }

  function setStateChangeListener(listener: StateChangeListener | null): void {
    onStateChange = typeof listener === 'function' ? listener : null;
  }

  function emitStateChange(): void {
    if (!onStateChange) return;
    onStateChange(getState());
  }

  function getState(): DictPanelSnapshot {
    return {
      selectedModuleId: selectedModuleId || null,
      moduleSearchCache: Object.fromEntries(moduleSearchCache),
    };
  }

  return { init, lookup, lookupWord, setModules, setStateChangeListener, getState };
})();

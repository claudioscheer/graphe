/**
 * dict-panel.js — Dictionary panel for Strong's number and word lookups
 */
const DictPanel = (() => {
  let dictModules = [];
  let selectedModuleId = null;
  const moduleSearchCache = new Map();
  let currentLookup = null;
  let onStateChange = null;
  let autocompleteTimer = null;
  let activeAutocompleteIdx = -1;

  // Navigation history
  const STRONG_HISTORY_KEY = '__strong__';
  const historyByKey = new Map();
  let navBackBtn, navForwardBtn;
  let dictHeightRatio = null;
  let resizeBound = false;
  let bibleRefMatcher = null;
  let bibleRefMatcherLang = null;

  // DOM refs
  let panel, contentEl, searchInput, autocompleteEl, dictClearBtn, moduleSelect, dictPickerInstance;

  function init(modules, savedState) {
    dictModules = modules;
    moduleSearchCache.clear();
    if (savedState && savedState.moduleSearchCache && typeof savedState.moduleSearchCache === 'object') {
      for (const [moduleId, topic] of Object.entries(savedState.moduleSearchCache)) {
        if (typeof topic === 'string' && topic.trim()) moduleSearchCache.set(moduleId, topic);
      }
    }
    selectedModuleId = resolveSelectedModuleId(savedState?.selectedModuleId);
    if (savedState && Number.isFinite(savedState.dictHeightRatio)) {
      dictHeightRatio = Math.min(0.9, Math.max(0.1, Number(savedState.dictHeightRatio)));
    }
    buildDOM(savedState);
    restoreSelectedModuleSearch();
    emitStateChange();
  }

  function resolveSelectedModuleId(candidate) {
    if (candidate && dictModules.some((m) => m.id === candidate)) return candidate;
    return dictModules[0]?.id || null;
  }

  function getModuleById(moduleId) {
    return dictModules.find((m) => m.id === moduleId) || null;
  }

  function getModuleLabel(moduleId) {
    const mod = getModuleById(moduleId);
    if (!mod) return moduleId || '';
    return Utils.getModuleDisplayName(mod);
  }

  function buildDOM(savedState) {
    const sidebar = SearchPanel.getSidebar();
    if (!sidebar) return;

    // Vertical split divider between search and dict
    const divider = document.createElement('div');
    divider.className = 'split-divider split-divider-v';
    setupVerticalDivider(divider);

    // Dict panel
    panel = document.createElement('div');
    panel.id = 'dict-panel';
    const savedHeight = resolveInitialHeight(sidebar);
    if (savedHeight) {
      panel.style.flex = 'none';
      panel.style.height = savedHeight + 'px';
    }

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
      onChange: (moduleId) => {
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

    sidebar.appendChild(divider);
    sidebar.appendChild(panel);
    setupResizeSync();

    // Close autocomplete when clicking outside
    document.addEventListener('click', (e) => {
      if (!searchWrapper.contains(e.target)) hideAutocomplete();
    });
  }

  function setupVerticalDivider(divider) {
    divider.addEventListener('mousedown', (e) => {
      e.preventDefault();
      divider.classList.add('dragging');
      const startY = e.clientY;
      const sidebar = SearchPanel.getSidebar();
      if (!sidebar) return;
      const startDictH = panel.offsetHeight;

      const onMove = (e2) => {
        const delta = e2.clientY - startY;
        const sidebarH = Math.max(1, sidebar.clientHeight || 1);
        const minDictH = 80;
        const maxDictH = Math.max(minDictH, sidebarH - 100);
        const newDictH = Math.min(maxDictH, Math.max(minDictH, startDictH - delta));
        panel.style.flex = 'none';
        panel.style.height = newDictH + 'px';
        dictHeightRatio = Math.min(0.9, Math.max(0.1, newDictH / sidebarH));
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

  function resolveInitialHeight(sidebar) {
    if (!Number.isFinite(dictHeightRatio)) return null;
    const sidebarHeight = Math.max(1, sidebar?.clientHeight || 1);
    const minDictH = 80;
    const maxDictH = Math.max(minDictH, sidebarHeight - 100);
    return Math.min(maxDictH, Math.max(minDictH, Math.round(sidebarHeight * dictHeightRatio)));
  }

  function setupResizeSync() {
    if (resizeBound) return;
    resizeBound = true;
    window.addEventListener('resize', () => {
      if (!panel || !Number.isFinite(dictHeightRatio)) return;
      const sidebar = SearchPanel.getSidebar();
      if (!sidebar) return;
      const nextHeight = resolveInitialHeight(sidebar);
      if (!nextHeight) return;
      panel.style.flex = 'none';
      panel.style.height = nextHeight + 'px';
    });
  }

  // --- Autocomplete for word-keyed dictionaries ---

  function onSearchInput() {
    const val = searchInput.value.trim();
    clearTimeout(autocompleteTimer);

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

  function onSearchKeydown(e) {
    if (autocompleteEl.style.display === 'none') {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = searchInput.value.trim();
        if (!val) return;
        lookupWord(val);
      }
      return;
    }

    const items = autocompleteEl.querySelectorAll('.dict-autocomplete-item');
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

  function showAutocomplete(results, moduleId) {
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

  function hideAutocomplete() {
    autocompleteEl.style.display = 'none';
    activeAutocompleteIdx = -1;
  }

  function updateAutocompleteActive(items) {
    for (let i = 0; i < items.length; i++) {
      items[i].classList.toggle('active', i === activeAutocompleteIdx);
    }
  }

  // --- Module header helper ---

  function createModuleHeader(moduleId) {
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

  function persistCurrentModuleSearch(moduleId) {
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

  function restoreSelectedModuleSearch() {
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
    lookupWord(cachedTopic, moduleId, true);
  }

  async function openDictionaryInfoModal() {
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

    const closeModal = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKeyDown);
    };

    const onKeyDown = (e) => {
      if (e.key === 'Escape') closeModal();
    };

    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) closeModal();
    });
    document.addEventListener('keydown', onKeyDown);

    const sectionTitles = body.querySelectorAll('.dict-info-section-title');
    const usageEl = body.querySelector('.dict-info-usage');
    const countEl = body.querySelector('.dict-info-count');
    const randomEl = body.querySelector('.dict-info-random');
    const browseInput = body.querySelector('.dict-info-browse-input');
    const browseList = body.querySelector('.dict-info-browse-list');
    const prevBtn = body.querySelector('.dict-info-page-btn.prev');
    const nextBtn = body.querySelector('.dict-info-page-btn.next');

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

    const renderPage = async () => {
      const prefix = (browseInput.value || '').trim();
      const topics = await window.api.getDictionaryTopicsByPrefix(moduleId, prefix, PAGE_SIZE, offset);
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
      countEl.textContent = String(err?.message || err || '');
      browseList.textContent = '';
    }
  }

  // --- Navigation history ---

  function getHistoryKey(entry) {
    if (!entry || entry.type === 'strong') return STRONG_HISTORY_KEY;
    return entry.moduleId || selectedModuleId || resolveSelectedModuleId(null) || STRONG_HISTORY_KEY;
  }

  function getHistoryState(key) {
    const resolvedKey = key || selectedModuleId || resolveSelectedModuleId(null) || STRONG_HISTORY_KEY;
    let state = historyByKey.get(resolvedKey);
    if (!state) {
      state = { entries: [], idx: -1 };
      historyByKey.set(resolvedKey, state);
    }
    return state;
  }

  function getActiveHistoryKey() {
    if (currentLookup?.type === 'strong') return STRONG_HISTORY_KEY;
    return selectedModuleId || currentLookup?.moduleId || resolveSelectedModuleId(null) || STRONG_HISTORY_KEY;
  }

  function pushHistory(entry) {
    const key = getHistoryKey(entry);
    const state = getHistoryState(key);
    const prev = state.entries[state.idx];
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
    state.entries.splice(state.idx + 1);
    state.entries.push(entry);
    state.idx = state.entries.length - 1;
    updateNavButtons();
  }

  function updateNavButtons() {
    const key = getActiveHistoryKey();
    const state = getHistoryState(key);
    if (navBackBtn) navBackBtn.disabled = state.idx <= 0;
    if (navForwardBtn) navForwardBtn.disabled = state.idx >= state.entries.length - 1;
  }

  function navBack() {
    const key = getActiveHistoryKey();
    const state = getHistoryState(key);
    if (state.idx <= 0) return;
    state.idx--;
    replayHistory();
  }

  function navForward() {
    const key = getActiveHistoryKey();
    const state = getHistoryState(key);
    if (state.idx >= state.entries.length - 1) return;
    state.idx++;
    replayHistory();
  }

  function replayHistory() {
    const key = getActiveHistoryKey();
    const state = getHistoryState(key);
    updateNavButtons();
    const entry = state.entries[state.idx];
    if (!entry) return;
    if (entry.type === 'strong') {
      lookup(entry.topic, true, entry.context || null);
    } else {
      lookupWord(entry.topic, entry.moduleId, true);
    }
  }

  function ensureCurrentInHistory() {
    if (!currentLookup) return;
    const key = getHistoryKey(currentLookup);
    const state = getHistoryState(key);
    if (state.idx >= 0 && state.entries.length > 0) return;
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

  function isPseudoStrongsNumber(strongsNumber) {
    const match = String(strongsNumber || '')
      .trim()
      .match(/^([HG])(\d+)(\w*)$/i);
    if (!match) return false;
    return Number.parseInt(match[2], 10) >= 9000;
  }

  function normalizeLookupContext(lookupContext) {
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

  async function lookup(strongsNumber, skipHistory, lookupContext) {
    if (!panel) return;
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
      const strongsDict = Array.isArray(strongsDictSetting) ? strongsDictSetting[0] : strongsDictSetting;
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
        '<div class="dict-placeholder">' + Utils.escapeHtml(err.message) + '</div>';
    }
  }

  // --- Word lookup (Almeida-style dictionaries) ---

  async function lookupWord(topic, moduleId, skipHistory) {
    if (!panel) return;

    const resolvedModuleId = resolveSelectedModuleId(moduleId || selectedModuleId);
    if (!resolvedModuleId) {
      contentEl.innerHTML =
        '<div class="dict-placeholder">' + Utils.escapeHtml(I18n.t('dictNoModulesInstalled')) + '</div>';
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
      renderModuleEntry(section, resolvedModuleId, entry);
      contentEl.appendChild(section);
      emitStateChange();
    } catch (err) {
      contentEl.innerHTML =
        '<div class="dict-placeholder">' + Utils.escapeHtml(err.message) + '</div>';
    }
  }

  // --- Per-module rendering dispatch ---

  function renderModuleEntry(container, moduleId, entry, lookupContext) {
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

  function renderStrongEntry(container, moduleId, entry, lookupContext) {
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
      const parts = [];
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

  async function renderMorphologyDetails(moduleId, lookupContext) {
    const morphCode = lookupContext?.morphCode;
    if (!morphCode) return null;

    let resolved = null;
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
        lookupWord(resolved.topicRef, moduleId);
      });
      topicRow.append(key, document.createTextNode(' '), link);
      wrap.appendChild(topicRow);
    }

    return wrap;
  }

  async function loadMorphologyDetails(container, moduleId, lookupContext) {
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

  function renderWordEntry(container, moduleId, entry) {
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
  function hasStructuredHtml(html) {
    return /<ol[\s>]|<p\s+class\s*=\s*"/i.test(html);
  }

  // --- Cognates ---

  async function loadCognates(container, moduleId, topic) {
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

  function bindStrongsCrossRefs(container) {
    // Mark TWOT refs as non-navigable.
    const twotLinks = container.querySelectorAll('a.T, a[class="T"]');
    for (const link of twotLinks) {
      link.removeAttribute('href');
      link.classList.add('dict-twot-ref');
    }
  }

  function isExternalHref(href) {
    return /^(https?:|mailto:|tel:)/i.test(String(href || '').trim());
  }

  function normalizeTopicCandidate(raw) {
    if (raw == null) return '';
    let value = String(raw).trim();
    try {
      value = decodeURIComponent(value);
    } catch (_) {}
    if (!value) return '';

    if (value.startsWith('#') && !/^#b/i.test(value)) {
      value = value.slice(1);
    }

    value = value.split('#')[0];
    value = value.split('?')[0];

    // Common dictionary-link prefixes from some source formats:
    // dWORD, d:WORD, d-WORD -> WORD
    const dPrefixed = value.match(/^d(?:[:\-\s]+)?(.+)$/i);
    if (dPrefixed && dPrefixed[1]) {
      value = dPrefixed[1].trim();
    }

    return value.trim();
  }

  async function resolveTopicInModule(moduleId, candidate) {
    const topic = normalizeTopicCandidate(candidate);
    if (!moduleId || !topic) return null;

    try {
      const exact = await window.api.getDictionaryEntry(moduleId, topic);
      if (exact) return topic;
    } catch (_) {}

    try {
      const results = await window.api.searchDictionaryTopics(moduleId, topic, 20);
      if (!Array.isArray(results) || results.length === 0) return null;
      const lower = topic.toLowerCase();
      const exactCI = results.find((t) => String(t).toLowerCase() === lower);
      return exactCI || results[0];
    } catch (_) {
      return null;
    }
  }

  function bindDictionaryTopicLinks(container, moduleId) {
    function bindRedirect(link, hrefCandidate) {
      if (link.dataset.dictRedirectBound === '1') return;
      link.dataset.dictRedirectBound = '1';
      link.classList.add('dict-crossref');
      link.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const hrefTopic = normalizeTopicCandidate(hrefCandidate || '');
        const textTopic = normalizeTopicCandidate(link.textContent || '');

        let target = await resolveTopicInModule(moduleId, hrefTopic);
        if (!target && textTopic && textTopic.toLowerCase() !== hrefTopic.toLowerCase()) {
          target = await resolveTopicInModule(moduleId, textTopic);
        }
        if (!target) target = textTopic || hrefTopic;
        if (!target) return;

        ensureCurrentInHistory();
        lookupWord(target, moduleId, false);
      });
    }

    const allLinks = container.querySelectorAll('a');
    for (const link of allLinks) {
      if (link.classList.contains('dict-bible-ref')) continue;
      if (link.classList.contains('dict-twot-ref')) continue;
      const href = (link.getAttribute('href') || '').trim();

      if (isExternalHref(href)) {
        if (link.dataset.dictRedirectBound === '1') continue;
        link.dataset.dictRedirectBound = '1';
        link.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          window.api.openExternal(href);
        });
        continue;
      }

      if (/^s:/i.test(href) || /^b:/i.test(href) || /^#b/i.test(href)) {
        if (/^b:/i.test(href) || /^#b/i.test(href)) continue;
      }

      if (href) link.removeAttribute('href');
      bindRedirect(link, href);
    }
  }

  function bindBibleRefs(container) {
    linkifyPlainTextBibleRefs(container);

    const links = container.querySelectorAll('a');
    for (const link of links) {
      if (link.dataset.bibleRefBound === '1') continue;
      const href = (link.getAttribute('href') || '').trim();
      let parsedRef = null;
      if (link.dataset.bookNumber && link.dataset.chapter) {
        parsedRef = {
          bookNumber: parseInt(link.dataset.bookNumber, 10),
          chapter: parseInt(link.dataset.chapter, 10),
          verse: link.dataset.verse ? parseInt(link.dataset.verse, 10) : 1,
        };
      }
      if (!parsedRef) parsedRef = parseBibleRef(href);
      if (!parsedRef) {
        parsedRef = parseBibleRefFromText(link.textContent || '');
      }
      if (!parsedRef) continue;

      link.removeAttribute('href');
      link.classList.add('dict-bible-ref');

      const { bookNumber, chapter, verse } = parsedRef;
      link.dataset.bibleRefBound = '1';
      link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const paneId = PaneManager.getActivePaneId();
        const target = PaneManager.getNavigationTarget(paneId);
        PaneManager.navigatePane(target, bookNumber, chapter, verse)
          .then((ok) => {
            if (!ok) showTooltip(target, I18n.t('refUnavailable'));
          })
          .catch((err) => console.warn('Bible ref navigation failed:', err));
      });
    }
  }

  function linkifyPlainTextBibleRefs(container) {
    const matcher = getBibleRefMatcher();
    if (!matcher) return;

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    let lastRefContext = null;
    for (const node of textNodes) {
      if (!node.parentNode) continue;
      const refAncestor = node.parentElement && node.parentElement.closest('a');
      if (refAncestor) {
        const href = (refAncestor.getAttribute('href') || '').trim();
        const parsed = parseBibleRef(href) || parseBibleRefFromText(refAncestor.textContent || '');
        if (parsed) lastRefContext = { bookNum: parsed.bookNumber, chapter: parsed.chapter };
        continue;
      }

      const text = node.textContent || '';
      let matches = matcher.findMatches(text);
      if (matches.length === 0 && lastRefContext) {
        matches = matcher.findContinuations(text, lastRefContext);
      }
      if (matches.length === 0) continue;

      const frag = document.createDocumentFragment();
      let lastIdx = 0;
      for (const match of matches) {
        if (match.index > lastIdx) {
          frag.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
        }
        const link = document.createElement('a');
        link.className = 'dict-bible-ref';
        link.dataset.bookNumber = String(match.bookNum);
        link.dataset.chapter = String(match.chapter);
        if (Number.isFinite(match.verseFrom)) link.dataset.verse = String(match.verseFrom);
        link.textContent = match.raw;
        frag.appendChild(link);
        lastIdx = match.endIndex;
      }
      if (lastIdx > 0) {
        if (lastIdx < text.length) frag.appendChild(document.createTextNode(text.slice(lastIdx)));
        node.parentNode.replaceChild(frag, node);
        const last = matches[matches.length - 1];
        if (last && Number.isFinite(last.bookNum) && Number.isFinite(last.chapter)) {
          lastRefContext = { bookNum: last.bookNum, chapter: last.chapter };
        }
      }
    }
  }

  function getBibleRefMatcher() {
    const lang = I18n.getCurrentLang();
    if (bibleRefMatcher && bibleRefMatcherLang === lang) return bibleRefMatcher;
    const parserApi = globalThis.CommentaryRefParser;
    if (!parserApi || typeof parserApi.buildReferenceMatcher !== 'function') return null;
    bibleRefMatcher = parserApi.buildReferenceMatcher(I18n._bookNames, I18n._BOOK_NUMBERS);
    bibleRefMatcherLang = lang;
    return bibleRefMatcher;
  }

  function parseBibleRefFromText(rawText) {
    const text = String(rawText || '')
      .replace(/[\u200E\u200F\u202A-\u202E]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return null;

    const matcher = getBibleRefMatcher();
    if (!matcher) return null;
    const matches = matcher.findMatches(text);
    if (!Array.isArray(matches) || matches.length === 0) return null;
    const m = matches[0];
    if (!m || !Number.isFinite(m.bookNum) || !Number.isFinite(m.chapter)) return null;
    const verse = Number.isFinite(m.verseFrom) ? m.verseFrom : 1;
    return {
      bookNumber: m.bookNum,
      chapter: m.chapter,
      verse,
    };
  }

  function parseBibleRef(rawHref) {
    if (!rawHref) return null;
    const decoded = decodeURIComponent(rawHref.trim());
    // Supports:
    // B:50 7:7
    // b:50 7:7-8 (verse ranges -> navigate to first verse)
    let match = decoded.match(/^B:(\d+)\s+(\d+):(\d+)/i);
    if (match) {
      return {
        bookNumber: parseInt(match[1], 10),
        chapter: parseInt(match[2], 10),
        verse: parseInt(match[3], 10),
      };
    }

    // MySword-style hash refs from some converted dictionaries, e.g. #b1.10.16
    // Here book is canonical 1..66 and must be mapped to Graphe/MyBible book_number.
    match = decoded.match(/^#b(\d+)\.(\d+)\.(\d+)/i);
    if (!match) return null;
    const canonicalBook = parseInt(match[1], 10);
    const mappedBook = mapCanonicalBookToGraphe(canonicalBook);
    if (!mappedBook) return null;
    return {
      bookNumber: mappedBook,
      chapter: parseInt(match[2], 10),
      verse: parseInt(match[3], 10),
    };
  }

  function mapCanonicalBookToGraphe(bookIndex) {
    const grapheBookNumbers = [
      10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 190, 220, 230, 240, 250,
      260, 290, 300, 310, 330, 340, 350, 360, 370, 380, 390, 400, 410, 420, 430, 440, 450, 460, 470,
      480, 490, 500, 510, 520, 530, 540, 550, 560, 570, 580, 590, 600, 610, 620, 630, 640, 650, 660,
      670, 680, 690, 700, 710, 720, 730,
    ];
    if (!Number.isInteger(bookIndex) || bookIndex < 1 || bookIndex > grapheBookNumbers.length) {
      return null;
    }
    return grapheBookNumbers[bookIndex - 1];
  }

  function bindVCrossRefs(container) {
    // Find "V. TOPIC" patterns in text nodes and make them clickable
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const replacements = [];
    let node;
    while ((node = walker.nextNode())) {
      if (/V\.\s+[A-ZÀ-Ú]/.test(node.textContent)) {
        replacements.push(node);
      }
    }

    for (const textNode of replacements) {
      const frag = document.createDocumentFragment();
      const text = textNode.textContent;
      // Match "V. WORD" or "V. WORD WORD" (uppercase words after V.)
      const regex = /V\.\s+([A-ZÀ-Ú][A-ZÀ-Ú\s,]*[A-ZÀ-Ú])/g;
      let lastIdx = 0;
      let m;
      while ((m = regex.exec(text)) !== null) {
        // Text before the match
        if (m.index > lastIdx) {
          frag.appendChild(document.createTextNode(text.substring(lastIdx, m.index)));
        }
        // Create clickable cross-ref
        const span = document.createElement('span');
        span.className = 'dict-vcrossref';
        span.textContent = m[0];
        const topic = m[1].trim();
        span.addEventListener('click', () => lookupWord(topic));
        frag.appendChild(span);
        lastIdx = m.index + m[0].length;
      }
      if (lastIdx < text.length) {
        frag.appendChild(document.createTextNode(text.substring(lastIdx)));
      }
      if (lastIdx > 0) {
        textNode.parentNode.replaceChild(frag, textNode);
      }
    }
  }

  // --- Strong-PT definition formatter (unchanged logic) ---

  /**
   * Parses a raw definition string into structured HTML.
   * Strips leading <b>lexeme</b><p/>, extracts etymology/grammar preamble,
   * and converts numbered items (1, 1a, 1a1, 2, etc.) into nested lists.
   */
  function formatDefinition(html) {
    // Strip leading <b>...</b> and <p/> (redundant with lexeme field)
    let text = html.replace(/^\s*<b>[^<]*<\/b>\s*<p\s*\/?>\s*/i, '');

    // Preserve <a> tags by replacing them with placeholders
    const anchors = [];
    text = text.replace(/<a\b[^>]*>.*?<\/a>/gi, (match) => {
      anchors.push(match);
      return `\x00LINK${anchors.length - 1}\x00`;
    });

    // Restore anchor placeholders
    function restoreAnchors(s) {
      return s.replace(/\x00LINK(\d+)\x00/g, (_, idx) => anchors[parseInt(idx)]);
    }

    const defStartRegex = /(?:^|\s)(1)\s+([a-z])/;
    const defStartMatch = defStartRegex.exec(text);

    if (!defStartMatch) {
      return '<div class="dict-def-preamble">' + restoreAnchors(text.trim()) + '</div>';
    }

    const preamble = text.substring(0, defStartMatch.index).trim();
    const defText = text.substring(defStartMatch.index).trim();

    const itemRegex = /(?:^|\s)(\d+[a-z]?\d?)\s+(?=[a-z\x00])/g;
    const rawIndices = [];
    let match;

    while ((match = itemRegex.exec(defText)) !== null) {
      rawIndices.push({
        label: match[1],
        start: match.index,
        contentStart: match.index + match[0].length - 1,
      });
    }

    const indices = [];
    let lastTopNum = 0;

    for (const idx of rawIndices) {
      const topNum = parseInt(idx.label);
      const level = getLevel(idx.label);

      if (level === 0) {
        if (topNum <= lastTopNum + 1) {
          indices.push(idx);
          lastTopNum = topNum;
        }
      } else {
        if (topNum === lastTopNum) {
          indices.push(idx);
        }
      }
    }

    const items = [];
    for (let i = 0; i < indices.length; i++) {
      const end = i + 1 < indices.length ? indices[i + 1].start : defText.length;
      items.push({
        label: indices[i].label,
        text: defText.substring(indices[i].contentStart, end).trim(),
      });
    }

    let out = '';

    if (preamble) {
      out += '<div class="dict-def-preamble">' + restoreAnchors(preamble) + '</div>';
    }

    if (items.length > 0) {
      out += buildNestedList(items, restoreAnchors);
    }

    return out;
  }

  function buildNestedList(items, restoreAnchors) {
    let html = '<ol class="dict-def-list">';
    let i = 0;

    while (i < items.length) {
      const item = items[i];
      const level = getLevel(item.label);

      if (level === 0) {
        html +=
          '<li><span class="dict-def-label">' + item.label + '</span> ' + restoreAnchors(item.text);

        const subItems = [];
        let j = i + 1;
        while (j < items.length && getLevel(items[j].label) > 0) {
          subItems.push(items[j]);
          j++;
        }

        if (subItems.length > 0) {
          html += buildSubList(subItems, restoreAnchors);
        }

        html += '</li>';
        i = j;
      } else {
        html +=
          '<li><span class="dict-def-label">' +
          item.label +
          '</span> ' +
          restoreAnchors(item.text) +
          '</li>';
        i++;
      }
    }

    html += '</ol>';
    return html;
  }

  function buildSubList(items, restoreAnchors) {
    let html = '<ol class="dict-def-sublist">';
    let i = 0;

    while (i < items.length) {
      const item = items[i];
      html +=
        '<li><span class="dict-def-label">' + item.label + '</span> ' + restoreAnchors(item.text);

      const deepItems = [];
      let j = i + 1;
      while (j < items.length && getLevel(items[j].label) > getLevel(item.label)) {
        deepItems.push(items[j]);
        j++;
      }

      if (deepItems.length > 0) {
        html += '<ol class="dict-def-sublist">';
        for (const di of deepItems) {
          html +=
            '<li><span class="dict-def-label">' +
            di.label +
            '</span> ' +
            restoreAnchors(di.text) +
            '</li>';
        }
        html += '</ol>';
      }

      html += '</li>';
      i = j > i + 1 ? j : i + 1;
    }

    html += '</ol>';
    return html;
  }

  function getLevel(label) {
    if (/^\d+[a-z]\d+$/.test(label)) return 2;
    if (/^\d+[a-z]$/.test(label)) return 1;
    return 0;
  }

  // --- Utilities ---

  const { sanitizeHtml, isSafeUrl } = Sanitize;

  function setStateChangeListener(listener) {
    onStateChange = typeof listener === 'function' ? listener : null;
  }

  function emitStateChange() {
    if (!onStateChange) return;
    onStateChange(getState());
  }

  function getState() {
    const sidebar = SearchPanel.getSidebar();
    const sidebarHeight = Math.max(1, sidebar?.clientHeight || 1);
    const dictHeight = panel ? panel.offsetHeight : null;
    dictHeightRatio =
      Number.isFinite(dictHeight) && dictHeight > 0
        ? Math.min(0.9, Math.max(0.1, dictHeight / sidebarHeight))
        : dictHeightRatio;
    return {
      dictHeightRatio,
      selectedModuleId: selectedModuleId || null,
      moduleSearchCache: Object.fromEntries(moduleSearchCache),
    };
  }

  return { init, lookup, lookupWord, setStateChangeListener, getState };
})();

/**
 * dict-panel.js — Dictionary panel for Strong's number and word lookups
 */
const DictPanel = (() => {
  let dictModules = [];
  let onStateChange = null;
  let autocompleteTimer = null;
  let activeAutocompleteIdx = -1;

  // Navigation history
  let history = [];
  let historyIdx = -1;
  let navBackBtn, navForwardBtn;
  let dictHeightRatio = null;
  let resizeBound = false;

  // DOM refs
  let panel, contentEl, searchInput, autocompleteEl, dictClearBtn;

  function init(modules, savedState) {
    dictModules = modules;
    if (dictModules.length === 0) return;
    if (savedState && Number.isFinite(savedState.dictHeightRatio)) {
      dictHeightRatio = Math.min(0.9, Math.max(0.1, Number(savedState.dictHeightRatio)));
    }
    buildDOM(savedState);
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
    navGroup.appendChild(navBackBtn);
    navGroup.appendChild(navForwardBtn);
    titleRow.appendChild(navGroup);

    header.appendChild(titleRow);

    // Search input with autocomplete wrapper
    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'dict-search-wrapper mt-2';

    searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className =
      'w-full px-3 py-1.5 pr-7 rounded-md border border-brand-400 dark:border-night-500 bg-brand-50 dark:bg-night-700 text-sm text-brand-900 dark:text-night-50 focus:outline-none focus:ring-2 focus:ring-brand-500';
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

    if (val.length < 2 || dictModules.length === 0) {
      hideAutocomplete();
      return;
    }

    autocompleteTimer = setTimeout(async () => {
      try {
        const promises = dictModules.map((m) =>
          window.api
            .searchDictionaryTopics(m.id, val, 15)
            .then((topics) => topics.map((t) => ({ topic: t, moduleId: m.id })))
            .catch(() => [])
        );
        const allResults = (await Promise.all(promises)).flat();
        if (allResults.length === 0) {
          hideAutocomplete();
          return;
        }
        showAutocomplete(allResults);
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
        if (dictModules.length > 0) {
          lookupWord(val);
        }
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
        if (dictModules.length > 0) {
          lookupWord(val);
        }
      }
    } else if (e.key === 'Escape') {
      hideAutocomplete();
    }
  }

  function showAutocomplete(results) {
    autocompleteEl.innerHTML = '';
    activeAutocompleteIdx = -1;
    const showSource = dictModules.length > 1;
    for (const { topic, moduleId } of results) {
      const item = document.createElement('div');
      item.className = 'dict-autocomplete-item';
      const label = document.createElement('span');
      label.textContent = topic;
      item.appendChild(label);
      if (showSource) {
        const badge = document.createElement('span');
        badge.className = 'dict-source-tag';
        badge.textContent = moduleId;
        item.appendChild(badge);
      }
      item.addEventListener('click', () => {
        searchInput.value = topic;
        hideAutocomplete();
        lookupWord(topic);
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
    const mod = dictModules.find((m) => m.id === moduleId);
    const header = document.createElement('div');
    header.className = 'dict-module-header';

    const idSpan = document.createElement('span');
    idSpan.textContent = moduleId;
    header.appendChild(idSpan);

    if (mod && mod.description && mod.description !== moduleId) {
      const tag = document.createElement('span');
      tag.className = 'dict-module-desc';
      tag.textContent = mod.description;
      header.appendChild(tag);
    }

    return header;
  }

  // --- Navigation history ---

  function pushHistory(entry) {
    const prev = history[historyIdx];
    if (
      prev &&
      prev.type === entry.type &&
      prev.topic === entry.topic &&
      prev.moduleId === entry.moduleId
    )
      return;
    history.splice(historyIdx + 1);
    history.push(entry);
    historyIdx = history.length - 1;
    updateNavButtons();
  }

  function updateNavButtons() {
    if (navBackBtn) navBackBtn.disabled = historyIdx <= 0;
    if (navForwardBtn) navForwardBtn.disabled = historyIdx >= history.length - 1;
  }

  function navBack() {
    if (historyIdx <= 0) return;
    historyIdx--;
    replayHistory();
  }

  function navForward() {
    if (historyIdx >= history.length - 1) return;
    historyIdx++;
    replayHistory();
  }

  function replayHistory() {
    updateNavButtons();
    const entry = history[historyIdx];
    if (entry.type === 'strong') {
      lookup(entry.topic, true);
    } else {
      lookupWord(entry.topic, entry.moduleId, true);
    }
  }

  // --- Strong's lookup (multi-dictionary) ---

  async function lookup(strongsNumber, skipHistory) {
    if (!panel || dictModules.length === 0) return;

    searchInput.value = strongsNumber;
    if (dictClearBtn) dictClearBtn.style.display = strongsNumber ? '' : 'none';
    hideAutocomplete();
    contentEl.innerHTML = '';

    if (!skipHistory) pushHistory({ type: 'strong', topic: strongsNumber });

    try {
      const strongsDicts = AppStateStore.getSettings().strongsDicts;
      if (!strongsDicts || strongsDicts.length === 0) {
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
      const results = await window.api.lookupAllStrongDicts(strongsNumber, strongsDicts);
      if (results.length === 0) {
        contentEl.innerHTML =
          '<div class="dict-placeholder">' + Utils.escapeHtml(I18n.t('dictNoEntry')) + '</div>';
        return;
      }

      for (const { moduleId, entry } of results) {
        const section = document.createElement('div');
        section.className = 'dict-module-section';

        section.appendChild(createModuleHeader(moduleId));

        // Render entry based on module type
        renderModuleEntry(section, moduleId, entry);
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

    searchInput.value = topic;
    if (dictClearBtn) dictClearBtn.style.display = topic ? '' : 'none';
    hideAutocomplete();
    contentEl.innerHTML = '';

    if (!skipHistory) pushHistory({ type: 'word', topic, moduleId: moduleId || null });

    try {
      // If a specific module was provided, query only that one
      if (moduleId) {
        const entry = await window.api.getDictionaryEntry(moduleId, topic);
        if (!entry) {
          contentEl.innerHTML =
            '<div class="dict-placeholder">' + Utils.escapeHtml(I18n.t('dictNoEntry')) + '</div>';
          return;
        }
        const section = document.createElement('div');
        section.className = 'dict-module-section';
        section.appendChild(createModuleHeader(moduleId));
        renderModuleEntry(section, moduleId, entry);
        contentEl.appendChild(section);
        return;
      }

      // No specific module — search across all dicts
      if (dictModules.length === 0) return;

      const promises = dictModules.map((m) =>
        window.api
          .getDictionaryEntry(m.id, topic)
          .then((entry) => (entry ? { moduleId: m.id, entry } : null))
          .catch(() => null)
      );
      const results = (await Promise.all(promises)).filter(Boolean);

      if (results.length === 0) {
        contentEl.innerHTML =
          '<div class="dict-placeholder">' + Utils.escapeHtml(I18n.t('dictNoEntry')) + '</div>';
        return;
      }

      for (const { moduleId: modId, entry } of results) {
        const section = document.createElement('div');
        section.className = 'dict-module-section';
        section.appendChild(createModuleHeader(modId));
        renderModuleEntry(section, modId, entry);
        contentEl.appendChild(section);
      }
    } catch (err) {
      contentEl.innerHTML =
        '<div class="dict-placeholder">' + Utils.escapeHtml(err.message) + '</div>';
    }
  }

  // --- Per-module rendering dispatch ---

  function renderModuleEntry(container, moduleId, entry) {
    const mod = dictModules.find((m) => m.id === moduleId);
    const isStrongDict = mod ? mod.isStrongDict : false;

    // Topic heading
    const topicEl = document.createElement('div');
    topicEl.className = 'dict-entry-topic';
    topicEl.textContent = entry.topic;
    container.appendChild(topicEl);

    if (isStrongDict) {
      renderStrongEntry(container, moduleId, entry);
    } else {
      renderWordEntry(container, entry);
    }
  }

  function renderStrongEntry(container, moduleId, entry) {
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

      bindStrongsCrossRefs(defEl);
      container.appendChild(defEl);
    }

    // Cognates (async, appended after load)
    loadCognates(container, moduleId, entry.topic);
  }

  function renderWordEntry(container, entry) {
    // Word dictionaries (Almeida): just topic + definition
    if (entry.definition) {
      const defEl = document.createElement('div');
      defEl.className = 'dict-entry-definition';
      defEl.innerHTML = sanitizeHtml(entry.definition);
      bindBibleRefs(defEl);
      bindVCrossRefs(defEl);
      bindStrongsCrossRefs(defEl);
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
    const links = container.querySelectorAll('a[href^="S:"]');
    for (const link of links) {
      const href = link.getAttribute('href');
      const topic = href.replace(/^S:/, '');
      link.removeAttribute('href');
      link.classList.add('dict-crossref');
      link.dataset.topic = topic;
      link.addEventListener('click', (e) => {
        e.preventDefault();
        lookup(topic);
      });
    }

    // Mark TWOT refs as non-navigable
    const twotLinks = container.querySelectorAll('a.T, a[class="T"]');
    for (const link of twotLinks) {
      link.removeAttribute('href');
      link.classList.add('dict-twot-ref');
    }
  }

  function bindBibleRefs(container) {
    const links = container.querySelectorAll('a[href^="B:"], a[href^="b:"]');
    for (const link of links) {
      const href = link.getAttribute('href');
      const parsedRef = parseBibleRef(href);

      link.removeAttribute('href');
      link.classList.add('dict-bible-ref');
      if (!parsedRef) {
        link.addEventListener('click', (e) => {
          e.preventDefault();
        });
        continue;
      }

      const { bookNumber, chapter, verse } = parsedRef;
      link.addEventListener('click', (e) => {
        e.preventDefault();
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

  function parseBibleRef(rawHref) {
    if (!rawHref) return null;
    const decoded = decodeURIComponent(rawHref.trim());
    // Supports:
    // B:50 7:7
    // b:50 7:7-8 (verse ranges -> navigate to first verse)
    const match = decoded.match(/^B:(\d+)\s+(\d+):(\d+)/i);
    if (!match) return null;
    return {
      bookNumber: parseInt(match[1], 10),
      chapter: parseInt(match[2], 10),
      verse: parseInt(match[3], 10),
    };
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
    };
  }

  return { init, lookup, lookupWord, setStateChangeListener, getState };
})();

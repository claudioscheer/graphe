/**
 * pane-manager.js — Recursive binary split pane system
 *
 * Tree structure:
 *   Node = { type: 'leaf', paneId } | { type: 'split', direction: 'h'|'v', children: [Node, Node], ratio: number }
 */
const PaneManager = (() => {
  let tree = null;
  let panes = {};
  let paneCounter = 0;
  let modules = [];
  let commentaryModules = [];
  let onStateChange = null;
  let activePaneId = null;
  let linkTargetPaneId = null;
  let allBooksCache = null;
  let initialLoadPending = new Set();
  let initialLoadPromise = Promise.resolve();
  let resolveInitialLoad = null;
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  const root = () => document.getElementById('pane-root');

  function init(moduleList, savedState, commentaryModuleList) {
    modules = moduleList;
    commentaryModules = commentaryModuleList || [];

    if (!restoreState(savedState)) {
      if (commentaryModules.length > 0) {
        // Default layout: Bible (65%) + Commentary (35%) side by side
        const biblePaneId = createPaneState({ paneType: 'bible' });
        const commentaryPaneId = createPaneState({
          paneType: 'commentary',
          moduleId: commentaryModules[0].id,
          syncedToPaneId: biblePaneId,
        });
        tree = {
          type: 'split',
          direction: 'h',
          children: [
            { type: 'leaf', paneId: biblePaneId },
            { type: 'leaf', paneId: commentaryPaneId },
          ],
          ratio: 0.65,
        };
        activePaneId = biblePaneId;
      } else {
        const paneId = createPaneState();
        tree = { type: 'leaf', paneId };
        activePaneId = paneId;
      }
    } else {
      // Set first leaf as active
      activePaneId = getFirstLeafId(tree);
    }

    initialLoadPending = new Set(Object.keys(panes));
    initialLoadPromise = new Promise((resolve) => {
      resolveInitialLoad = resolve;
      if (initialLoadPending.size === 0) resolve();
    });

    render();
    emitStateChange();
  }

  function markInitialLoaded(paneId) {
    if (!initialLoadPending.has(paneId)) return;
    initialLoadPending.delete(paneId);
    if (initialLoadPending.size === 0 && resolveInitialLoad) {
      resolveInitialLoad();
      resolveInitialLoad = null;
    }
  }

  function waitForInitialLoad() {
    return initialLoadPromise;
  }

  function createPaneState(initial = {}) {
    const id = initial.id || 'pane-' + ++paneCounter;
    paneCounter = Math.max(paneCounter, parsePaneNumber(id));

    const paneType = initial.paneType || 'bible';
    const windowLabel = allocatePaneLabel(paneType, initial.windowLabel);

    if (paneType === 'commentary') {
      const moduleId = resolveCommentaryModuleId(initial.moduleId);
      panes[id] = {
        id,
        windowLabel,
        paneType: 'commentary',
        moduleId,
        bookNumber: Number.isInteger(initial.bookNumber) ? initial.bookNumber : 10,
        chapter: Number.isInteger(initial.chapter) ? initial.chapter : 1,
        bookShortName: initial.bookShortName || '',
        commentaryBooks: [],
        entries: [],
        syncedToPaneId: initial.syncedToPaneId || null,
      };
    } else {
      const moduleId = resolveModuleId(initial.moduleId);
      const mod = modules.find((m) => m.id === moduleId) || modules[0] || null;

      panes[id] = {
        id,
        windowLabel,
        paneType: 'bible',
        moduleId,
        hasStrongs: mod ? mod.hasStrongs : false,
        strongsPrefix: mod ? (mod.strongsPrefix || null) : null,
        bookNumber: Number.isInteger(initial.bookNumber) ? initial.bookNumber : 10,
        chapter: Number.isInteger(initial.chapter) ? initial.chapter : 1,
        bookShortName: initial.bookShortName || '',
        books: [],
        verses: [],
        navHistory: [],
        navHistoryIdx: -1,
      };
    }

    return id;
  }

  function parsePaneNumber(id) {
    const match = String(id || '').match(/^pane-(\d+)$/);
    return match ? parseInt(match[1], 10) : 0;
  }

  function paneTypeForLabel(paneType) {
    return paneType === 'commentary' ? 'commentary' : 'bible';
  }

  function labelForIndex(index) {
    let n = Math.max(0, index);
    let out = '';
    do {
      out = ALPHABET[n % 26] + out;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return out;
  }

  function normalizeWindowLabel(candidate) {
    if (typeof candidate !== 'string') return null;
    const trimmed = candidate.trim().toUpperCase();
    return /^[A-Z]+$/.test(trimmed) ? trimmed : null;
  }

  function collectUsedWindowLabels(paneType) {
    const targetType = paneTypeForLabel(paneType);
    const used = new Set();
    for (const pane of Object.values(panes)) {
      if (pane.paneType !== targetType) continue;
      const label = normalizeWindowLabel(pane.windowLabel);
      if (label) used.add(label);
    }
    return used;
  }

  function allocatePaneLabel(paneType, preferred) {
    const used = collectUsedWindowLabels(paneType);
    const normalizedPreferred = normalizeWindowLabel(preferred);
    if (normalizedPreferred && !used.has(normalizedPreferred)) return normalizedPreferred;
    let idx = 0;
    while (used.has(labelForIndex(idx))) idx++;
    return labelForIndex(idx);
  }

  function getPaneDisplayLabel(paneId) {
    const pane = panes[paneId];
    if (!pane) return '';
    return normalizeWindowLabel(pane.windowLabel) || paneId.replace('pane-', '');
  }

  function getBiblePaneIdsForSync() {
    return getAllLeafIds(tree).filter((id) => panes[id]?.paneType === 'bible');
  }

  function resolveModuleId(candidate) {
    const bibleModules = modules.filter((m) => m.type === 'bible');
    if (candidate && bibleModules.some((m) => m.id === candidate)) return candidate;
    return bibleModules.length > 0 ? bibleModules[0].id : null;
  }

  function resolveCommentaryModuleId(candidate) {
    if (candidate && commentaryModules.some((m) => m.id === candidate)) return candidate;
    return commentaryModules.length > 0 ? commentaryModules[0].id : null;
  }

  function restoreState(savedState) {
    if (!savedState || typeof savedState !== 'object') return false;
    if (!savedState.tree || !savedState.panes) return false;

    const leafIds = [];
    const restoredTree = sanitizeTree(savedState.tree, leafIds);
    if (!restoredTree || leafIds.length === 0) return false;

    const nextPanes = {};
    let maxCounter = 0;

    for (const paneId of leafIds) {
      const raw = savedState.panes[paneId] || {};
      const paneType = raw.paneType || 'bible';

      if (paneType === 'commentary') {
        const moduleId = resolveCommentaryModuleId(raw.moduleId);
        nextPanes[paneId] = {
          id: paneId,
          windowLabel: normalizeWindowLabel(raw.windowLabel),
          paneType: 'commentary',
          moduleId,
          bookNumber: Number.isInteger(raw.bookNumber) ? raw.bookNumber : 10,
          chapter: Number.isInteger(raw.chapter) ? raw.chapter : 1,
          bookShortName: raw.bookShortName || '',
          commentaryBooks: [],
          entries: [],
          syncedToPaneId: raw.syncedToPaneId || null,
        };
      } else {
        const moduleId = resolveModuleId(raw.moduleId);
        const mod = modules.find((m) => m.id === moduleId) || modules[0] || null;

        nextPanes[paneId] = {
          id: paneId,
          windowLabel: normalizeWindowLabel(raw.windowLabel),
          paneType: 'bible',
          moduleId,
          hasStrongs: mod ? mod.hasStrongs : false,
          strongsPrefix: mod ? (mod.strongsPrefix || null) : null,
          bookNumber: Number.isInteger(raw.bookNumber) ? raw.bookNumber : 10,
          chapter: Number.isInteger(raw.chapter) ? raw.chapter : 1,
          bookShortName: raw.bookShortName || '',
          books: [],
          verses: [],
          navHistory: [],
          navHistoryIdx: -1,
        };
      }

      maxCounter = Math.max(maxCounter, parsePaneNumber(paneId));
    }

    panes = nextPanes;
    ensureWindowLabels();
    tree = restoredTree;
    paneCounter = maxCounter;
    if (savedState.linkTargetPaneId && nextPanes[savedState.linkTargetPaneId]) {
      linkTargetPaneId = savedState.linkTargetPaneId;
    }
    return true;
  }

  function sanitizeTree(node, leafIds) {
    if (!node || typeof node !== 'object') return null;

    if (node.type === 'leaf' && typeof node.paneId === 'string') {
      leafIds.push(node.paneId);
      return { type: 'leaf', paneId: node.paneId };
    }

    if (node.type !== 'split' || !Array.isArray(node.children) || node.children.length !== 2) {
      return null;
    }

    const left = sanitizeTree(node.children[0], leafIds);
    const right = sanitizeTree(node.children[1], leafIds);
    if (!left || !right) return null;

    const direction = node.direction === 'v' ? 'v' : 'h';
    if (!Number.isFinite(node.ratio)) return null;
    const ratio = clampRatio(node.ratio);

    return {
      type: 'split',
      direction,
      children: [left, right],
      ratio,
    };
  }

  function clampRatio(value) {
    const ratio = Number.isFinite(value) ? Number(value) : 0.5;
    return Math.min(0.9, Math.max(0.1, ratio));
  }

  function getPane(paneId) {
    return panes[paneId] || null;
  }

  function setStateChangeListener(listener) {
    onStateChange = typeof listener === 'function' ? listener : null;
  }

  function emitStateChange() {
    if (!onStateChange) return;
    onStateChange(getState());
  }

  function getState() {
    const serializablePanes = {};
    for (const pane of Object.values(panes)) {
      const base = {
        paneType: pane.paneType || 'bible',
        windowLabel: pane.windowLabel || null,
        moduleId: pane.moduleId,
        bookNumber: pane.bookNumber,
        chapter: pane.chapter,
        bookShortName: pane.bookShortName,
      };
      if (pane.paneType === 'commentary') {
        base.syncedToPaneId = pane.syncedToPaneId || null;
      }
      serializablePanes[pane.id] = base;
    }

    return {
      tree: serializeTree(tree),
      panes: serializablePanes,
      linkTargetPaneId,
    };
  }

  function serializeTree(node) {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'leaf') {
      return { type: 'leaf', paneId: node.paneId };
    }
    return {
      type: 'split',
      direction: node.direction === 'v' ? 'v' : 'h',
      ratio: clampRatio(node.ratio),
      children: [serializeTree(node.children[0]), serializeTree(node.children[1])],
    };
  }

  // ---- Active pane ----

  function ensureWindowLabels() {
    const usedByType = { bible: new Set(), commentary: new Set() };

    for (const pane of Object.values(panes)) {
      const type = paneTypeForLabel(pane.paneType);
      const normalized = normalizeWindowLabel(pane.windowLabel);
      if (normalized && !usedByType[type].has(normalized)) {
        pane.windowLabel = normalized;
        usedByType[type].add(normalized);
        continue;
      }
      let idx = 0;
      while (usedByType[type].has(labelForIndex(idx))) idx++;
      pane.windowLabel = labelForIndex(idx);
      usedByType[type].add(pane.windowLabel);
    }
  }

  function getFirstLeafId(node) {
    if (node.type === 'leaf') return node.paneId;
    return getFirstLeafId(node.children[0]);
  }

  function getAllLeafIds(node) {
    if (!node) return [];
    if (node.type === 'leaf') return [node.paneId];
    return [...getAllLeafIds(node.children[0]), ...getAllLeafIds(node.children[1])];
  }

  function cycleActivePane() {
    if (!tree) return;
    const ids = getAllLeafIds(tree);
    if (ids.length <= 1) return;
    const idx = ids.indexOf(activePaneId);
    setActivePane(ids[(idx + 1) % ids.length]);
  }

  function getActivePaneId() {
    return activePaneId;
  }

  function setActivePane(paneId) {
    if (!panes[paneId]) return;
    const prev = document.querySelector(`[data-pane-id="${activePaneId}"]`);
    if (prev) prev.classList.remove('pane-active');
    activePaneId = paneId;
    const next = document.querySelector(`[data-pane-id="${paneId}"]`);
    if (next) next.classList.add('pane-active');
  }

  // ---- Rendering the tree into DOM ----

  function render() {
    const r = root();
    if (!tree) return;
    r.innerHTML = '';
    const el = renderNode(tree);
    r.appendChild(el);
    setActivePane(activePaneId);

    for (const pane of Object.values(panes)) {
      if (pane.paneType === 'commentary') {
        if (!pane.moduleId) {
          renderCommentaryUnavailable(pane.id);
          markInitialLoaded(pane.id);
        } else if (pane.commentaryBooks.length === 0) {
          loadCommentaryData(pane.id);
        } else {
          loadCommentaryChapter(pane.id);
        }
      } else {
        if (pane.books.length === 0 && pane.moduleId) {
          loadPaneData(pane.id);
        } else if (pane.books.length > 0) {
          loadChapter(pane.id);
        }
      }
    }
  }

  function renderNode(node) {
    if (node.type === 'leaf') {
      const pane = panes[node.paneId];
      if (pane && pane.paneType === 'commentary') {
        return createCommentaryPaneElement(node.paneId);
      }
      return createBiblePaneElement(node.paneId);
    }

    const container = document.createElement('div');
    container.className = 'flex h-full w-full';
    container.style.flexDirection = node.direction === 'h' ? 'row' : 'column';

    const child0El = renderNode(node.children[0]);
    const divider = createDivider(node);
    const child1El = renderNode(node.children[1]);

    child0El.style.flex = 'none';
    child0El.style.flexBasis = `${clampRatio(node.ratio) * 100}%`;
    child1El.style.flex = '1 1 0';

    container.appendChild(child0El);
    container.appendChild(divider);
    container.appendChild(child1El);

    return container;
  }

  function createBiblePaneElement(paneId) {
    const pane = panes[paneId];
    const el = document.createElement('div');
    el.className = 'pane-shell flex flex-col h-full w-full min-w-0 min-h-0';
    el.dataset.paneId = paneId;
    el.addEventListener('mousedown', () => setActivePane(paneId));

    const toolbar = document.createElement('div');
    toolbar.className =
      'pane-toolbar flex items-center gap-1 px-2 py-1 border-b border-brand-300 dark:border-night-600 bg-brand-100 dark:bg-night-800 flex-shrink-0';

    const select = document.createElement('select');
    select.className =
      'app-select pl-2 pr-8 py-1 rounded-sm mr-1 border border-brand-400 dark:border-night-500 bg-brand-50 dark:bg-night-700 text-sm text-brand-900 dark:text-night-50 cursor-pointer';
    const sortedModules = Utils.sortBibleModules(modules);
    for (const m of sortedModules) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = Utils.getModuleDisplayName(m);
      opt.title = m.description;
      if (m.id === pane.moduleId) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', async () => {
      pane.moduleId = select.value;
      const mod = modules.find((m) => m.id === select.value);
      pane.hasStrongs = mod ? mod.hasStrongs : false;
      pane.strongsPrefix = mod ? (mod.strongsPrefix || null) : null;
      pane.books = [];
      pane.verses = [];
      await loadPaneData(paneId);
      emitStateChange();
    });
    const prevBtn = document.createElement('button');
    prevBtn.className =
      'nav-prev-btn px-2 py-1 rounded-sm hover:bg-brand-200 dark:hover:bg-night-600 cursor-pointer transition-colors inline-flex items-center justify-center gap-1';
    const prevIcon = Icons.create('chevron-left');
    prevIcon.setAttribute('width', '16');
    prevIcon.setAttribute('height', '16');
    prevIcon.style.flexShrink = '0';
    prevBtn.appendChild(prevIcon);
    const prevBtnLabel = document.createElement('span');
    prevBtnLabel.className = 'nav-prev-label';
    prevBtn.appendChild(prevBtnLabel);
    prevBtn.title = I18n.t('prevChapter');
    prevBtn.addEventListener('click', () => prevChapter(paneId));

    const navBtn = document.createElement('button');
    navBtn.className =
      'nav-btn px-3 py-1 rounded-sm hover:bg-brand-200 dark:hover:bg-night-600 cursor-pointer transition-colors text-sm font-medium min-w-[80px] inline-flex items-center justify-center gap-1.5';
    navBtn.appendChild(Icons.create('ellipsis', 'w-4 h-4 text-brand-600 dark:text-night-300'));
    const navBtnLabel = document.createElement('span');
    navBtnLabel.className = 'nav-btn-label';
    navBtnLabel.textContent = '...';
    navBtn.appendChild(navBtnLabel);
    navBtn.addEventListener('click', async () => {
      try {
        const books = await window.api.getBooks(pane.moduleId);
        Navigation.open(paneId, books);
      } catch (err) {
        console.warn('Failed to open navigation:', err);
      }
    });

    const nextBtn = document.createElement('button');
    nextBtn.className =
      'nav-next-btn px-2 py-1 rounded-sm hover:bg-brand-200 dark:hover:bg-night-600 cursor-pointer transition-colors inline-flex items-center justify-center gap-1';
    const nextBtnLabel = document.createElement('span');
    nextBtnLabel.className = 'nav-next-label';
    nextBtn.appendChild(nextBtnLabel);
    const nextIcon = Icons.create('chevron-right');
    nextIcon.setAttribute('width', '16');
    nextIcon.setAttribute('height', '16');
    nextIcon.style.flexShrink = '0';
    nextBtn.appendChild(nextIcon);
    nextBtn.title = I18n.t('nextChapter');
    nextBtn.addEventListener('click', () => nextChapter(paneId));

    const navGroup = document.createElement('div');
    navGroup.className = 'nav-group';
    navGroup.append(prevBtn, navBtn, nextBtn);

    const backBtn = document.createElement('button');
    backBtn.className =
      'pane-back-btn px-2 py-1 rounded-sm hover:bg-brand-200 dark:hover:bg-night-600 cursor-pointer transition-colors items-center justify-center';
    backBtn.hidden = true;
    backBtn.appendChild(Icons.create('arrow-left'));
    backBtn.title = I18n.t('crossRefBackTooltip');
    backBtn.addEventListener('click', () => navBack(paneId));

    const pinBtn = document.createElement('button');
    pinBtn.className =
      'pane-pin-btn px-2 py-1 rounded-sm hover:bg-brand-200 dark:hover:bg-night-600 cursor-pointer transition-colors inline-flex items-center justify-center';
    const isPinned = linkTargetPaneId === paneId;
    pinBtn.appendChild(Icons.create(isPinned ? 'pin' : 'pin-off'));
    pinBtn.title = isPinned ? I18n.t('unpinLinkTarget') : I18n.t('pinLinkTarget');
    if (isPinned) pinBtn.classList.add('pane-link-target');
    pinBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    pinBtn.addEventListener('click', () => {
      if (linkTargetPaneId === paneId) {
        clearLinkTarget();
      } else {
        setLinkTarget(paneId);
      }
    });

    const spacer = document.createElement('div');
    spacer.className = 'flex-1';

    const closeBtn = document.createElement('button');
    closeBtn.className =
      'px-2 py-1 rounded-sm hover:bg-brand-200 dark:hover:bg-night-700 text-brand-500 dark:text-night-400 hover:text-brand-700 dark:hover:text-night-200 cursor-pointer transition-colors text-sm inline-flex items-center justify-center';
    closeBtn.appendChild(Icons.create('x'));
    closeBtn.title = I18n.t('closePane');
    closeBtn.addEventListener('click', () => closePane(paneId));

    const idBadge = document.createElement('span');
    idBadge.className = 'pane-id-badge';
    idBadge.textContent = getPaneDisplayLabel(paneId);

    toolbar.append(idBadge, select, navGroup, spacer, backBtn, pinBtn, closeBtn);

    const content = document.createElement('div');
    content.className = 'pane-content flex-1 overflow-y-auto';

    el.appendChild(toolbar);
    el.appendChild(content);
    return el;
  }

  function createCommentaryPaneElement(paneId) {
    const pane = panes[paneId];
    const el = document.createElement('div');
    el.className = 'pane-shell flex flex-col h-full w-full min-w-0 min-h-0';
    el.dataset.paneId = paneId;
    el.addEventListener('mousedown', () => setActivePane(paneId));

    const toolbar = document.createElement('div');
    toolbar.className =
      'pane-toolbar flex items-center gap-1 px-2 py-1 border-b border-brand-300 dark:border-night-600 bg-brand-100 dark:bg-night-800 flex-shrink-0';

    // Commentary module selector
    const select = document.createElement('select');
    select.className =
      'app-select pl-2 pr-8 py-1 rounded-sm mr-1 border border-brand-400 dark:border-night-500 bg-brand-50 dark:bg-night-700 text-sm text-brand-900 dark:text-night-50 cursor-pointer';
    const sorted = Utils.sortCommentaryModules(commentaryModules);
    for (const m of sorted) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = Utils.getModuleDisplayName(m);
      opt.title = m.description;
      if (m.id === pane.moduleId) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', async () => {
      pane.moduleId = select.value;
      pane.commentaryBooks = [];
      pane.entries = [];
      const selectedVerse = getSelectedVerseFromSyncedBiblePane(pane);
      await loadCommentaryData(paneId, selectedVerse);
      emitStateChange();
    });
    // Navigation label
    const navLabel = document.createElement('span');
    navLabel.className =
      'commentary-nav-label px-2 py-1 text-sm font-medium text-brand-700 dark:text-night-200';
    navLabel.textContent = '';

    const spacer = document.createElement('div');
    spacer.className = 'flex-1';

    const syncWrap = document.createElement('div');
    syncWrap.className = 'commentary-sync-control mr-1';
    syncWrap.addEventListener('mousedown', (e) => e.stopPropagation());

    const syncTrigger = document.createElement('button');
    syncTrigger.type = 'button';
    syncTrigger.className =
      'commentary-sync-trigger px-2 py-1 rounded-sm text-sm text-brand-700 dark:text-night-200 hover:bg-brand-200 dark:hover:bg-night-700 cursor-pointer transition-colors';
    syncTrigger.title = I18n.t('commentarySyncHint');
    syncTrigger.setAttribute('aria-expanded', 'false');
    syncTrigger.setAttribute('aria-haspopup', 'menu');

    const syncMenu = document.createElement('div');
    syncMenu.className = 'commentary-sync-menu hidden';
    syncMenu.setAttribute('role', 'menu');
    syncMenu.tabIndex = -1;

    const biblePaneIds = getBiblePaneIdsForSync();
    const syncOptions = [
      { value: '', label: I18n.t('commentarySyncNone') },
      ...biblePaneIds.map((biblePaneId) => ({
        value: biblePaneId,
        label: `${I18n.t('commentarySyncBiblePrefix')} ${getPaneDisplayLabel(biblePaneId)}`,
      })),
    ];

    if (
      !pane.syncedToPaneId ||
      !panes[pane.syncedToPaneId] ||
      panes[pane.syncedToPaneId].paneType !== 'bible'
    ) {
      pane.syncedToPaneId = null;
    }

    let isSyncMenuOpen = false;
    let syncMenuDocListener = null;

    const setSyncMenuOpen = (open) => {
      isSyncMenuOpen = open;
      syncMenu.classList.toggle('hidden', !open);
      syncTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        if (!syncMenuDocListener) {
          syncMenuDocListener = (e) => {
            if (!syncWrap.isConnected) {
              document.removeEventListener('mousedown', syncMenuDocListener);
              syncMenuDocListener = null;
              return;
            }
            if (!syncWrap.contains(e.target)) setSyncMenuOpen(false);
          };
          document.addEventListener('mousedown', syncMenuDocListener);
        }
        syncMenu.focus();
      } else if (syncMenuDocListener) {
        document.removeEventListener('mousedown', syncMenuDocListener);
        syncMenuDocListener = null;
      }
    };

    const updateSyncTriggerText = () => {
      const selectedValue = pane.syncedToPaneId || '';
      const selectedOption = syncOptions.find((option) => option.value === selectedValue);
      syncTrigger.textContent = selectedOption
        ? selectedOption.label
        : I18n.t('commentarySyncNone');
    };

    const updateSyncMenuSelection = () => {
      const selectedValue = pane.syncedToPaneId || '';
      for (const item of syncMenu.children) {
        const selected = item.dataset.value === selectedValue;
        item.classList.toggle('is-selected', selected);
        item.setAttribute('aria-checked', selected ? 'true' : 'false');
      }
    };

    const selectSyncTarget = (value) => {
      pane.syncedToPaneId = value || null;
      if (biblePaneIds.length > 0) {
        syncCommentaryToPane(paneId);
      }
      updateSyncMenuSelection();
      updateSyncTriggerText();
      setSyncMenuOpen(false);
      emitStateChange();
    };

    for (const option of syncOptions) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'commentary-sync-menu-item';
      item.dataset.value = option.value;
      item.textContent = option.label;
      item.setAttribute('role', 'menuitemradio');
      item.addEventListener('click', () => selectSyncTarget(option.value));
      syncMenu.appendChild(item);
    }

    if (biblePaneIds.length === 0) {
      pane.syncedToPaneId = null;
      syncTrigger.classList.add('opacity-60', 'cursor-not-allowed');
      syncTrigger.disabled = true;
    }

    updateSyncMenuSelection();
    updateSyncTriggerText();

    syncTrigger.addEventListener('click', () => {
      if (syncTrigger.disabled) return;
      setSyncMenuOpen(!isSyncMenuOpen);
    });

    syncTrigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && !isSyncMenuOpen) {
        e.preventDefault();
        setSyncMenuOpen(true);
      } else if (e.key === 'Escape' && isSyncMenuOpen) {
        e.preventDefault();
        setSyncMenuOpen(false);
      }
    });

    syncMenu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setSyncMenuOpen(false);
        syncTrigger.focus();
      }
    });

    syncWrap.addEventListener('focusout', () => {
      if (!isSyncMenuOpen) return;
      setTimeout(() => {
        if (!syncWrap.contains(document.activeElement)) setSyncMenuOpen(false);
      }, 0);
    });

    syncWrap.append(syncTrigger, syncMenu);

    // Coverage info button
    const infoBtn = document.createElement('button');
    infoBtn.className =
      'px-2 py-1 rounded-sm hover:bg-brand-200 dark:hover:bg-night-700 text-brand-500 dark:text-night-400 hover:text-brand-700 dark:hover:text-night-200 cursor-pointer transition-colors text-sm inline-flex items-center justify-center';
    infoBtn.appendChild(Icons.create('info'));
    infoBtn.title = I18n.t('commentaryCoverage');
    infoBtn.addEventListener('click', () => openCommentaryCoverageModal(paneId));

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className =
      'px-2 py-1 rounded-sm hover:bg-brand-200 dark:hover:bg-night-700 text-brand-500 dark:text-night-400 hover:text-brand-700 dark:hover:text-night-200 cursor-pointer transition-colors text-sm inline-flex items-center justify-center';
    closeBtn.appendChild(Icons.create('x'));
    closeBtn.title = I18n.t('closePane');
    closeBtn.addEventListener('click', () => closePane(paneId));

    const idBadge = document.createElement('span');
    idBadge.className = 'pane-id-badge';
    idBadge.textContent = getPaneDisplayLabel(paneId);

    toolbar.append(idBadge, select, navLabel, spacer, syncWrap, infoBtn, closeBtn);

    const content = document.createElement('div');
    content.className = 'pane-content flex-1 overflow-y-auto';

    el.appendChild(toolbar);
    el.appendChild(content);
    return el;
  }

  function findFirstBiblePaneId() {
    for (const id of getBiblePaneIdsForSync()) {
      if (panes[id] && panes[id].paneType === 'bible') return id;
    }
    return null;
  }

  function createDivider(node) {
    const div = document.createElement('div');
    div.className =
      'split-divider ' + (node.direction === 'h' ? 'split-divider-h' : 'split-divider-v');

    div.addEventListener('mousedown', (e) => {
      e.preventDefault();
      div.classList.add('dragging');
      const startPos = node.direction === 'h' ? e.clientX : e.clientY;
      const container = div.parentElement;
      const firstChild = container.children[0];
      const startSize = node.direction === 'h' ? firstChild.offsetWidth : firstChild.offsetHeight;

      const onMove = (e2) => {
        const currentContainerSize =
          node.direction === 'h' ? container.clientWidth : container.clientHeight;
        if (currentContainerSize <= 0) return;
        const delta = (node.direction === 'h' ? e2.clientX : e2.clientY) - startPos;
        const minPx = Math.min(100, Math.max(40, Math.floor(currentContainerSize * 0.2)));
        const maxPx = Math.max(minPx, currentContainerSize - minPx);
        const nextSize = Math.min(maxPx, Math.max(minPx, startSize + delta));
        node.ratio = clampRatio(nextSize / currentContainerSize);
        firstChild.style.flexBasis = `${node.ratio * 100}%`;
      };

      const onUp = () => {
        div.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        emitStateChange();
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    return div;
  }

  // ---- Data loading ----

  async function loadPaneData(paneId) {
    const pane = panes[paneId];
    try {
      if (!pane || !pane.moduleId) return;

      if (!allBooksCache) {
        allBooksCache = await window.api.getAllBooks();
      }

      pane.books = await window.api.getBooks(pane.moduleId);

      const bookExists = pane.books.find((b) => b.bookNumber === pane.bookNumber);
      if (!bookExists) {
        renderUnavailableMessage(paneId, 'book');
        return;
      }

      await loadChapter(paneId);
    } catch (err) {
      console.error('Failed to load pane data:', err);
      renderUnavailableMessage(paneId, 'book');
    } finally {
      markInitialLoaded(paneId);
    }
  }

  // ---- Commentary data loading ----

  function getSelectedVerseFromSyncedBiblePane(commentaryPane) {
    if (!commentaryPane || commentaryPane.paneType !== 'commentary' || !commentaryPane.syncedToPaneId) {
      return null;
    }
    const sourcePane = panes[commentaryPane.syncedToPaneId];
    if (!sourcePane || sourcePane.paneType !== 'bible') return null;

    const sourceContent = document.querySelector(
      `[data-pane-id="${commentaryPane.syncedToPaneId}"] .pane-content`
    );
    if (!sourceContent) return null;

    const selected = sourceContent.querySelector('.verse-line.verse-selected');
    if (!selected) return null;

    const verse = parseInt(selected.dataset.verse, 10);
    return Number.isFinite(verse) ? verse : null;
  }

  async function loadCommentaryData(paneId, scrollToVerse) {
    const pane = panes[paneId];
    try {
      if (!pane || !pane.moduleId) return;

      if (!allBooksCache) {
        allBooksCache = await window.api.getAllBooks();
      }

      pane.commentaryBooks = await window.api.getCommentaryBooks(pane.moduleId);

      if (!pane.commentaryBooks.includes(pane.bookNumber)) {
        renderCommentaryUnavailable(paneId);
        return;
      }

      await loadCommentaryChapter(paneId, scrollToVerse);
    } catch (err) {
      console.error('Failed to load commentary data:', err);
      renderCommentaryUnavailable(paneId);
    } finally {
      markInitialLoaded(paneId);
    }
  }

  async function loadCommentaryChapter(paneId, scrollToVerse) {
    const pane = panes[paneId];
    try {
      if (!pane || !pane.moduleId) return;

      const entries = await window.api.getCommentary(pane.moduleId, pane.bookNumber, pane.chapter);
      pane.entries = entries;

      const el = document.querySelector(`[data-pane-id="${paneId}"]`);
      if (!el) return;

      const content = el.querySelector('.pane-content');

      if (entries.length === 0) {
        renderCommentaryUnavailable(paneId);
        return;
      }

      CommentaryView.renderChapter(content, entries, pane.bookNumber, pane.chapter);

      // Update nav label
      const navLabel = el.querySelector('.commentary-nav-label');
      if (navLabel) {
        navLabel.textContent = `${I18n.bookName(pane.bookNumber).short} ${pane.chapter}`;
        pane.bookShortName = I18n.bookName(pane.bookNumber).short;
      }

      if (scrollToVerse) {
        CommentaryView.scrollToVerse(content, scrollToVerse);
      } else {
        content.scrollTop = 0;
      }
    } catch (err) {
      console.error('Failed to load commentary chapter:', err);
      renderCommentaryUnavailable(paneId);
    } finally {
      markInitialLoaded(paneId);
    }
  }

  function renderCommentaryUnavailable(paneId) {
    const el = document.querySelector(`[data-pane-id="${paneId}"]`);
    if (!el) return;

    const content = el.querySelector('.pane-content');
    content.innerHTML = '';

    const msg = document.createElement('div');
    msg.className = 'unavailable-message';
    msg.textContent = I18n.t('commentaryUnavailable');
    content.appendChild(msg);

    // Update nav label to show current book/chapter even when unavailable
    const pane = panes[paneId];
    const navLabel = el.querySelector('.commentary-nav-label');
    if (navLabel && pane) {
      navLabel.textContent = `${I18n.bookName(pane.bookNumber).short} ${pane.chapter}`;
      pane.bookShortName = I18n.bookName(pane.bookNumber).short;
    }
  }

  function syncCommentaryToPane(commentaryPaneId, scrollToVerse) {
    const pane = panes[commentaryPaneId];
    if (!pane || pane.paneType !== 'commentary' || !pane.syncedToPaneId) return;

    const sourcePane = panes[pane.syncedToPaneId];
    if (!sourcePane || sourcePane.paneType !== 'bible') return;

    if (pane.bookNumber !== sourcePane.bookNumber || pane.chapter !== sourcePane.chapter) {
      pane.bookNumber = sourcePane.bookNumber;
      pane.chapter = sourcePane.chapter;
      loadCommentaryChapter(commentaryPaneId, scrollToVerse);
    }
  }

  function notifyChapterChange(paneId, scrollToVerse) {
    // When a bible pane changes chapter, notify all synced commentary panes
    for (const pane of Object.values(panes)) {
      if (pane.paneType === 'commentary' && pane.syncedToPaneId === paneId) {
        syncCommentaryToPane(pane.id, scrollToVerse);
      }
    }
  }

  function notifyVerseClick(paneId, verseNum) {
    for (const pane of Object.values(panes)) {
      if (pane.paneType === 'commentary' && pane.syncedToPaneId === paneId) {
        const el = document.querySelector(`[data-pane-id="${pane.id}"] .pane-content`);
        if (el) CommentaryView.scrollToVerse(el, verseNum);
      }
    }
  }

  function getCrossRefModules() {
    if (typeof AppStateStore === 'undefined') return null;
    return AppStateStore.getSettings().crossRefModules || null;
  }

  function bookNameResolver() {
    return (bookNumber) => I18n.bookName(bookNumber).short;
  }

  function hasNavBackHistory(pane) {
    if (!pane || !Array.isArray(pane.navHistory)) return false;
    if (pane.navHistory.length === 0) return false;
    return pane.navHistoryIdx >= 0 && pane.navHistoryIdx < pane.navHistory.length;
  }

  function updateBackBtn(paneId) {
    const pane = panes[paneId];
    const el = document.querySelector(`[data-pane-id="${paneId}"]`);
    if (!el || !pane) return;
    const btn = el.querySelector('.pane-back-btn');
    if (!btn) return;
    const visible = hasNavBackHistory(pane);
    btn.hidden = !visible;
    btn.disabled = !visible;
  }

  function pushNavHistory(paneId) {
    const pane = panes[paneId];
    if (!pane) return;
    // Truncate any forward history
    pane.navHistory = pane.navHistory.slice(0, pane.navHistoryIdx + 1);
    pane.navHistory.push({ bookNumber: pane.bookNumber, chapter: pane.chapter });
    pane.navHistoryIdx = pane.navHistory.length - 1;
    updateBackBtn(paneId);
  }

  async function navBack(paneId) {
    const pane = panes[paneId];
    if (!hasNavBackHistory(pane)) return;
    const entry = pane.navHistory[pane.navHistoryIdx];
    pane.navHistoryIdx--;
    pane.bookNumber = entry.bookNumber;
    pane.chapter = entry.chapter;
    await loadChapter(paneId);
    updateBackBtn(paneId);
    emitStateChange();
  }

  async function loadChapter(paneId, scrollToVerse) {
    const pane = panes[paneId];
    try {
      if (!pane || !pane.moduleId) return;

      const crossRefModules = getCrossRefModules();
      const fetchVersesP = window.api.getChapter(pane.moduleId, pane.bookNumber, pane.chapter);
      const fetchCrossRefsP = crossRefModules
        ? window.api.getCrossReferences(pane.bookNumber, pane.chapter, crossRefModules)
        : Promise.resolve([]);
      const fetchChapterCountP = window.api.getChapterCount(pane.moduleId, pane.bookNumber);

      const [verses, crossRefs, chapterCount] = await Promise.all([
        fetchVersesP,
        fetchCrossRefsP,
        fetchChapterCountP,
      ]);
      pane.verses = verses;

      if (verses.length === 0) {
        renderUnavailableMessage(paneId, 'chapter');
        return;
      }

      const el = document.querySelector(`[data-pane-id="${paneId}"]`);
      if (!el) return;

      const content = el.querySelector('.pane-content');
      const book = pane.books.find((b) => b.bookNumber === pane.bookNumber);
      pane.bookShortName = I18n.bookName(pane.bookNumber).short;
      BibleView.renderChapter(content, verses, pane.hasStrongs, pane.bookNumber, {
        crossRefs,
        crossRefMode: crossRefModules ? 'inline' : 'none',
        bookNameResolver: bookNameResolver(),
        strongsPrefix: pane.strongsPrefix,
      });

      const wrapper = content.querySelector('.verse-text');
      if (wrapper) {
        wrapper.dataset.bookShort = I18n.bookName(pane.bookNumber).short;
        wrapper.dataset.chapter = pane.chapter;
      }

      const navBtnLabel = el.querySelector('.nav-btn-label');
      if (navBtnLabel) {
        navBtnLabel.textContent = `${I18n.bookName(pane.bookNumber).short} ${pane.chapter}`;
      }

      // Update prev/next navigation labels
      if (book) {
        const bookIdx = pane.books.findIndex((b) => b.bookNumber === pane.bookNumber);
        const prevLabelEl = el.querySelector('.nav-prev-label');
        const nextLabelEl = el.querySelector('.nav-next-label');
        const prevBtnEl = el.querySelector('.nav-prev-btn');
        const nextBtnEl = el.querySelector('.nav-next-btn');

        if (prevBtnEl && prevLabelEl) {
          if (pane.chapter > 1) {
            prevLabelEl.textContent = `${I18n.bookName(pane.bookNumber).short} ${pane.chapter - 1}`;
            prevBtnEl.style.display = '';
          } else if (bookIdx > 0) {
            prevLabelEl.textContent = I18n.bookName(pane.books[bookIdx - 1].bookNumber).short;
            prevBtnEl.style.display = '';
          } else {
            prevLabelEl.textContent = '';
            prevBtnEl.style.display = 'none';
          }
        }

        if (nextBtnEl && nextLabelEl) {
          if (pane.chapter < chapterCount) {
            nextLabelEl.textContent = `${I18n.bookName(pane.bookNumber).short} ${pane.chapter + 1}`;
            nextBtnEl.style.display = '';
          } else if (bookIdx < pane.books.length - 1) {
            nextLabelEl.textContent = `${I18n.bookName(pane.books[bookIdx + 1].bookNumber).short} 1`;
            nextBtnEl.style.display = '';
          } else {
            nextLabelEl.textContent = '';
            nextBtnEl.style.display = 'none';
          }
        }
      }

      if (scrollToVerse) {
        setTimeout(() => BibleView.scrollToVerse(content, scrollToVerse), 100);
      } else {
        content.scrollTop = 0;
      }
      notifyChapterChange(paneId, scrollToVerse);
    } catch (err) {
      console.error('Failed to load chapter:', err);
      renderUnavailableMessage(paneId, 'chapter');
    } finally {
      updateBackBtn(paneId);
      markInitialLoaded(paneId);
    }
  }

  function reloadAllChapters() {
    for (const pane of Object.values(panes)) {
      if (pane.paneType === 'commentary') {
        if (pane.commentaryBooks.length > 0) loadCommentaryChapter(pane.id);
      } else {
        if (pane.books.length > 0) loadChapter(pane.id);
      }
    }
  }

  async function navigatePane(paneId, bookNumber, chapter, verse) {
    const pane = panes[paneId];
    if (!pane) return false;
    if (pane.books.length > 0 && !pane.books.find((b) => b.bookNumber === bookNumber)) {
      return false;
    }
    const prevBookNumber = pane.bookNumber;
    const prevChapter = pane.chapter;
    pane.bookNumber = bookNumber;
    pane.chapter = chapter;
    try {
      await loadChapter(paneId, verse || null);
      // Push the *old* location so navBack returns there
      pane.navHistory = pane.navHistory.slice(0, pane.navHistoryIdx + 1);
      pane.navHistory.push({ bookNumber: prevBookNumber, chapter: prevChapter });
      pane.navHistoryIdx = pane.navHistory.length - 1;
      updateBackBtn(paneId);
      emitStateChange();
      return true;
    } catch (err) {
      pane.bookNumber = prevBookNumber;
      pane.chapter = prevChapter;
      throw err;
    }
  }

  async function prevChapter(paneId) {
    const pane = panes[paneId];
    if (!pane) return;
    if (!pane.books.find((b) => b.bookNumber === pane.bookNumber)) return;

    if (pane.chapter > 1) {
      pane.chapter--;
    } else {
      const idx = pane.books.findIndex((b) => b.bookNumber === pane.bookNumber);
      if (idx > 0) {
        const prevBook = pane.books[idx - 1];
        const count = await window.api.getChapterCount(pane.moduleId, prevBook.bookNumber);
        pane.bookNumber = prevBook.bookNumber;
        pane.chapter = count;
      }
    }
    await loadChapter(paneId);
    emitStateChange();
  }

  async function nextChapter(paneId) {
    const pane = panes[paneId];
    if (!pane) return;
    if (!pane.books.find((b) => b.bookNumber === pane.bookNumber)) return;

    const count = await window.api.getChapterCount(pane.moduleId, pane.bookNumber);
    if (pane.chapter < count) {
      pane.chapter++;
    } else {
      const idx = pane.books.findIndex((b) => b.bookNumber === pane.bookNumber);
      if (idx < pane.books.length - 1) {
        pane.bookNumber = pane.books[idx + 1].bookNumber;
        pane.chapter = 1;
      }
    }
    await loadChapter(paneId);
    emitStateChange();
  }

  function renderUnavailableMessage(paneId, type) {
    const pane = panes[paneId];
    const el = document.querySelector(`[data-pane-id="${paneId}"]`);
    if (!el) return;

    const content = el.querySelector('.pane-content');
    content.innerHTML = '';

    const msg = document.createElement('div');
    msg.className = 'unavailable-message';
    msg.textContent = type === 'book' ? I18n.t('bookUnavailable') : I18n.t('chapterUnavailable');
    content.appendChild(msg);

    const navBtnLabel = el.querySelector('.nav-btn-label');
    if (navBtnLabel) {
      navBtnLabel.textContent = `${I18n.bookName(pane.bookNumber).short} ${pane.chapter}`;
    }

    // Hide prev/next buttons and clear labels so they don't show stale data
    const prevBtnEl = el.querySelector('.nav-prev-btn');
    const nextBtnEl = el.querySelector('.nav-next-btn');
    const prevLabelEl = el.querySelector('.nav-prev-label');
    const nextLabelEl = el.querySelector('.nav-next-label');
    if (prevBtnEl) prevBtnEl.classList.add('hidden');
    if (nextBtnEl) nextBtnEl.classList.add('hidden');
    if (prevLabelEl) prevLabelEl.textContent = '';
    if (nextLabelEl) nextLabelEl.textContent = '';
  }

  // ---- Link target ----

  function setLinkTarget(paneId) {
    if (!panes[paneId]) return;
    linkTargetPaneId = paneId;
    updatePinButtons();
    emitStateChange();
  }

  function clearLinkTarget() {
    linkTargetPaneId = null;
    updatePinButtons();
    emitStateChange();
  }

  function getLinkTargetPaneId() {
    return linkTargetPaneId;
  }

  function getNavigationTarget(fallbackPaneId) {
    if (
      linkTargetPaneId &&
      panes[linkTargetPaneId] &&
      panes[linkTargetPaneId].paneType === 'bible'
    ) {
      return linkTargetPaneId;
    }
    if (fallbackPaneId && panes[fallbackPaneId] && panes[fallbackPaneId].paneType === 'bible') {
      return fallbackPaneId;
    }
    return findFirstBiblePaneId() || fallbackPaneId;
  }

  function updatePinButtons() {
    document.querySelectorAll('[data-pane-id]').forEach((el) => {
      const id = el.getAttribute('data-pane-id');
      const btn = el.querySelector('.pane-pin-btn');
      if (!btn) return;
      const pinned = id === linkTargetPaneId;
      btn.replaceChildren(Icons.create(pinned ? 'pin' : 'pin-off'));
      if (pinned) {
        btn.classList.add('pane-link-target');
        btn.title = I18n.t('unpinLinkTarget');
      } else {
        btn.classList.remove('pane-link-target');
        btn.title = I18n.t('pinLinkTarget');
      }
    });
  }

  // ---- Split / Close ----

  function splitActivePane(direction) {
    if (!activePaneId || !panes[activePaneId]) return;
    splitPane(activePaneId, direction);
  }

  function splitActivePaneWithType(direction, paneType) {
    if (!activePaneId || !panes[activePaneId]) return;
    splitPane(activePaneId, direction, paneType);
  }

  function splitPane(paneId, direction, forcePaneType) {
    const orig = panes[paneId];
    const newPaneType = forcePaneType || 'bible';

    // For commentary splits, find a bible pane to sync to
    const syncTarget =
      newPaneType === 'commentary'
        ? orig.paneType === 'bible'
          ? paneId
          : panes[activePaneId]?.paneType === 'bible'
            ? activePaneId
            : findFirstBiblePaneId()
        : null;

    const newPaneId = createPaneState({
      paneType: newPaneType,
      moduleId:
        newPaneType === 'commentary'
          ? commentaryModules.length > 0
            ? commentaryModules[0].id
            : null
          : orig.moduleId,
      bookNumber: orig.bookNumber,
      chapter: orig.chapter,
      syncedToPaneId: syncTarget,
    });

    const newPane = panes[newPaneId];
    if (newPaneType === 'bible') {
      newPane.hasStrongs = orig.hasStrongs || false;
      newPane.strongsPrefix = orig.strongsPrefix || null;
    }

    const parent = findParent(tree, paneId);
    const leaf = { type: 'leaf', paneId };
    const newLeaf = { type: 'leaf', paneId: newPaneId };

    const splitNode = {
      type: 'split',
      direction,
      children: [leaf, newLeaf],
      ratio: 0.5,
    };

    if (!parent) {
      tree = splitNode;
    } else {
      let idx = parent.children.findIndex((c) => (c.type === 'leaf' ? c.paneId === paneId : false));
      if (idx === -1) idx = findSplitChildIndex(parent, paneId);
      parent.children[idx] = splitNode;
    }

    activePaneId = newPaneId;
    render();
    emitStateChange();
  }

  function findParent(node, paneId) {
    if (node.type === 'leaf') return null;
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (child.type === 'leaf' && child.paneId === paneId) return node;
      const found = findParent(child, paneId);
      if (found) return found;
    }
    return null;
  }

  function findSplitChildIndex(parent, paneId) {
    for (let i = 0; i < parent.children.length; i++) {
      if (containsPane(parent.children[i], paneId)) return i;
    }
    return 0;
  }

  function containsPane(node, paneId) {
    if (node.type === 'leaf') return node.paneId === paneId;
    return node.children.some((c) => containsPane(c, paneId));
  }

  function closePane(paneId) {
    if (tree.type === 'leaf') return;

    const parent = findParent(tree, paneId);
    if (!parent) return;

    const idx = parent.children.findIndex((c) => c.type === 'leaf' && c.paneId === paneId);
    if (idx === -1) return;
    const sibling = parent.children[1 - idx];

    const grandparent = findParentOfNode(tree, parent);
    if (!grandparent) {
      tree = sibling;
    } else {
      const pIdx = grandparent.children.indexOf(parent);
      grandparent.children[pIdx] = sibling;
    }

    delete panes[paneId];
    if (linkTargetPaneId === paneId) {
      linkTargetPaneId = null;
    }
    // Clear sync references pointing to the closed pane
    for (const pane of Object.values(panes)) {
      if (pane.paneType === 'commentary' && pane.syncedToPaneId === paneId) {
        pane.syncedToPaneId = null;
      }
    }
    if (activePaneId === paneId) {
      activePaneId = getFirstLeafId(sibling);
    }
    render();
    emitStateChange();
  }

  function findParentOfNode(rootNode, target) {
    if (rootNode.type === 'leaf') return null;
    for (let i = 0; i < rootNode.children.length; i++) {
      if (rootNode.children[i] === target) return rootNode;
      const found = findParentOfNode(rootNode.children[i], target);
      if (found) return found;
    }
    return null;
  }

  // Chapter counts per book (index 0=Gen, 65=Rev) — standard KJV canon
  const CHAPTER_COUNTS = [
    50,40,27,36,34,24,21,4,31,24,22,25,29,36,10,13,10,42,150,31,12,8,66,52,5,48,12,14,3,9,1,4,7,3,3,3,2,14,4,
    28,16,24,21,28,16,16,13,6,6,4,4,5,3,6,4,3,1,13,5,5,3,5,1,1,1,22,
  ];

  async function openCommentaryCoverageModal(paneId) {
    const pane = panes[paneId];
    if (!pane) return;

    const coverage = await window.api.getCommentaryCoverage(pane.moduleId);
    const bookNumbers = I18n._BOOK_NUMBERS;

    // Build overlay
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-40 bg-black/50 flex items-center justify-center';
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    const modal = document.createElement('div');
    modal.className =
      'bg-brand-50 dark:bg-night-800 shadow-2xl w-[620px] max-w-[92vw] max-h-[85vh] flex flex-col overflow-hidden';

    // Header
    const header = document.createElement('div');
    header.className = 'p-4 border-b border-brand-300 dark:border-night-600 flex items-center justify-between';
    const title = document.createElement('h2');
    title.className = 'text-lg font-semibold';
    title.textContent = I18n.t('commentaryCoverage');
    const closeBtn = document.createElement('button');
    closeBtn.className =
      'px-2 py-1 rounded-sm hover:bg-brand-200 dark:hover:bg-night-700 text-brand-500 dark:text-night-400 cursor-pointer transition-colors inline-flex items-center justify-center';
    closeBtn.appendChild(Icons.create('x'));
    closeBtn.addEventListener('click', () => overlay.remove());
    header.append(title, closeBtn);

    // Legend
    const legend = document.createElement('div');
    legend.className = 'px-4 pt-3 pb-1 flex gap-4 text-xs text-brand-600 dark:text-night-300';
    for (const [cls, key] of [
      ['coverage-full', 'coverageFull'],
      ['coverage-partial', 'coveragePartial'],
      ['coverage-none', 'coverageNone'],
    ]) {
      const item = document.createElement('span');
      item.className = 'flex items-center gap-1.5';
      const dot = document.createElement('span');
      dot.className = `inline-block w-3 h-3 ${cls}`;
      item.append(dot, I18n.t(key));
      legend.appendChild(item);
    }

    // Book grid
    const grid = document.createElement('div');
    grid.className = 'p-4 overflow-y-auto coverage-grid';

    // OT label
    const otLabel = document.createElement('div');
    otLabel.className = 'text-xs font-semibold text-brand-500 dark:text-night-400 mb-1.5';
    otLabel.textContent = I18n.t('oldTestament');
    grid.appendChild(otLabel);

    const otGrid = document.createElement('div');
    otGrid.className = 'grid gap-1.5 mb-4';
    otGrid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(52px, 1fr))';

    for (let i = 0; i < 39; i++) {
      otGrid.appendChild(buildCoverageCell(bookNumbers[i], i, coverage));
    }
    grid.appendChild(otGrid);

    // NT label
    const ntLabel = document.createElement('div');
    ntLabel.className = 'text-xs font-semibold text-brand-500 dark:text-night-400 mb-1.5';
    ntLabel.textContent = I18n.t('newTestament');
    grid.appendChild(ntLabel);

    const ntGrid = document.createElement('div');
    ntGrid.className = 'grid gap-1.5';
    ntGrid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(52px, 1fr))';

    for (let i = 39; i < 66; i++) {
      ntGrid.appendChild(buildCoverageCell(bookNumbers[i], i, coverage));
    }
    grid.appendChild(ntGrid);

    modal.append(header, legend, grid);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Close on Escape
    const onKey = (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
      }
    };
    document.addEventListener('keydown', onKey);
  }

  function buildCoverageCell(bookNumber, bookIndex, coverage) {
    const totalChapters = CHAPTER_COUNTS[bookIndex];
    const coveredChapters = coverage[bookNumber] || [];
    const name = I18n.bookName(bookNumber);
    const ratio = coveredChapters.length / totalChapters;

    const cell = document.createElement('div');
    cell.className = 'coverage-cell';

    if (ratio === 0) {
      cell.classList.add('coverage-none');
      cell.title = `${name.long}: ${I18n.t('coverageNone')}`;
    } else if (ratio >= 1) {
      cell.classList.add('coverage-full');
      cell.title = `${name.long}: ${I18n.t('coverageFull')} (${totalChapters} ${I18n.t('coverageChapters')})`;
    } else {
      cell.classList.add('coverage-partial');
      const coveredSet = new Set(coveredChapters);
      const missing = [];
      for (let ch = 1; ch <= totalChapters; ch++) {
        if (!coveredSet.has(ch)) missing.push(ch);
      }
      const missingStr = compactRanges(missing);
      cell.title = `${name.long}: ${coveredChapters.length}/${totalChapters} ${I18n.t('coverageChapters')}\n${I18n.t('coverageMissingChapters')}: ${missingStr}`;
    }

    cell.textContent = name.short;
    return cell;
  }

  function compactRanges(nums) {
    if (nums.length === 0) return '';
    const ranges = [];
    let start = nums[0];
    let end = start;
    for (let i = 1; i < nums.length; i++) {
      if (nums[i] === end + 1) {
        end = nums[i];
      } else {
        ranges.push(start === end ? String(start) : `${start}-${end}`);
        start = nums[i];
        end = start;
      }
    }
    ranges.push(start === end ? String(start) : `${start}-${end}`);
    return ranges.join(', ');
  }

  return {
    init,
    waitForInitialLoad,
    getPane,
    navigatePane,
    render,
    getState,
    setStateChangeListener,
    splitActivePane,
    splitActivePaneWithType,
    cycleActivePane,
    getActivePaneId,
    setActivePane,
    reloadAllChapters,
    getNavigationTarget,
    getLinkTargetPaneId,
    notifyVerseClick,
  };
})();

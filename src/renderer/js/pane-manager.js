/**
 * pane-manager.js — Recursive binary split pane system
 *
 * Tree structure:
 *   Node = { type: 'leaf', paneId } | { type: 'split', direction: 'h'|'v', children: [Node, Node], sizes: [px, px] }
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
          sizes: [650, 350],
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

    if (paneType === 'commentary') {
      const moduleId = resolveCommentaryModuleId(initial.moduleId);
      panes[id] = {
        id,
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
        paneType: 'bible',
        moduleId,
        hasStrongs: mod ? mod.hasStrongs : false,
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
        if (!moduleId) {
          // No commentary modules available — fall back to a bible pane
          const fallbackModuleId = resolveModuleId(null);
          const mod = modules.find((m) => m.id === fallbackModuleId) || modules[0] || null;
          nextPanes[paneId] = {
            id: paneId,
            paneType: 'bible',
            moduleId: fallbackModuleId,
            hasStrongs: mod ? mod.hasStrongs : false,
            bookNumber: Number.isInteger(raw.bookNumber) ? raw.bookNumber : 10,
            chapter: Number.isInteger(raw.chapter) ? raw.chapter : 1,
            bookShortName: raw.bookShortName || '',
            books: [],
            verses: [],
            navHistory: [],
            navHistoryIdx: -1,
          };
        } else {
          nextPanes[paneId] = {
            id: paneId,
            paneType: 'commentary',
            moduleId,
            bookNumber: Number.isInteger(raw.bookNumber) ? raw.bookNumber : 10,
            chapter: Number.isInteger(raw.chapter) ? raw.chapter : 1,
            bookShortName: raw.bookShortName || '',
            commentaryBooks: [],
            entries: [],
            syncedToPaneId: raw.syncedToPaneId || null,
          };
        }
      } else {
        const moduleId = resolveModuleId(raw.moduleId);
        const mod = modules.find((m) => m.id === moduleId) || modules[0] || null;

        nextPanes[paneId] = {
          id: paneId,
          paneType: 'bible',
          moduleId,
          hasStrongs: mod ? mod.hasStrongs : false,
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
    const size0 = Number.isFinite(node.sizes?.[0]) ? Math.max(100, Math.floor(node.sizes[0])) : 300;
    const size1 = Number.isFinite(node.sizes?.[1]) ? Math.max(100, Math.floor(node.sizes[1])) : 300;

    return {
      type: 'split',
      direction,
      children: [left, right],
      sizes: [size0, size1],
    };
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
      tree,
      panes: serializablePanes,
      linkTargetPaneId,
    };
  }

  // ---- Active pane ----

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
    r.innerHTML = '';
    const el = renderNode(tree);
    r.appendChild(el);
    setActivePane(activePaneId);

    for (const pane of Object.values(panes)) {
      if (pane.paneType === 'commentary') {
        if (pane.commentaryBooks.length === 0 && pane.moduleId) {
          loadCommentaryData(pane.id);
        } else if (pane.commentaryBooks.length > 0) {
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

    const dim = node.direction === 'h' ? 'width' : 'height';
    child0El.style.flex = 'none';
    child0El.style[dim] = node.sizes[0] + 'px';
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
      'app-select pl-2 pr-8 py-1 mr-1 rounded-md border border-brand-400 dark:border-night-500 bg-brand-50 dark:bg-night-700 text-sm text-brand-900 dark:text-night-50 cursor-pointer';
    const sortedModules = Utils.sortBibleModules(modules);
    for (const m of sortedModules) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.id;
      opt.title = m.description;
      if (m.id === pane.moduleId) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', async () => {
      pane.moduleId = select.value;
      const mod = modules.find((m) => m.id === select.value);
      pane.hasStrongs = mod ? mod.hasStrongs : false;
      pane.books = [];
      pane.verses = [];
      await loadPaneData(paneId);
      emitStateChange();
    });

    const prevBtn = document.createElement('button');
    prevBtn.className =
      'nav-prev-btn px-2 py-1 rounded-md hover:bg-brand-200 dark:hover:bg-night-600 cursor-pointer transition-colors inline-flex items-center justify-center gap-1';
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
      'nav-btn px-3 py-1 rounded-md hover:bg-brand-200 dark:hover:bg-night-600 cursor-pointer transition-colors text-sm font-medium min-w-[80px] inline-flex items-center justify-center gap-1.5';
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
      'nav-next-btn px-2 py-1 rounded-md hover:bg-brand-200 dark:hover:bg-night-600 cursor-pointer transition-colors inline-flex items-center justify-center gap-1';
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
      'pane-back-btn px-2 py-1 rounded-md hover:bg-brand-200 dark:hover:bg-night-600 cursor-pointer transition-colors items-center justify-center';
    backBtn.hidden = true;
    backBtn.appendChild(Icons.create('arrow-left'));
    backBtn.title = I18n.t('crossRefBackTooltip');
    backBtn.addEventListener('click', () => navBack(paneId));

    const pinBtn = document.createElement('button');
    pinBtn.className =
      'pane-pin-btn px-2 py-1 rounded-md hover:bg-brand-200 dark:hover:bg-night-600 cursor-pointer transition-colors inline-flex items-center justify-center';
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
      'px-2 py-1 rounded-md hover:bg-brand-200 dark:hover:bg-night-700 text-brand-500 dark:text-night-400 hover:text-brand-700 dark:hover:text-night-200 cursor-pointer transition-colors text-sm inline-flex items-center justify-center';
    closeBtn.appendChild(Icons.create('x'));
    closeBtn.title = I18n.t('closePane');
    closeBtn.addEventListener('click', () => closePane(paneId));

    const idBadge = document.createElement('span');
    idBadge.className = 'pane-id-badge';
    idBadge.textContent = paneId.replace('pane-', '');

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
      'app-select pl-2 pr-8 py-1 mr-1 rounded-md border border-brand-400 dark:border-night-500 bg-brand-50 dark:bg-night-700 text-sm text-brand-900 dark:text-night-50 cursor-pointer';
    const sorted = Utils.sortCommentaryModules(commentaryModules);
    for (const m of sorted) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.id;
      opt.title = m.description;
      if (m.id === pane.moduleId) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', async () => {
      pane.moduleId = select.value;
      pane.commentaryBooks = [];
      pane.entries = [];
      await loadCommentaryData(paneId);
      emitStateChange();
    });

    // Navigation label
    const navLabel = document.createElement('span');
    navLabel.className = 'commentary-nav-label px-2 py-1 text-sm font-medium text-brand-700 dark:text-night-200';
    navLabel.textContent = '';

    const spacer = document.createElement('div');
    spacer.className = 'flex-1';

    // Sync toggle button
    const syncBtn = document.createElement('button');
    syncBtn.className =
      'commentary-sync-btn px-2 py-1 rounded-md hover:bg-brand-200 dark:hover:bg-night-600 cursor-pointer transition-colors inline-flex items-center justify-center';
    const isSynced = !!pane.syncedToPaneId;
    syncBtn.appendChild(Icons.create(isSynced ? 'link' : 'unlink'));
    syncBtn.title = isSynced ? I18n.t('unsyncCommentary') : I18n.t('syncCommentary');
    if (isSynced) syncBtn.classList.add('pane-link-target');
    syncBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    syncBtn.addEventListener('click', () => {
      if (pane.syncedToPaneId) {
        pane.syncedToPaneId = null;
        syncBtn.replaceChildren(Icons.create('unlink'));
        syncBtn.classList.remove('pane-link-target');
        syncBtn.title = I18n.t('syncCommentary');
        syncLabel.textContent = '';
      } else {
        // Prefer active Bible pane, fall back to first
        const biblePaneId = (panes[activePaneId]?.paneType === 'bible')
          ? activePaneId
          : findFirstBiblePaneId();
        if (biblePaneId) {
          pane.syncedToPaneId = biblePaneId;
          syncBtn.replaceChildren(Icons.create('link'));
          syncBtn.classList.add('pane-link-target');
          syncBtn.title = I18n.t('unsyncCommentary');
          syncLabel.textContent = '\u2194 ' + biblePaneId.replace('pane-', '');
          // Sync immediately
          syncCommentaryToPane(paneId);
        }
      }
      emitStateChange();
    });

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className =
      'px-2 py-1 rounded-md hover:bg-brand-200 dark:hover:bg-night-700 text-brand-500 dark:text-night-400 hover:text-brand-700 dark:hover:text-night-200 cursor-pointer transition-colors text-sm inline-flex items-center justify-center';
    closeBtn.appendChild(Icons.create('x'));
    closeBtn.title = I18n.t('closePane');
    closeBtn.addEventListener('click', () => closePane(paneId));

    const idBadge = document.createElement('span');
    idBadge.className = 'pane-id-badge';
    idBadge.textContent = paneId.replace('pane-', '');

    // Sync label showing linked Bible pane number (clickable to cycle)
    const syncLabel = document.createElement('span');
    syncLabel.className = 'commentary-sync-label';
    if (pane.syncedToPaneId) {
      syncLabel.textContent = '\u2194 ' + pane.syncedToPaneId.replace('pane-', '');
    }
    syncLabel.addEventListener('mousedown', (e) => e.stopPropagation());
    syncLabel.addEventListener('click', () => {
      if (!pane.syncedToPaneId) return;
      const biblePaneIds = getAllLeafIds(tree).filter(id => panes[id]?.paneType === 'bible');
      if (biblePaneIds.length < 2) return;
      const curIdx = biblePaneIds.indexOf(pane.syncedToPaneId);
      const nextIdx = (curIdx + 1) % biblePaneIds.length;
      pane.syncedToPaneId = biblePaneIds[nextIdx];
      syncLabel.textContent = '\u2194 ' + pane.syncedToPaneId.replace('pane-', '');
      syncCommentaryToPane(paneId);
      emitStateChange();
    });

    toolbar.append(idBadge, select, navLabel, spacer, syncBtn, syncLabel, closeBtn);

    const content = document.createElement('div');
    content.className = 'pane-content flex-1 overflow-y-auto';

    el.appendChild(toolbar);
    el.appendChild(content);
    return el;
  }

  function findFirstBiblePaneId() {
    const leafIds = getAllLeafIds(tree);
    for (const id of leafIds) {
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
      const startSize = node.sizes[0];

      const onMove = (e2) => {
        const delta = (node.direction === 'h' ? e2.clientX : e2.clientY) - startPos;
        const newSize = Math.max(100, startSize + delta);
        node.sizes[0] = newSize;

        const container = div.parentElement;
        const firstChild = container.children[0];
        const dim = node.direction === 'h' ? 'width' : 'height';
        firstChild.style[dim] = newSize + 'px';
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

  async function loadCommentaryData(paneId) {
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

      await loadCommentaryChapter(paneId);
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

      CommentaryView.renderChapter(content, entries, pane.bookNumber);

      // Update nav label
      const navLabel = el.querySelector('.commentary-nav-label');
      if (navLabel && allBooksCache) {
        const book = allBooksCache.find((b) => b.bookNumber === pane.bookNumber);
        if (book) {
          navLabel.textContent = `${book.shortName} ${pane.chapter}`;
          pane.bookShortName = book.shortName;
        }
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
    if (navLabel && pane && allBooksCache) {
      const book = allBooksCache.find((b) => b.bookNumber === pane.bookNumber);
      if (book) {
        navLabel.textContent = `${book.shortName} ${pane.chapter}`;
        pane.bookShortName = book.shortName;
      }
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

  function bookNameResolver(pane) {
    return (bookNumber) => {
      const b = pane.books.find((bk) => bk.bookNumber === bookNumber);
      if (b) return b.shortName;
      if (allBooksCache) {
        const fb = allBooksCache.find((bk) => bk.bookNumber === bookNumber);
        if (fb) return fb.shortName;
      }
      return String(bookNumber);
    };
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
      if (book) pane.bookShortName = book.shortName;
      BibleView.renderChapter(content, verses, pane.hasStrongs, pane.bookNumber, {
        crossRefs,
        crossRefMode: crossRefModules ? 'inline' : 'none',
        bookNameResolver: bookNameResolver(pane),
      });

      const wrapper = content.querySelector('.verse-text');
      if (wrapper && book) {
        wrapper.dataset.bookShort = book.shortName;
        wrapper.dataset.chapter = pane.chapter;
      }

      const navBtnLabel = el.querySelector('.nav-btn-label');
      if (navBtnLabel && book) {
        navBtnLabel.textContent = `${book.shortName} ${pane.chapter}`;
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
            prevLabelEl.textContent = `${book.shortName} ${pane.chapter - 1}`;
            prevBtnEl.style.display = '';
          } else if (bookIdx > 0) {
            prevLabelEl.textContent = pane.books[bookIdx - 1].shortName;
            prevBtnEl.style.display = '';
          } else {
            prevLabelEl.textContent = '';
            prevBtnEl.style.display = 'none';
          }
        }

        if (nextBtnEl && nextLabelEl) {
          if (pane.chapter < chapterCount) {
            nextLabelEl.textContent = `${book.shortName} ${pane.chapter + 1}`;
            nextBtnEl.style.display = '';
          } else if (bookIdx < pane.books.length - 1) {
            nextLabelEl.textContent = `${pane.books[bookIdx + 1].shortName} 1`;
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
      const book = pane.books.find((b) => b.bookNumber === pane.bookNumber);
      const name = book?.shortName || pane.bookShortName;
      if (name) {
        navBtnLabel.textContent = `${name} ${pane.chapter}`;
      }
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
    if (linkTargetPaneId && panes[linkTargetPaneId] && panes[linkTargetPaneId].paneType === 'bible') {
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
    const syncTarget = newPaneType === 'commentary'
      ? (orig.paneType === 'bible' ? paneId
        : (panes[activePaneId]?.paneType === 'bible' ? activePaneId : findFirstBiblePaneId()))
      : null;

    const newPaneId = createPaneState({
      paneType: newPaneType,
      moduleId: newPaneType === 'commentary' ? (commentaryModules.length > 0 ? commentaryModules[0].id : null) : orig.moduleId,
      bookNumber: orig.bookNumber,
      chapter: orig.chapter,
      syncedToPaneId: syncTarget,
    });

    const newPane = panes[newPaneId];
    if (newPaneType === 'bible') {
      newPane.hasStrongs = orig.hasStrongs || false;
    }

    const parent = findParent(tree, paneId);
    const leaf = { type: 'leaf', paneId };
    const newLeaf = { type: 'leaf', paneId: newPaneId };

    const el = document.querySelector(`[data-pane-id="${paneId}"]`);
    const size = direction === 'h' ? (el ? el.offsetWidth : 400) : el ? el.offsetHeight : 300;
    const halfSize = Math.floor(size / 2);

    const splitNode = {
      type: 'split',
      direction,
      children: [leaf, newLeaf],
      sizes: [halfSize, halfSize],
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
    notifyVerseClick,
  };
})();

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
  let onStateChange = null;
  let activePaneId = null;
  let linkTargetPaneId = null;
  let allBooksCache = null;
  let initialLoadPending = new Set();
  let initialLoadPromise = Promise.resolve();
  let resolveInitialLoad = null;

  const root = () => document.getElementById('pane-root');

  function init(moduleList, savedState) {
    modules = moduleList;

    if (!restoreState(savedState)) {
      const paneId = createPaneState();
      tree = { type: 'leaf', paneId };
      activePaneId = paneId;
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
    const id = initial.id || ('pane-' + (++paneCounter));
    paneCounter = Math.max(paneCounter, parsePaneNumber(id));

    const moduleId = resolveModuleId(initial.moduleId);
    const mod = modules.find(m => m.id === moduleId) || modules[0] || null;

    panes[id] = {
      id,
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

    return id;
  }

  function parsePaneNumber(id) {
    const match = String(id || '').match(/^pane-(\d+)$/);
    return match ? parseInt(match[1], 10) : 0;
  }

  function resolveModuleId(candidate) {
    const bibleModules = modules.filter(m => m.type === 'bible');
    if (candidate && bibleModules.some(m => m.id === candidate)) return candidate;
    return bibleModules.length > 0 ? bibleModules[0].id : null;
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
      const moduleId = resolveModuleId(raw.moduleId);
      const mod = modules.find(m => m.id === moduleId) || modules[0] || null;

      nextPanes[paneId] = {
        id: paneId,
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
      serializablePanes[pane.id] = {
        moduleId: pane.moduleId,
        bookNumber: pane.bookNumber,
        chapter: pane.chapter,
        bookShortName: pane.bookShortName,
      };
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
    if (node.type === 'leaf') return [node.paneId];
    return [...getAllLeafIds(node.children[0]), ...getAllLeafIds(node.children[1])];
  }

  function cycleActivePane() {
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
      if (pane.books.length === 0 && pane.moduleId) {
        loadPaneData(pane.id);
      } else if (pane.books.length > 0) {
        loadChapter(pane.id);
      }
    }
  }

  function renderNode(node) {
    if (node.type === 'leaf') {
      return createPaneElement(node.paneId);
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

  function createPaneElement(paneId) {
    const pane = panes[paneId];
    const el = document.createElement('div');
    el.className = 'pane-shell flex flex-col h-full w-full min-w-0 min-h-0';
    el.dataset.paneId = paneId;
    el.addEventListener('mousedown', () => setActivePane(paneId));

    const toolbar = document.createElement('div');
    toolbar.className = 'pane-toolbar flex items-center gap-1 px-2 py-1 border-b border-brand-300 dark:border-night-600 bg-brand-100 dark:bg-night-800 flex-shrink-0';

    const select = document.createElement('select');
    select.className = 'app-select pl-2 pr-8 py-1 mr-1 rounded-md border border-brand-400 dark:border-night-500 bg-brand-50 dark:bg-night-700 text-sm text-brand-900 dark:text-night-50 cursor-pointer';
    const sortedModules = [...modules].filter(m => m.type === 'bible').sort((a, b) =>
      a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' })
    );
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
      const mod = modules.find(m => m.id === select.value);
      pane.hasStrongs = mod ? mod.hasStrongs : false;
      pane.books = [];
      pane.verses = [];
      await loadPaneData(paneId);
      emitStateChange();
    });

    const prevBtn = document.createElement('button');
    prevBtn.className = 'nav-prev-btn px-2 py-1 rounded-md hover:bg-brand-200 dark:hover:bg-night-600 cursor-pointer transition-colors inline-flex items-center justify-center gap-1';
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
    navBtn.className = 'nav-btn px-3 py-1 rounded-md hover:bg-brand-200 dark:hover:bg-night-600 cursor-pointer transition-colors text-sm font-medium min-w-[80px] inline-flex items-center justify-center gap-1.5';
    navBtn.appendChild(Icons.create('ellipsis', 'w-4 h-4 text-brand-600 dark:text-night-300'));
    const navBtnLabel = document.createElement('span');
    navBtnLabel.className = 'nav-btn-label';
    navBtnLabel.textContent = '...';
    navBtn.appendChild(navBtnLabel);
    navBtn.addEventListener('click', async () => {
      const books = await window.api.getBooks(pane.moduleId);
      Navigation.open(paneId, books);
    });

    const nextBtn = document.createElement('button');
    nextBtn.className = 'nav-next-btn px-2 py-1 rounded-md hover:bg-brand-200 dark:hover:bg-night-600 cursor-pointer transition-colors inline-flex items-center justify-center gap-1';
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
    backBtn.className = 'pane-back-btn px-2 py-1 rounded-md hover:bg-brand-200 dark:hover:bg-night-600 cursor-pointer transition-colors inline-flex items-center justify-center hidden';
    backBtn.appendChild(Icons.create('arrow-left'));
    backBtn.title = I18n.t('crossRefBackTooltip');
    backBtn.addEventListener('click', () => navBack(paneId));

    const pinBtn = document.createElement('button');
    pinBtn.className = 'pane-pin-btn px-2 py-1 rounded-md hover:bg-brand-200 dark:hover:bg-night-600 cursor-pointer transition-colors inline-flex items-center justify-center';
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

    const copyBtn = document.createElement('button');
    copyBtn.className = 'pane-copy-btn px-2 py-1 rounded-md hover:bg-brand-200 dark:hover:bg-night-600 cursor-pointer transition-colors inline-flex items-center justify-center hidden';
    copyBtn.appendChild(Icons.create('copy'));
    copyBtn.setAttribute('data-i18n-title', 'copySelection');
    copyBtn.title = I18n.t('copySelection');

    const spacer = document.createElement('div');
    spacer.className = 'flex-1';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'px-2 py-1 rounded-md hover:bg-brand-200 dark:hover:bg-night-700 text-brand-500 dark:text-night-400 hover:text-brand-700 dark:hover:text-night-200 cursor-pointer transition-colors text-sm inline-flex items-center justify-center';
    closeBtn.appendChild(Icons.create('x'));
    closeBtn.title = I18n.t('closePane');
    closeBtn.addEventListener('click', () => closePane(paneId));

    toolbar.append(select, navGroup, spacer, backBtn, pinBtn, copyBtn, closeBtn);

    const content = document.createElement('div');
    content.className = 'pane-content flex-1 overflow-y-auto';

    el.appendChild(toolbar);
    el.appendChild(content);
    return el;
  }

  function createDivider(node) {
    const div = document.createElement('div');
    div.className = 'split-divider ' + (node.direction === 'h' ? 'split-divider-h' : 'split-divider-v');

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

      const bookExists = pane.books.find(b => b.bookNumber === pane.bookNumber);
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

  function getCrossRefModules() {
    if (typeof AppStateStore === 'undefined') return null;
    return AppStateStore.getSettings().crossRefModules || null;
  }

  function bookNameResolver(pane) {
    return (bookNumber) => {
      const b = pane.books.find(bk => bk.bookNumber === bookNumber);
      if (b) return b.shortName;
      if (allBooksCache) {
        const fb = allBooksCache.find(bk => bk.bookNumber === bookNumber);
        if (fb) return fb.shortName;
      }
      return String(bookNumber);
    };
  }

  function updateBackBtn(paneId) {
    const pane = panes[paneId];
    const el = document.querySelector(`[data-pane-id="${paneId}"]`);
    if (!el || !pane) return;
    const btn = el.querySelector('.pane-back-btn');
    if (!btn) return;
    if (pane.navHistoryIdx >= 0) {
      btn.classList.remove('hidden');
    } else {
      btn.classList.add('hidden');
    }
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
    if (!pane || pane.navHistoryIdx < 0) return;
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

      const [verses, crossRefs, chapterCount] = await Promise.all([fetchVersesP, fetchCrossRefsP, fetchChapterCountP]);
      pane.verses = verses;

      if (verses.length === 0) {
        renderUnavailableMessage(paneId, 'chapter');
        return;
      }

      const el = document.querySelector(`[data-pane-id="${paneId}"]`);
      if (!el) return;

      const content = el.querySelector('.pane-content');
      const book = pane.books.find(b => b.bookNumber === pane.bookNumber);
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
        const bookIdx = pane.books.findIndex(b => b.bookNumber === pane.bookNumber);
        const prevLabelEl = el.querySelector('.nav-prev-label');
        const nextLabelEl = el.querySelector('.nav-next-label');
        const prevBtnEl = el.querySelector('.nav-prev-btn');
        const nextBtnEl = el.querySelector('.nav-next-btn');

        if (prevBtnEl && prevLabelEl) {
          if (pane.chapter > 1) {
            prevLabelEl.textContent = `${book.shortName} ${pane.chapter - 1}`;
            prevBtnEl.classList.remove('hidden');
          } else if (bookIdx > 0) {
            prevLabelEl.textContent = pane.books[bookIdx - 1].shortName;
            prevBtnEl.classList.remove('hidden');
          } else {
            prevLabelEl.textContent = '';
            prevBtnEl.classList.add('hidden');
          }
        }

        if (nextBtnEl && nextLabelEl) {
          if (pane.chapter < chapterCount) {
            nextLabelEl.textContent = `${book.shortName} ${pane.chapter + 1}`;
            nextBtnEl.classList.remove('hidden');
          } else if (bookIdx < pane.books.length - 1) {
            nextLabelEl.textContent = `${pane.books[bookIdx + 1].shortName} 1`;
            nextBtnEl.classList.remove('hidden');
          } else {
            nextLabelEl.textContent = '';
            nextBtnEl.classList.add('hidden');
          }
        }
      }

      if (scrollToVerse) {
        setTimeout(() => BibleView.scrollToVerse(content, scrollToVerse), 100);
      } else {
        content.scrollTop = 0;
      }
    } catch (err) {
      console.error('Failed to load chapter:', err);
      renderUnavailableMessage(paneId, 'chapter');
    } finally {
      markInitialLoaded(paneId);
    }
  }

  function reloadAllChapters() {
    for (const pane of Object.values(panes)) {
      if (pane.books.length > 0) loadChapter(pane.id);
    }
  }

  async function navigatePane(paneId, bookNumber, chapter, verse) {
    const pane = panes[paneId];
    if (!pane) return;
    pushNavHistory(paneId);
    pane.bookNumber = bookNumber;
    pane.chapter = chapter;
    await loadChapter(paneId, verse || null);
    updateBackBtn(paneId);
    emitStateChange();
  }

  async function prevChapter(paneId) {
    const pane = panes[paneId];
    if (!pane) return;
    if (!pane.books.find(b => b.bookNumber === pane.bookNumber)) return;

    if (pane.chapter > 1) {
      pane.chapter--;
    } else {
      const idx = pane.books.findIndex(b => b.bookNumber === pane.bookNumber);
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
    if (!pane.books.find(b => b.bookNumber === pane.bookNumber)) return;

    const count = await window.api.getChapterCount(pane.moduleId, pane.bookNumber);
    if (pane.chapter < count) {
      pane.chapter++;
    } else {
      const idx = pane.books.findIndex(b => b.bookNumber === pane.bookNumber);
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
    msg.textContent = type === 'book'
      ? I18n.t('bookUnavailable')
      : I18n.t('chapterUnavailable');
    content.appendChild(msg);

    const navBtnLabel = el.querySelector('.nav-btn-label');
    if (navBtnLabel) {
      const book = pane.books.find(b => b.bookNumber === pane.bookNumber);
      const name = book?.shortName || pane.bookShortName;
      if (name) {
        navBtnLabel.textContent = `${name} ${pane.chapter}`;
      }
    }
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
    if (linkTargetPaneId && panes[linkTargetPaneId]) return linkTargetPaneId;
    return fallbackPaneId;
  }

  function updatePinButtons() {
    document.querySelectorAll('[data-pane-id]').forEach(el => {
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

  function splitPane(paneId, direction) {
    const newPaneId = createPaneState();

    const orig = panes[paneId];
    const newPane = panes[newPaneId];
    newPane.moduleId = orig.moduleId;
    newPane.hasStrongs = orig.hasStrongs;
    newPane.bookNumber = orig.bookNumber;
    newPane.chapter = orig.chapter;

    const parent = findParent(tree, paneId);
    const leaf = { type: 'leaf', paneId };
    const newLeaf = { type: 'leaf', paneId: newPaneId };

    const el = document.querySelector(`[data-pane-id="${paneId}"]`);
    const size = direction === 'h' ? (el ? el.offsetWidth : 400) : (el ? el.offsetHeight : 300);
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
      const idx = parent.children.findIndex(c =>
        c.type === 'leaf' ? c.paneId === paneId : false
      ) ?? findSplitChildIndex(parent, paneId);
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
    return node.children.some(c => containsPane(c, paneId));
  }

  function closePane(paneId) {
    if (tree.type === 'leaf') return;

    const parent = findParent(tree, paneId);
    if (!parent) return;

    const idx = parent.children.findIndex(c => c.type === 'leaf' && c.paneId === paneId);
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

  return { init, waitForInitialLoad, getPane, navigatePane, render, getState, setStateChangeListener, splitActivePane, cycleActivePane, getActivePaneId, setActivePane, reloadAllChapters, getNavigationTarget };
})();

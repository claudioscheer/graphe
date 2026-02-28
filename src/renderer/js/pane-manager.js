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

    render();
    emitStateChange();
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
    };

    return id;
  }

  function parsePaneNumber(id) {
    const match = String(id || '').match(/^pane-(\d+)$/);
    return match ? parseInt(match[1], 10) : 0;
  }

  function resolveModuleId(candidate) {
    if (candidate && modules.some(m => m.id === candidate)) return candidate;
    return modules.length > 0 ? modules[0].id : null;
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
      };

      maxCounter = Math.max(maxCounter, parsePaneNumber(paneId));
    }

    panes = nextPanes;
    tree = restoredTree;
    paneCounter = maxCounter;
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
    el.className = 'flex flex-col h-full w-full min-w-0 min-h-0';
    el.dataset.paneId = paneId;
    el.addEventListener('mousedown', () => setActivePane(paneId));

    const toolbar = document.createElement('div');
    toolbar.className = 'pane-toolbar flex items-center gap-1 px-2 py-1 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex-shrink-0';

    const select = document.createElement('select');
    select.className = 'app-select pl-2 pr-8 py-1 mr-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 cursor-pointer';
    const sortedModules = [...modules].sort((a, b) =>
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
    prevBtn.className = 'px-2 py-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 cursor-pointer transition-colors inline-flex items-center justify-center';
    prevBtn.appendChild(Icons.create('chevron-left'));
    prevBtn.title = I18n.t('prevChapter');
    prevBtn.addEventListener('click', () => prevChapter(paneId));

    const navBtn = document.createElement('button');
    navBtn.className = 'nav-btn px-3 py-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 cursor-pointer transition-colors text-sm font-medium min-w-[80px] inline-flex items-center justify-center gap-1.5';
    navBtn.appendChild(Icons.create('ellipsis', 'w-4 h-4 text-gray-500 dark:text-gray-400'));
    const navBtnLabel = document.createElement('span');
    navBtnLabel.className = 'nav-btn-label';
    navBtnLabel.textContent = '...';
    navBtn.appendChild(navBtnLabel);
    navBtn.addEventListener('click', async () => {
      const books = await window.api.getBooks(pane.moduleId);
      Navigation.open(paneId, books);
    });

    const nextBtn = document.createElement('button');
    nextBtn.className = 'px-2 py-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 cursor-pointer transition-colors inline-flex items-center justify-center';
    nextBtn.appendChild(Icons.create('chevron-right'));
    nextBtn.title = I18n.t('nextChapter');
    nextBtn.addEventListener('click', () => nextChapter(paneId));

    const spacer = document.createElement('div');
    spacer.className = 'flex-1';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'px-2 py-1 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 cursor-pointer transition-colors text-sm inline-flex items-center justify-center';
    closeBtn.appendChild(Icons.create('x'));
    closeBtn.title = I18n.t('closePane');
    closeBtn.addEventListener('click', () => closePane(paneId));

    toolbar.append(select, prevBtn, navBtn, nextBtn, spacer, closeBtn);

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
    if (!pane || !pane.moduleId) return;

    pane.books = await window.api.getBooks(pane.moduleId);

    const bookExists = pane.books.find(b => b.bookNumber === pane.bookNumber);
    if (!bookExists) {
      renderUnavailableMessage(paneId, 'book');
      return;
    }

    await loadChapter(paneId);
  }

  async function loadChapter(paneId, scrollToVerse) {
    const pane = panes[paneId];
    if (!pane || !pane.moduleId) return;

    const verses = await window.api.getChapter(pane.moduleId, pane.bookNumber, pane.chapter);
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
    BibleView.renderChapter(content, verses, pane.hasStrongs);

    const wrapper = content.querySelector('.verse-text');
    if (wrapper && book) {
      wrapper.dataset.bookShort = book.shortName;
      wrapper.dataset.chapter = pane.chapter;
    }

    const navBtnLabel = el.querySelector('.nav-btn-label');
    if (navBtnLabel && book) {
      navBtnLabel.textContent = `${book.shortName} ${pane.chapter}`;
    }

    if (scrollToVerse) {
      setTimeout(() => BibleView.scrollToVerse(content, scrollToVerse), 100);
    } else {
      content.scrollTop = 0;
    }
  }

  async function navigatePane(paneId, bookNumber, chapter, verse) {
    const pane = panes[paneId];
    if (!pane) return;
    pane.bookNumber = bookNumber;
    pane.chapter = chapter;
    await loadChapter(paneId, verse || null);
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

  return { init, getPane, navigatePane, render, getState, setStateChangeListener, splitActivePane, cycleActivePane, getActivePaneId, setActivePane };
})();

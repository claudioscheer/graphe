/**
 * pane-manager.js — Recursive binary split pane system
 *
 * Tree structure:
 *   Node = { type: 'leaf', paneId } | { type: 'split', direction: 'h'|'v', children: [Node, Node], sizes: [px, px] }
 *
 * Each leaf has a corresponding pane state stored in `panes` map.
 */
const PaneManager = (() => {
  let tree = null;
  let panes = {};
  let paneCounter = 0;
  let modules = [];

  const root = () => document.getElementById('pane-root');

  function init(moduleList) {
    modules = moduleList;
    const paneId = createPaneState();
    tree = { type: 'leaf', paneId };
    render();
  }

  function createPaneState() {
    const id = 'pane-' + (++paneCounter);
    panes[id] = {
      id,
      moduleId: modules.length > 0 ? modules[0].id : null,
      hasStrongs: modules.length > 0 ? modules[0].hasStrongs : false,
      bookNumber: 10, // Genesis
      chapter: 1,
      books: [],
      verses: [],
    };
    return id;
  }

  function getPane(paneId) {
    return panes[paneId] || null;
  }

  // ---- Rendering the tree into DOM ----

  function render() {
    const r = root();
    r.innerHTML = '';
    const el = renderNode(tree, r);
    r.appendChild(el);

    for (const pane of Object.values(panes)) {
      if (pane.books.length === 0 && pane.moduleId) {
        loadPaneData(pane.id);       // first load
      } else if (pane.books.length > 0) {
        loadChapter(pane.id);        // re-render existing data
      }
    }
  }

  function renderNode(node, parentEl) {
    if (node.type === 'leaf') {
      return createPaneElement(node.paneId);
    }

    // Split container
    const container = document.createElement('div');
    container.className = 'flex h-full w-full';
    container.style.flexDirection = node.direction === 'h' ? 'row' : 'column';

    const child0El = renderNode(node.children[0], container);
    const divider = createDivider(node);
    const child1El = renderNode(node.children[1], container);

    // Set sizes
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

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'pane-toolbar flex items-center gap-1 px-2 py-1 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex-shrink-0';

    // Module select
    const select = document.createElement('select');
    select.className = 'app-select pl-2 pr-8 py-1 mr-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 cursor-pointer';
    for (const m of modules) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.id;
      opt.title = m.description;
      if (m.id === pane.moduleId) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      pane.moduleId = select.value;
      const mod = modules.find(m => m.id === select.value);
      pane.hasStrongs = mod ? mod.hasStrongs : false;
      loadPaneData(paneId);
    });

    // Prev chapter
    const prevBtn = document.createElement('button');
    prevBtn.className = 'px-2 py-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 cursor-pointer transition-colors text-lg';
    prevBtn.textContent = '‹';
    prevBtn.title = I18n.t('prevChapter');
    prevBtn.addEventListener('click', () => prevChapter(paneId));

    // Nav button (shows current location)
    const navBtn = document.createElement('button');
    navBtn.className = 'nav-btn px-3 py-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 cursor-pointer transition-colors text-sm font-medium min-w-[80px] text-center';
    navBtn.textContent = '...';
    navBtn.addEventListener('click', async () => {
      const books = await window.api.getBooks(pane.moduleId);
      Navigation.open(paneId, books);
    });

    // Next chapter
    const nextBtn = document.createElement('button');
    nextBtn.className = 'px-2 py-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 cursor-pointer transition-colors text-lg';
    nextBtn.textContent = '›';
    nextBtn.title = I18n.t('nextChapter');
    nextBtn.addEventListener('click', () => nextChapter(paneId));

    // Spacer
    const spacer = document.createElement('div');
    spacer.className = 'flex-1';

    // Split H button
    const splitHBtn = document.createElement('button');
    splitHBtn.className = 'px-2 py-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 cursor-pointer transition-colors text-sm';
    splitHBtn.textContent = '⬓';
    splitHBtn.title = I18n.t('splitH');
    splitHBtn.addEventListener('click', () => splitPane(paneId, 'h'));

    // Split V button
    const splitVBtn = document.createElement('button');
    splitVBtn.className = 'px-2 py-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 cursor-pointer transition-colors text-sm';
    splitVBtn.textContent = '⬒';
    splitVBtn.title = I18n.t('splitV');
    splitVBtn.addEventListener('click', () => splitPane(paneId, 'v'));

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'px-2 py-1 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 cursor-pointer transition-colors text-sm';
    closeBtn.textContent = '✕';
    closeBtn.title = I18n.t('closePane');
    closeBtn.addEventListener('click', () => closePane(paneId));

    toolbar.append(select, prevBtn, navBtn, nextBtn, spacer, splitHBtn, splitVBtn, closeBtn);

    // Content area
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

        // Update DOM directly without full re-render
        const container = div.parentElement;
        const firstChild = container.children[0];
        const dim = node.direction === 'h' ? 'width' : 'height';
        firstChild.style[dim] = newSize + 'px';
      };

      const onUp = () => {
        div.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
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

    // Find the pane DOM element and render
    const el = document.querySelector(`[data-pane-id="${paneId}"]`);
    if (!el) return;

    const content = el.querySelector('.pane-content');
    BibleView.renderChapter(content, verses, pane.hasStrongs);

    // Update nav button label
    const book = pane.books.find(b => b.bookNumber === pane.bookNumber);
    const navBtn = el.querySelector('.nav-btn');
    if (navBtn && book) {
      navBtn.textContent = `${book.shortName} ${pane.chapter}`;
    }

    if (scrollToVerse) {
      setTimeout(() => BibleView.scrollToVerse(content, scrollToVerse), 100);
    }
  }

  async function navigatePane(paneId, bookNumber, chapter, verse) {
    const pane = panes[paneId];
    if (!pane) return;
    pane.bookNumber = bookNumber;
    pane.chapter = chapter;
    await loadChapter(paneId, verse || null);
  }

  async function prevChapter(paneId) {
    const pane = panes[paneId];
    if (!pane) return;

    if (pane.chapter > 1) {
      pane.chapter--;
    } else {
      // Go to previous book's last chapter
      const idx = pane.books.findIndex(b => b.bookNumber === pane.bookNumber);
      if (idx > 0) {
        const prevBook = pane.books[idx - 1];
        const count = await window.api.getChapterCount(pane.moduleId, prevBook.bookNumber);
        pane.bookNumber = prevBook.bookNumber;
        pane.chapter = count;
      }
    }
    await loadChapter(paneId);
  }

  async function nextChapter(paneId) {
    const pane = panes[paneId];
    if (!pane) return;

    const count = await window.api.getChapterCount(pane.moduleId, pane.bookNumber);
    if (pane.chapter < count) {
      pane.chapter++;
    } else {
      // Go to next book's first chapter
      const idx = pane.books.findIndex(b => b.bookNumber === pane.bookNumber);
      if (idx < pane.books.length - 1) {
        pane.bookNumber = pane.books[idx + 1].bookNumber;
        pane.chapter = 1;
      }
    }
    await loadChapter(paneId);
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

    const navBtn = el.querySelector('.nav-btn');
    if (navBtn) {
      const book = pane.books.find(b => b.bookNumber === pane.bookNumber);
      navBtn.textContent = book
        ? `${book.shortName} ${pane.chapter}`
        : `#${pane.bookNumber} ${pane.chapter}`;
    }
  }

  // ---- Split / Close ----

  function splitPane(paneId, direction) {
    const newPaneId = createPaneState();

    // Copy current pane's location to the new pane
    const orig = panes[paneId];
    const newPane = panes[newPaneId];
    newPane.moduleId = orig.moduleId;
    newPane.hasStrongs = orig.hasStrongs;
    newPane.bookNumber = orig.bookNumber;
    newPane.chapter = orig.chapter;

    // Find the leaf in the tree and replace it with a split
    const parent = findParent(tree, paneId);
    const leaf = { type: 'leaf', paneId };
    const newLeaf = { type: 'leaf', paneId: newPaneId };

    // Calculate initial size (half of the pane's current dimension)
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
      // Splitting the root
      tree = splitNode;
    } else {
      const idx = parent.children.findIndex(c =>
        c.type === 'leaf' ? c.paneId === paneId : false
      ) ?? findSplitChildIndex(parent, paneId);
      parent.children[idx] = splitNode;
    }

    render();
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
    // Don't close the last pane
    if (tree.type === 'leaf') return;

    const parent = findParent(tree, paneId);
    if (!parent) return;

    // Find sibling
    const idx = parent.children.findIndex(c => c.type === 'leaf' && c.paneId === paneId);
    if (idx === -1) return;
    const sibling = parent.children[1 - idx];

    // Replace parent with sibling in grandparent
    const grandparent = findParentOfNode(tree, parent);
    if (!grandparent) {
      tree = sibling;
    } else {
      const pIdx = grandparent.children.indexOf(parent);
      grandparent.children[pIdx] = sibling;
    }

    delete panes[paneId];
    render();
  }

  function findParentOfNode(root, target) {
    if (root.type === 'leaf') return null;
    for (let i = 0; i < root.children.length; i++) {
      if (root.children[i] === target) return root;
      const found = findParentOfNode(root.children[i], target);
      if (found) return found;
    }
    return null;
  }

  return { init, getPane, navigatePane, render };
})();

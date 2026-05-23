/**
 * pane-manager.js — Recursive binary split pane system
 *
 * Tree structure:
 *   Node = { type: 'leaf', paneId } | { type: 'split', direction: 'h'|'v', children: [Node, Node], ratio: number }
 */
import { AppStateStore } from './app-state-store.js';
import { BibleView } from './bible-view.js';
import { CommentaryView } from './commentary-view.js';
import { I18n } from './i18n.js';
import { Icons } from './icons.js';
import { ModulePicker } from './module-picker.js';
import { Navigation } from './navigation.js';
import { compactRanges } from './commentary-coverage.js';
import {
  allocatePaneLabel,
  ensureWindowLabels,
  getPaneDisplayLabel,
  normalizeWindowLabel,
  parsePaneNumber,
} from './pane-labels.js';
import type {
  LeafNode,
  NavDirection,
  NavHistoryEntry,
  PaneManagerSerializedState,
  PaneStateRecord,
  PaneTreeNode,
  PaneType,
  RawPaneRecord,
  RawSavedState,
  SerializablePaneRecord,
  SplitDirection,
  SplitNode,
} from './pane-model.js';
import {
  clampRatio,
  findParent,
  findParentOfNode,
  findSplitChildIndex,
  getAllLeafIds,
  getFirstLeafId,
  sanitizeTree,
  serializeTree,
} from './pane-tree.js';
import {
  getNavHistoryEntries,
  hasNavBackHistory,
  hasNavForwardHistory,
  normalizeNavHistoryIndexes,
  pushNavHistoryEntry,
  sanitizeNavHistory,
} from './pane-history.js';
import { Sanitize } from './sanitize.js';
import { Utils } from './utils.js';

interface ModulePickerInstance {
  el: HTMLElement;
  setSelected(id: string | null): void;
  setModules(modules: ModuleRecord[]): void;
  destroy(): void;
  open(): void;
  _close(): void;
}

interface ModulePickerElement extends HTMLElement {
  __pickerInstance?: ModulePickerInstance;
}

type StateChangeListener = (state: PaneManagerSerializedState) => void;

export const PaneManager = (() => {
  let tree: PaneTreeNode | null = null;
  let panes: Record<string, PaneStateRecord> = {};
  let paneCounter = 0;
  let modules: ModuleRecord[] = [];
  let commentaryModules: ModuleRecord[] = [];
  let onStateChange: StateChangeListener | null = null;
  let activePaneId: string | null = null;
  let linkTargetPaneId: string | null = null;
  let allBooksCache: BookRecord[] | null = null;
  let initialLoadPending = new Set<string>();
  let initialLoadPromise: Promise<void> = Promise.resolve();
  let resolveInitialLoad: (() => void) | null = null;
  let activeNavHistoryMenu: HTMLElement | null = null;
  const NAV_HISTORY_LONG_PRESS_MS = 450;

  const root = (): HTMLElement | null => document.getElementById('pane-root');

  function init(
    moduleList: ModuleRecord[],
    savedState?: RawSavedState | null,
    commentaryModuleList: ModuleRecord[] = []
  ): void {
    modules = moduleList;
    commentaryModules = commentaryModuleList || [];

    if (!restoreState(savedState)) {
      initializeDefaultState({ includeCommentary: false });
    }

    resetInitialLoadPromise();

    ModulePicker.onFavoritesChange(() => refreshAllQuickBars());

    render();
    emitStateChange();
  }

  function setModules(moduleList: ModuleRecord[], commentaryModuleList: ModuleRecord[] = []): void {
    modules = moduleList || [];
    commentaryModules = commentaryModuleList || [];

    for (const pane of Object.values(panes)) {
      if (pane.paneType === 'commentary') {
        pane.moduleId = resolveCommentaryModuleId(pane.moduleId);
        pane.commentaryBooks = [];
        pane.entries = [];
        continue;
      }

      pane.moduleId = resolveModuleId(pane.moduleId);
      const mod = modules.find((m) => m.id === pane.moduleId) || null;
      pane.hasStrongs = mod ? mod.hasStrongs : false;
      pane.strongsPrefix = mod ? mod.strongsPrefix || null : null;
      pane.books = [];
      pane.verses = [];
      pane.navHistory = sanitizeNavHistory(pane.navHistory, modules);
    }

    render();
    emitStateChange();
  }

  function setState(savedState?: RawSavedState | null): void {
    if (!restoreState(savedState)) {
      initializeDefaultState({ includeCommentary: false });
    }
    resetInitialLoadPromise();
    render();
    emitStateChange();
  }

  function initializeDefaultState({ includeCommentary }: { includeCommentary: boolean }): void {
    panes = {};
    tree = null;
    paneCounter = 0;
    linkTargetPaneId = null;
    if (includeCommentary && commentaryModules.length > 0) {
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
      return;
    }
    const paneId = createPaneState();
    tree = { type: 'leaf', paneId };
    activePaneId = paneId;
  }

  function resetInitialLoadPromise(): void {
    initialLoadPending = new Set(Object.keys(panes));
    initialLoadPromise = new Promise((resolve) => {
      resolveInitialLoad = resolve;
      if (initialLoadPending.size === 0) resolve();
    });
  }

  function markInitialLoaded(paneId: string): void {
    if (!initialLoadPending.has(paneId)) return;
    initialLoadPending.delete(paneId);
    if (initialLoadPending.size === 0 && resolveInitialLoad) {
      resolveInitialLoad();
      resolveInitialLoad = null;
    }
  }

  function waitForInitialLoad(): Promise<void> {
    return initialLoadPromise;
  }

  function createPaneState(initial: RawPaneRecord = {}): string {
    const id = initial.id || 'pane-' + ++paneCounter;
    paneCounter = Math.max(paneCounter, parsePaneNumber(id));

    const paneType = initial.paneType || 'bible';
    const windowLabel =
      paneType === 'commentary' ? null : allocatePaneLabel(panes, paneType, initial.windowLabel);

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
        strongsPrefix: mod ? mod.strongsPrefix || null : null,
        bookNumber: Number.isInteger(initial.bookNumber) ? initial.bookNumber : 10,
        chapter: Number.isInteger(initial.chapter) ? initial.chapter : 1,
        bookShortName: initial.bookShortName || '',
        books: [],
        verses: [],
        selectedVerse: null,
        navHistory: [],
        navHistoryIdx: -1,
      };
    }

    return id;
  }

  function getBiblePaneIdsForSync(): string[] {
    return getAllLeafIds(tree).filter((id) => panes[id]?.paneType === 'bible');
  }

  function resolveModuleId(candidate?: string | null): string | null {
    const bibleModules = modules.filter((m) => m.type === 'bible');
    if (candidate && bibleModules.some((m) => m.id === candidate)) return candidate;
    return bibleModules.length > 0 ? bibleModules[0].id : null;
  }

  function resolveCommentaryModuleId(candidate?: string | null): string | null {
    if (candidate && commentaryModules.some((m) => m.id === candidate)) return candidate;
    return commentaryModules.length > 0 ? commentaryModules[0].id : null;
  }

  function restoreState(savedState?: RawSavedState | null): boolean {
    if (!savedState || typeof savedState !== 'object') return false;
    if (!savedState.tree || !savedState.panes) return false;

    const leafIds: string[] = [];
    const restoredTree = sanitizeTree(savedState.tree, leafIds);
    if (!restoredTree || leafIds.length === 0) return false;

    const nextPanes: Record<string, PaneStateRecord> = {};
    let maxCounter = 0;

    for (const paneId of leafIds) {
      const raw = savedState.panes[paneId] || {};
      const paneType = raw.paneType || 'bible';

      if (paneType === 'commentary') {
        const moduleId = resolveCommentaryModuleId(raw.moduleId);
        nextPanes[paneId] = {
          id: paneId,
          windowLabel: null,
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
          strongsPrefix: mod ? mod.strongsPrefix || null : null,
          bookNumber: Number.isInteger(raw.bookNumber) ? raw.bookNumber : 10,
          chapter: Number.isInteger(raw.chapter) ? raw.chapter : 1,
          bookShortName: raw.bookShortName || '',
          books: [],
          verses: [],
          selectedVerse: Number.isInteger(raw.selectedVerse) ? raw.selectedVerse : null,
          navHistory: sanitizeNavHistory(raw.navHistory, modules),
          navHistoryIdx: Number.isInteger(raw.navHistoryIdx) ? raw.navHistoryIdx : -1,
        };
      }

      maxCounter = Math.max(maxCounter, parsePaneNumber(paneId));
    }

    panes = nextPanes;
    ensureWindowLabels(panes);
    tree = restoredTree;
    paneCounter = maxCounter;
    activePaneId =
      typeof savedState.activePaneId === 'string' && nextPanes[savedState.activePaneId]
        ? savedState.activePaneId
        : getFirstLeafId(tree);
    linkTargetPaneId = null;
    if (savedState.linkTargetPaneId && nextPanes[savedState.linkTargetPaneId]) {
      linkTargetPaneId = savedState.linkTargetPaneId;
    }
    normalizeNavHistoryIndexes(panes);
    return true;
  }

  function getPane(paneId: string | null): PaneStateRecord | null {
    return panes[paneId] || null;
  }

  function setStateChangeListener(listener: StateChangeListener | null): void {
    onStateChange = typeof listener === 'function' ? listener : null;
  }

  function emitStateChange(): void {
    if (!onStateChange) return;
    onStateChange(getState());
  }

  function getState(): PaneManagerSerializedState {
    const serializablePanes: Record<string, SerializablePaneRecord> = {};
    for (const pane of Object.values(panes)) {
      const base: SerializablePaneRecord = {
        paneType: pane.paneType || 'bible',
        windowLabel: pane.windowLabel || null,
        moduleId: pane.moduleId,
        bookNumber: pane.bookNumber,
        chapter: pane.chapter,
        bookShortName: pane.bookShortName,
      };
      if (pane.paneType === 'commentary') {
        base.syncedToPaneId = pane.syncedToPaneId || null;
      } else {
        base.selectedVerse = Number.isInteger(pane.selectedVerse) ? pane.selectedVerse : null;
        base.navHistory = Array.isArray(pane.navHistory) ? pane.navHistory : [];
        base.navHistoryIdx = Number.isInteger(pane.navHistoryIdx) ? pane.navHistoryIdx : -1;
      }
      serializablePanes[pane.id] = base;
    }

    return {
      activePaneId,
      tree: serializeTree(tree),
      panes: serializablePanes,
      linkTargetPaneId,
    };
  }

  // ---- Active pane ----

  function cycleActivePane(): void {
    if (!tree) return;
    const ids = getAllLeafIds(tree);
    if (ids.length <= 1) return;
    const idx = ids.indexOf(activePaneId);
    setActivePane(ids[(idx + 1) % ids.length]);
  }

  function getActivePaneId(): string | null {
    return activePaneId;
  }

  function setActivePane(paneId: string | null): void {
    if (!panes[paneId]) return;
    const prev = document.querySelector(`[data-pane-id="${activePaneId}"]`);
    if (prev) prev.classList.remove('pane-active');
    activePaneId = paneId;
    const next = document.querySelector(`[data-pane-id="${paneId}"]`);
    if (next) next.classList.add('pane-active');
    document.dispatchEvent(new CustomEvent('graphe:pane-active-change', { detail: { paneId } }));
  }

  // ---- Rendering the tree into DOM ----

  function render(): void {
    const r = root();
    if (!tree) return;
    if (!r) return;
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
          loadCommentaryData(pane.id, pane.selectedVerse || null);
        } else {
          loadCommentaryChapter(pane.id);
        }
      } else {
        if (pane.books.length === 0 && pane.moduleId) {
          loadPaneData(pane.id, pane.selectedVerse || null);
        } else if (pane.books.length > 0) {
          loadChapter(pane.id, pane.selectedVerse || null);
        }
      }
    }
  }

  function renderNode(node: PaneTreeNode): HTMLElement {
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

  function createBiblePaneElement(paneId: string): HTMLElement {
    const pane = panes[paneId];
    const el = document.createElement('div');
    el.className = 'pane-shell flex flex-col h-full w-full min-w-0 min-h-0';
    el.dataset.paneId = paneId;
    el.addEventListener('mousedown', () => setActivePane(paneId));

    const toolbar = document.createElement('div');
    toolbar.className =
      'pane-toolbar flex items-center gap-1 px-2 py-1 border-b border-brand-300 dark:border-night-600 bg-brand-100 dark:bg-night-800 flex-shrink-0';

    const picker = ModulePicker.create({
      modules: Utils.sortBibleModules(modules),
      selectedId: pane.moduleId,
      moduleType: 'bible',
      className: 'rounded mr-1 text-xs',
      onChange: async (moduleId: string): Promise<void> => {
        // Push current state before switching translation
        pushNavHistory(paneId);
        const el = document.querySelector<HTMLElement>(`[data-pane-id="${paneId}"]`);
        const selectedLine = el?.querySelector<HTMLElement>('.pane-content .verse-line.verse-selected');
        const selectedVerse = selectedLine ? parseInt(selectedLine.dataset.verse, 10) : null;

        pane.moduleId = moduleId;
        const mod = modules.find((m) => m.id === moduleId);
        pane.hasStrongs = mod ? mod.hasStrongs : false;
        pane.strongsPrefix = mod ? mod.strongsPrefix || null : null;
        pane.books = [];
        pane.verses = [];
        refreshQuickBarForPane(paneId);
        await loadPaneData(paneId, selectedVerse);
        // Push new state after switch
        pushNavHistory(paneId);
        emitStateChange();
      },
    });
    const select = picker.el as ModulePickerElement;
    select.__pickerInstance = picker;
    const prevBtn = document.createElement('button');
    prevBtn.className =
      'nav-prev-btn cursor-pointer transition-colors inline-flex items-center justify-center gap-1';
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
      'nav-btn cursor-pointer transition-colors text-sm font-medium min-w-[80px] inline-flex items-center justify-center gap-1.5';
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
      'nav-next-btn cursor-pointer transition-colors inline-flex items-center justify-center gap-1';
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
    backBtn.type = 'button';
    backBtn.className =
      'pane-back-btn pane-options-menu-item cursor-pointer transition-colors inline-flex items-center';
    backBtn.disabled = true;
    backBtn.appendChild(Icons.create('arrow-left', 'w-3.5 h-3.5'));
    const backBtnLabel = document.createElement('span');
    backBtnLabel.className = 'pane-options-menu-label';
    backBtnLabel.textContent = I18n.t('crossRefBackTooltip');
    backBtn.appendChild(backBtnLabel);
    backBtn.title = I18n.t('crossRefBackTooltip');
    attachNavHistoryLongPress(backBtn, paneId, 'back');

    const forwardBtn = document.createElement('button');
    forwardBtn.type = 'button';
    forwardBtn.className =
      'pane-forward-btn pane-options-menu-item cursor-pointer transition-colors inline-flex items-center';
    forwardBtn.disabled = true;
    forwardBtn.appendChild(Icons.create('arrow-right', 'w-3.5 h-3.5'));
    const forwardBtnLabel = document.createElement('span');
    forwardBtnLabel.className = 'pane-options-menu-label';
    forwardBtnLabel.textContent = I18n.t('crossRefForwardTooltip');
    forwardBtn.appendChild(forwardBtnLabel);
    forwardBtn.title = I18n.t('crossRefForwardTooltip');
    attachNavHistoryLongPress(forwardBtn, paneId, 'forward');

    const pinBtn = document.createElement('button');
    pinBtn.type = 'button';
    pinBtn.className =
      'pane-pin-btn pane-options-menu-item cursor-pointer transition-colors inline-flex items-center';
    const isPinned = linkTargetPaneId === paneId;
    pinBtn.appendChild(Icons.create(isPinned ? 'pin' : 'pin-off'));
    const pinBtnLabel = document.createElement('span');
    pinBtnLabel.className = 'pane-options-menu-label';
    pinBtnLabel.textContent = isPinned ? I18n.t('unpinLinkTarget') : I18n.t('pinLinkTarget');
    pinBtn.appendChild(pinBtnLabel);
    pinBtn.title = isPinned ? I18n.t('unpinLinkTarget') : I18n.t('pinLinkTarget');
    if (isPinned) pinBtn.classList.add('pane-link-target');
    pinBtn.addEventListener('mousedown', (e: MouseEvent) => e.stopPropagation());
    pinBtn.addEventListener('click', () => {
      if (linkTargetPaneId === paneId) {
        clearLinkTarget();
      } else {
        setLinkTarget(paneId);
      }
    });

    const optionsWrap = document.createElement('div');
    optionsWrap.className = 'pane-options-control';
    optionsWrap.addEventListener('mousedown', (e: MouseEvent) => e.stopPropagation());

    const optionsBtn = document.createElement('button');
    optionsBtn.type = 'button';
    optionsBtn.className =
      'pane-options-btn cursor-pointer transition-colors inline-flex items-center justify-center';
    optionsBtn.appendChild(Icons.create('ellipsis'));
    optionsBtn.title = I18n.t('paneOptions');
    optionsBtn.setAttribute('aria-haspopup', 'menu');
    optionsBtn.setAttribute('aria-expanded', 'false');

    const optionsMenu = document.createElement('div');
    optionsMenu.className = 'pane-options-menu hidden';
    optionsMenu.setAttribute('role', 'menu');
    optionsMenu.tabIndex = -1;

    let isOptionsMenuOpen = false;
    let optionsMenuDocListener: ((e: MouseEvent) => void) | null = null;

    const setOptionsMenuOpen = (open: boolean): void => {
      isOptionsMenuOpen = open;
      optionsMenu.classList.toggle('hidden', !open);
      optionsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        if (!optionsMenuDocListener) {
          optionsMenuDocListener = (e: MouseEvent): void => {
            if (!optionsWrap.isConnected) {
              document.removeEventListener('mousedown', optionsMenuDocListener);
              optionsMenuDocListener = null;
              return;
            }
            if (e.target instanceof Node && !optionsWrap.contains(e.target)) setOptionsMenuOpen(false);
          };
          document.addEventListener('mousedown', optionsMenuDocListener);
        }
        optionsMenu.focus();
      } else if (optionsMenuDocListener) {
        document.removeEventListener('mousedown', optionsMenuDocListener);
        optionsMenuDocListener = null;
      }
    };

    [backBtn, forwardBtn, pinBtn].forEach((btn) => {
      btn.setAttribute('role', 'menuitem');
      btn.addEventListener('click', () => setOptionsMenuOpen(false));
    });

    optionsBtn.addEventListener('click', () => setOptionsMenuOpen(!isOptionsMenuOpen));
    optionsBtn.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' && !isOptionsMenuOpen) {
        e.preventDefault();
        setOptionsMenuOpen(true);
      } else if (e.key === 'Escape' && isOptionsMenuOpen) {
        e.preventDefault();
        setOptionsMenuOpen(false);
      }
    });
    optionsMenu.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOptionsMenuOpen(false);
        optionsBtn.focus();
      }
    });
    optionsWrap.addEventListener('focusout', () => {
      if (!isOptionsMenuOpen) return;
      setTimeout(() => {
        if (!optionsWrap.contains(document.activeElement)) setOptionsMenuOpen(false);
      }, 0);
    });
    optionsMenu.append(backBtn, forwardBtn, pinBtn);
    optionsWrap.append(optionsBtn, optionsMenu);

    const spacer = document.createElement('div');
    spacer.className = 'flex-1';

    const closeBtn = document.createElement('button');
    closeBtn.className =
      'pane-close-btn cursor-pointer transition-colors text-sm inline-flex items-center justify-center';
    closeBtn.appendChild(Icons.create('x'));
    closeBtn.title = I18n.t('closePane');
    closeBtn.addEventListener('click', () => closePane(paneId));

    const idBadge = document.createElement('span');
    idBadge.className = 'pane-id-badge';
    idBadge.textContent = getPaneDisplayLabel(panes, paneId);

    toolbar.append(idBadge, select, navGroup, spacer, optionsWrap, closeBtn);

    const content = document.createElement('div');
    content.className = 'pane-content flex-1 overflow-y-auto';

    // Quick-switch bar for favorite Bible modules
    const quickBar = document.createElement('div');
    quickBar.className = 'pane-quick-switch';
    quickBar.dataset.paneId = paneId;
    function refreshQuickBar(): void {
      const favs = (AppStateStore.getSettings().favoriteModules || {}).bible || [];
      quickBar.innerHTML = '';
      if (favs.length === 0) {
        quickBar.style.display = 'none';
        return;
      }
      quickBar.style.display = '';
      for (const favId of favs) {
        const mod = modules.find((m) => m.id === favId);
        if (!mod) continue;
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'pane-quick-pill' + (favId === pane.moduleId ? ' is-active' : '');
        pill.textContent = mod.shortTitle || mod.id;
        pill.title = Utils.getModuleDisplayName(mod);
        pill.addEventListener('click', async () => {
          if (favId === pane.moduleId) return;
          // Push current state before switching translation
          pushNavHistory(paneId);
          const paneEl = document.querySelector<HTMLElement>(`[data-pane-id="${paneId}"]`);
          const selectedLine = paneEl?.querySelector<HTMLElement>('.pane-content .verse-line.verse-selected');
          const selectedVerse = selectedLine ? parseInt(selectedLine.dataset.verse, 10) : null;
          pane.moduleId = favId;
          pane.hasStrongs = mod.hasStrongs || false;
          pane.strongsPrefix = mod.strongsPrefix || null;
          pane.books = [];
          pane.verses = [];
          picker.setSelected(favId);
          refreshQuickBar();
          await loadPaneData(paneId, selectedVerse);
          // Push new state after switch
          pushNavHistory(paneId);
          emitStateChange();
        });
        quickBar.appendChild(pill);
      }
    }
    refreshQuickBar();

    el.appendChild(toolbar);
    el.appendChild(quickBar);
    el.appendChild(content);
    return el;
  }

  function createCommentaryPaneElement(paneId: string): HTMLElement {
    const pane = panes[paneId];
    const el = document.createElement('div');
    el.className = 'pane-shell flex flex-col h-full w-full min-w-0 min-h-0';
    el.dataset.paneId = paneId;
    el.addEventListener('mousedown', () => setActivePane(paneId));

    const toolbar = document.createElement('div');
    toolbar.className =
      'pane-toolbar flex items-center gap-1 px-2 py-1 border-b border-brand-300 dark:border-night-600 bg-brand-100 dark:bg-night-800 flex-shrink-0';

    // Commentary module selector
    const commentaryPicker = ModulePicker.create({
      modules: Utils.sortCommentaryModules(commentaryModules),
      selectedId: pane.moduleId,
      moduleType: 'commentary',
      className: 'rounded mr-1 text-xs',
      onChange: async (moduleId: string): Promise<void> => {
        pane.moduleId = moduleId;
        pane.commentaryBooks = [];
        pane.entries = [];
        const selectedVerse = getSelectedVerseFromSyncedBiblePane(pane);
        await loadCommentaryData(paneId, selectedVerse);
        emitStateChange();
      },
    });
    const select = commentaryPicker.el;
    // Navigation label
    const navLabel = document.createElement('span');
    navLabel.className =
      'commentary-nav-label px-2 py-1 text-sm font-medium text-brand-700 dark:text-night-200';
    navLabel.textContent = '';

    const spacer = document.createElement('div');
    spacer.className = 'flex-1';

    // Badge with sync selector
    const badgeWrap = document.createElement('div');
    badgeWrap.className = 'commentary-badge-control';
    badgeWrap.addEventListener('mousedown', (e: MouseEvent) => e.stopPropagation());

    const biblePaneIds = getBiblePaneIdsForSync();

    if (
      !pane.syncedToPaneId ||
      !panes[pane.syncedToPaneId] ||
      panes[pane.syncedToPaneId].paneType !== 'bible'
    ) {
      pane.syncedToPaneId = null;
    }

    const badgeBtn = document.createElement('button');
    badgeBtn.type = 'button';
    badgeBtn.className = 'pane-id-badge pane-id-badge--clickable';
    badgeBtn.textContent = getPaneDisplayLabel(panes, paneId);
    badgeBtn.title = I18n.t('commentarySyncHint');
    badgeBtn.setAttribute('aria-expanded', 'false');
    badgeBtn.setAttribute('aria-haspopup', 'menu');

    const badgeMenu = document.createElement('div');
    badgeMenu.className = 'commentary-badge-menu hidden';
    badgeMenu.setAttribute('role', 'menu');
    badgeMenu.tabIndex = -1;

    let isBadgeMenuOpen = false;
    let badgeMenuDocListener: ((e: MouseEvent) => void) | null = null;

    const setBadgeMenuOpen = (open: boolean): void => {
      isBadgeMenuOpen = open;
      badgeMenu.classList.toggle('hidden', !open);
      badgeBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        if (!badgeMenuDocListener) {
          badgeMenuDocListener = (e: MouseEvent): void => {
            if (!badgeWrap.isConnected) {
              document.removeEventListener('mousedown', badgeMenuDocListener);
              badgeMenuDocListener = null;
              return;
            }
            if (e.target instanceof Node && !badgeWrap.contains(e.target)) setBadgeMenuOpen(false);
          };
          document.addEventListener('mousedown', badgeMenuDocListener);
        }
        badgeMenu.focus();
      } else if (badgeMenuDocListener) {
        document.removeEventListener('mousedown', badgeMenuDocListener);
        badgeMenuDocListener = null;
      }
    };

    const selectSyncTarget = (value: string): void => {
      pane.syncedToPaneId = value || null;
      syncCommentaryToPane(paneId);
      badgeBtn.textContent = getPaneDisplayLabel(panes, paneId);
      // Update menu selection marks
      const selectedValue = pane.syncedToPaneId || '';
      for (const item of Array.from(badgeMenu.children) as HTMLElement[]) {
        const selected = item.dataset.value === selectedValue;
        item.classList.toggle('is-selected', selected);
        item.setAttribute('aria-checked', selected ? 'true' : 'false');
      }
      setBadgeMenuOpen(false);
      emitStateChange();
    };

    const syncOptions = [
      { value: '', label: I18n.t('commentarySyncNone') },
      ...biblePaneIds.map((biblePaneId) => ({
        value: biblePaneId,
        label: `${I18n.t('commentarySyncBiblePrefix')} ${getPaneDisplayLabel(panes, biblePaneId)}`,
      })),
    ];

    for (const option of syncOptions) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'commentary-badge-menu-item';
      item.dataset.value = option.value;
      item.textContent = option.label;
      item.setAttribute('role', 'menuitemradio');
      const selected = (pane.syncedToPaneId || '') === option.value;
      item.classList.toggle('is-selected', selected);
      item.setAttribute('aria-checked', selected ? 'true' : 'false');
      item.addEventListener('click', () => selectSyncTarget(option.value));
      badgeMenu.appendChild(item);
    }

    if (biblePaneIds.length === 0) {
      pane.syncedToPaneId = null;
      badgeBtn.classList.add('opacity-60', 'cursor-not-allowed');
      badgeBtn.disabled = true;
    }

    badgeBtn.addEventListener('click', () => {
      if (badgeBtn.disabled) return;
      setBadgeMenuOpen(!isBadgeMenuOpen);
    });

    badgeBtn.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' && !isBadgeMenuOpen) {
        e.preventDefault();
        setBadgeMenuOpen(true);
      } else if (e.key === 'Escape' && isBadgeMenuOpen) {
        e.preventDefault();
        setBadgeMenuOpen(false);
      }
    });

    badgeMenu.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setBadgeMenuOpen(false);
        badgeBtn.focus();
      }
    });

    badgeWrap.addEventListener('focusout', () => {
      if (!isBadgeMenuOpen) return;
      setTimeout(() => {
        if (!badgeWrap.contains(document.activeElement)) setBadgeMenuOpen(false);
      }, 0);
    });

    badgeWrap.append(badgeBtn, badgeMenu);

    // Coverage info button
    const infoBtn = document.createElement('button');
    infoBtn.className =
      'cursor-pointer transition-colors text-sm inline-flex items-center justify-center';
    infoBtn.appendChild(Icons.create('info'));
    infoBtn.title = I18n.t('commentaryCoverage');
    infoBtn.addEventListener('click', () => openCommentaryCoverageModal(paneId));

    // All commentaries button
    const allCommBtn = document.createElement('button');
    allCommBtn.className =
      'cursor-pointer transition-colors text-sm inline-flex items-center justify-center';
    allCommBtn.appendChild(Icons.create('book-open'));
    allCommBtn.title = I18n.t('allCommentaries');
    allCommBtn.addEventListener('click', () => openAllCommentariesModal(paneId));

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className =
      'pane-close-btn cursor-pointer transition-colors text-sm inline-flex items-center justify-center';
    closeBtn.appendChild(Icons.create('x'));
    closeBtn.title = I18n.t('closePane');
    closeBtn.addEventListener('click', () => closePane(paneId));

    toolbar.append(badgeWrap, select, navLabel, spacer, allCommBtn, infoBtn, closeBtn);

    const content = document.createElement('div');
    content.className = 'pane-content flex-1 overflow-y-auto';

    el.appendChild(toolbar);
    el.appendChild(content);
    return el;
  }

  function findFirstBiblePaneId(): string | null {
    for (const id of getBiblePaneIdsForSync()) {
      if (panes[id] && panes[id].paneType === 'bible') return id;
    }
    return null;
  }

  function createDivider(node: SplitNode): HTMLElement {
    const div = document.createElement('div');
    div.className =
      'split-divider ' + (node.direction === 'h' ? 'split-divider-h' : 'split-divider-v');

    div.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault();
      div.classList.add('dragging');
      const startPos = node.direction === 'h' ? e.clientX : e.clientY;
      const container = div.parentElement;
      if (!container) return;
      const firstChild = container.children[0] as HTMLElement;
      const startSize = node.direction === 'h' ? firstChild.offsetWidth : firstChild.offsetHeight;

      const onMove = (e2: MouseEvent): void => {
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

      const onUp = (): void => {
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

  async function loadPaneData(paneId: string, scrollToVerse?: number | null): Promise<void> {
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

      await loadChapter(paneId, scrollToVerse);
    } catch (err) {
      console.error('Failed to load pane data:', err);
      renderUnavailableMessage(paneId, 'book');
    } finally {
      markInitialLoaded(paneId);
    }
  }

  // ---- Commentary data loading ----

  function getSelectedVerseFromSyncedBiblePane(commentaryPane: PaneStateRecord | null): number | null {
    if (
      !commentaryPane ||
      commentaryPane.paneType !== 'commentary' ||
      !commentaryPane.syncedToPaneId
    ) {
      return null;
    }
    const sourcePane = panes[commentaryPane.syncedToPaneId];
    if (!sourcePane || sourcePane.paneType !== 'bible') return null;

    const sourceContent = document.querySelector<HTMLElement>(
      `[data-pane-id="${commentaryPane.syncedToPaneId}"] .pane-content`
    );
    if (!sourceContent) return null;

    const selected = sourceContent.querySelector<HTMLElement>('.verse-line.verse-selected');
    if (!selected) return null;

    const verse = parseInt(selected.dataset.verse, 10);
    return Number.isFinite(verse) ? verse : null;
  }

  async function loadCommentaryData(paneId: string, scrollToVerse?: number | null): Promise<void> {
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

  async function loadCommentaryChapter(paneId: string, scrollToVerse?: number | null): Promise<void> {
    const pane = panes[paneId];
    try {
      if (!pane || !pane.moduleId) return;

      const entries = await window.api.getCommentary(pane.moduleId, pane.bookNumber, pane.chapter);
      pane.entries = entries;

      const el = document.querySelector<HTMLElement>(`[data-pane-id="${paneId}"]`);
      if (!el) return;

      const content = el.querySelector<HTMLElement>('.pane-content');

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

  function renderCommentaryUnavailable(paneId: string): void {
    const el = document.querySelector<HTMLElement>(`[data-pane-id="${paneId}"]`);
    if (!el) return;

    const content = el.querySelector<HTMLElement>('.pane-content');
    if (!content) return;
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

  function syncCommentaryToPane(commentaryPaneId: string, scrollToVerse?: number | null): void {
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

  function notifyChapterChange(paneId: string, scrollToVerse?: number | null): void {
    // When a bible pane changes chapter, notify all synced commentary panes
    for (const pane of Object.values(panes)) {
      if (pane.paneType === 'commentary' && pane.syncedToPaneId === paneId) {
        syncCommentaryToPane(pane.id, scrollToVerse);
      }
    }
  }

  function notifyVerseClick(paneId: string, verseNum: number): void {
    if (panes[paneId]) panes[paneId].selectedVerse = verseNum;
    for (const pane of Object.values(panes)) {
      if (pane.paneType === 'commentary' && pane.syncedToPaneId === paneId) {
        const el = document.querySelector<HTMLElement>(`[data-pane-id="${pane.id}"] .pane-content`);
        if (el) CommentaryView.scrollToVerse(el, verseNum);
      }
    }
  }

  function getCrossRefModules(): string[] | null {
    if (typeof AppStateStore === 'undefined') return null;
    return AppStateStore.getSettings().crossRefModules || null;
  }

  function bookNameResolver(): (bookNumber: number) => string {
    return (bookNumber: number): string => I18n.bookName(bookNumber).short;
  }

  function refreshQuickBarForPane(paneId: string): void {
    const bar = document.querySelector<HTMLElement>(`.pane-quick-switch[data-pane-id="${paneId}"]`);
    if (!bar) return;
    const pane = panes[paneId];
    if (!pane || pane.paneType !== 'bible') return;
    const favs = (AppStateStore.getSettings().favoriteModules || {}).bible || [];
    bar.innerHTML = '';
    if (favs.length === 0) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = '';
    for (const favId of favs) {
      const mod = modules.find((m) => m.id === favId);
      if (!mod) continue;
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'pane-quick-pill' + (favId === pane.moduleId ? ' is-active' : '');
      pill.textContent = mod.shortTitle || mod.id;
      pill.title = Utils.getModuleDisplayName(mod);
      pill.addEventListener('click', async () => {
        if (favId === pane.moduleId) return;
        pushNavHistory(paneId);
        const paneEl = document.querySelector<HTMLElement>(`[data-pane-id="${paneId}"]`);
        const selectedLine = paneEl?.querySelector<HTMLElement>('.pane-content .verse-line.verse-selected');
        const selectedVerse = selectedLine ? parseInt(selectedLine.dataset.verse, 10) : null;
        pane.moduleId = favId;
        pane.hasStrongs = mod.hasStrongs || false;
        pane.strongsPrefix = mod.strongsPrefix || null;
        pane.books = [];
        pane.verses = [];
        const pickerEl = paneEl?.querySelector<ModulePickerElement>('.module-picker-wrapper');
        if (pickerEl && pickerEl.__pickerInstance) {
          pickerEl.__pickerInstance.setSelected(favId);
        }
        refreshQuickBarForPane(paneId);
        await loadPaneData(paneId, selectedVerse);
        pushNavHistory(paneId);
        emitStateChange();
      });
      bar.appendChild(pill);
    }
  }

  function openPanePicker(paneId: string): void {
    const paneEl = document.querySelector<HTMLElement>(`[data-pane-id="${paneId}"]`);
    const pickerEl = paneEl?.querySelector<ModulePickerElement>('.module-picker-wrapper');
    if (pickerEl && pickerEl.__pickerInstance) {
      pickerEl.__pickerInstance.open();
    }
  }

  async function switchPaneModule(paneId: string, moduleId: string): Promise<void> {
    const pane = panes[paneId];
    if (!pane || pane.paneType !== 'bible' || pane.moduleId === moduleId) return;
    const mod = modules.find((m) => m.id === moduleId);
    if (!mod) return;

    pushNavHistory(paneId);
    const paneEl = document.querySelector<HTMLElement>(`[data-pane-id="${paneId}"]`);
    const selectedLine = paneEl?.querySelector<HTMLElement>('.pane-content .verse-line.verse-selected');
    const selectedVerse = selectedLine ? parseInt(selectedLine.dataset.verse, 10) : null;

    pane.moduleId = moduleId;
    pane.hasStrongs = mod.hasStrongs || false;
    pane.strongsPrefix = mod.strongsPrefix || null;
    pane.books = [];
    pane.verses = [];

    const pickerEl = paneEl?.querySelector<ModulePickerElement>('.module-picker-wrapper');
    if (pickerEl && pickerEl.__pickerInstance) {
      pickerEl.__pickerInstance.setSelected(moduleId);
    }
    refreshQuickBarForPane(paneId);
    await loadPaneData(paneId, selectedVerse);
    pushNavHistory(paneId);
    emitStateChange();
  }

  function refreshAllQuickBars(): void {
    for (const pane of Object.values(panes)) {
      if (pane.paneType === 'bible') {
        refreshQuickBarForPane(pane.id);
      }
    }
  }

  // Navigation history model: navHistory[idx] = current state snapshot.
  // Back = go to idx-1, forward = go to idx+1.
  // pushNavHistory records a new destination, truncating any forward entries.

  function updateNavBtns(paneId: string): void {
    const pane = panes[paneId];
    const el = document.querySelector<HTMLElement>(`[data-pane-id="${paneId}"]`);
    if (!el || !pane) return;
    const backBtn = el.querySelector<HTMLButtonElement>('.pane-back-btn');
    if (backBtn) {
      backBtn.disabled = !hasNavBackHistory(pane);
    }
    const fwdBtn = el.querySelector<HTMLButtonElement>('.pane-forward-btn');
    if (fwdBtn) {
      fwdBtn.disabled = !hasNavForwardHistory(pane);
    }
  }

  function pushNavHistory(paneId: string): void {
    const pane = panes[paneId];
    if (!pane) return;
    if (pushNavHistoryEntry(pane)) {
      updateNavBtns(paneId);
    }
  }

  async function navBack(paneId: string): Promise<void> {
    const pane = panes[paneId];
    if (!hasNavBackHistory(pane)) return;
    pane.navHistoryIdx--;
    const entry = pane.navHistory[pane.navHistoryIdx];
    await restoreNavEntry(paneId, entry);
    updateNavBtns(paneId);
    emitStateChange();
  }

  async function navForward(paneId: string): Promise<void> {
    const pane = panes[paneId];
    if (!hasNavForwardHistory(pane)) return;
    pane.navHistoryIdx++;
    const entry = pane.navHistory[pane.navHistoryIdx];
    await restoreNavEntry(paneId, entry);
    updateNavBtns(paneId);
    emitStateChange();
  }

  async function navToHistoryIndex(paneId: string, historyIndex: number): Promise<void> {
    const pane = panes[paneId];
    if (!pane || !Array.isArray(pane.navHistory)) return;
    if (historyIndex < 0 || historyIndex >= pane.navHistory.length) return;
    if (historyIndex === pane.navHistoryIdx) return;

    pane.navHistoryIdx = historyIndex;
    await restoreNavEntry(paneId, pane.navHistory[historyIndex]);
    updateNavBtns(paneId);
    emitStateChange();
  }

  function attachNavHistoryLongPress(button: HTMLButtonElement, paneId: string, direction: NavDirection): void {
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    let didOpenMenu = false;

    const clearLongPress = (): void => {
      if (!longPressTimer) return;
      clearTimeout(longPressTimer);
      longPressTimer = null;
    };

    button.addEventListener('pointerdown', (event: PointerEvent) => {
      if (button.disabled) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;

      didOpenMenu = false;
      clearLongPress();
      longPressTimer = setTimeout(() => {
        didOpenMenu = true;
        showNavHistoryMenu(paneId, direction, button);
      }, NAV_HISTORY_LONG_PRESS_MS);
    });

    button.addEventListener('pointerup', clearLongPress);
    button.addEventListener('pointercancel', clearLongPress);
    button.addEventListener('pointerleave', clearLongPress);

    button.addEventListener('click', (event: MouseEvent) => {
      if (didOpenMenu) {
        event.preventDefault();
        event.stopPropagation();
        didOpenMenu = false;
        return;
      }

      if (direction === 'back') {
        navBack(paneId);
      } else {
        navForward(paneId);
      }
    });
  }

  function showNavHistoryMenu(paneId: string, direction: NavDirection, anchorEl: HTMLElement): void {
    const pane = panes[paneId];
    const entries = getNavHistoryEntries(pane, direction);
    if (entries.length === 0) return;

    closeNavHistoryMenu();

    const menu = document.createElement('div');
    menu.className = 'pane-history-menu';
    menu.setAttribute('role', 'menu');

    for (const item of entries) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'pane-history-menu-item';
      option.setAttribute('role', 'menuitem');
      option.append(...buildNavHistoryItemContent(item.entry));
      option.addEventListener('click', () => {
        closeNavHistoryMenu();
        navToHistoryIndex(paneId, item.index);
      });
      menu.appendChild(option);
    }

    document.body.appendChild(menu);
    positionNavHistoryMenu(menu, anchorEl);
    activeNavHistoryMenu = menu;

    setTimeout(() => {
      document.addEventListener('pointerdown', handleNavHistoryOutsidePointer, true);
      document.addEventListener('keydown', handleNavHistoryKeydown, true);
      window.addEventListener('resize', closeNavHistoryMenu, { once: true });
    }, 0);
  }

  function buildNavHistoryItemContent(entry: NavHistoryEntry): HTMLElement[] {
    const reference = document.createElement('span');
    reference.className = 'pane-history-reference';
    reference.textContent = formatNavHistoryReference(entry);

    const module = modules.find((m) => m.id === entry.moduleId);
    const moduleLabel = document.createElement('span');
    moduleLabel.className = 'pane-history-module';
    moduleLabel.textContent = module ? Utils.truncateText(Utils.getModuleDisplayName(module), 34) : '';

    return moduleLabel.textContent ? [reference, moduleLabel] : [reference];
  }

  function formatNavHistoryReference(entry: NavHistoryEntry): string {
    const book = I18n.bookName(entry.bookNumber).short;
    const chapter = Number.isInteger(entry.chapter) ? entry.chapter : 1;
    const verse = Number.isInteger(entry.verse) ? `:${entry.verse}` : '';
    return `${book} ${chapter}${verse}`;
  }

  function positionNavHistoryMenu(menu: HTMLElement, anchorEl: HTMLElement): void {
    const anchorRect = anchorEl.getBoundingClientRect();
    const margin = 6;
    const menuRect = menu.getBoundingClientRect();
    const top = Math.max(margin, anchorRect.top - menuRect.height - margin);
    const left = Math.min(
      window.innerWidth - menuRect.width - margin,
      Math.max(margin, anchorRect.right - menuRect.width)
    );
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
  }

  function handleNavHistoryOutsidePointer(event: PointerEvent): void {
    if (activeNavHistoryMenu && event.target instanceof Node && !activeNavHistoryMenu.contains(event.target)) {
      closeNavHistoryMenu();
    }
  }

  function handleNavHistoryKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') closeNavHistoryMenu();
  }

  function closeNavHistoryMenu(): void {
    if (!activeNavHistoryMenu) return;
    activeNavHistoryMenu.remove();
    activeNavHistoryMenu = null;
    document.removeEventListener('pointerdown', handleNavHistoryOutsidePointer, true);
    document.removeEventListener('keydown', handleNavHistoryKeydown, true);
    window.removeEventListener('resize', closeNavHistoryMenu);
  }

  async function restoreNavEntry(paneId: string, entry: NavHistoryEntry): Promise<void> {
    const pane = panes[paneId];
    const moduleChanged = entry.moduleId && entry.moduleId !== pane.moduleId;
    pane.bookNumber = entry.bookNumber;
    pane.chapter = entry.chapter;
    if (moduleChanged) {
      pane.moduleId = entry.moduleId;
      const mod = modules.find((m) => m.id === entry.moduleId);
      pane.hasStrongs = mod ? mod.hasStrongs : false;
      pane.strongsPrefix = mod ? mod.strongsPrefix || null : null;
      pane.books = [];
      pane.verses = [];
      const el = document.querySelector<HTMLElement>(`[data-pane-id="${paneId}"]`);
      const pickerEl = el?.querySelector<ModulePickerElement>('.module-picker-wrapper');
      if (pickerEl && pickerEl.__pickerInstance) {
        pickerEl.__pickerInstance.setSelected(entry.moduleId);
      }
      refreshQuickBarForPane(paneId);
      await loadPaneData(paneId, entry.verse);
    } else {
      await loadChapter(paneId, entry.verse);
    }
  }

  async function loadChapter(paneId: string, scrollToVerse?: number | null): Promise<void> {
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

      const el = document.querySelector<HTMLElement>(`[data-pane-id="${paneId}"]`);
      if (!el) return;

      const content = el.querySelector<HTMLElement>('.pane-content');
      if (!content) return;
      const scrollRatio = content.scrollHeight > 0 ? content.scrollTop / content.scrollHeight : 0;
      const book = pane.books.find((b) => b.bookNumber === pane.bookNumber);
      pane.bookShortName = I18n.bookName(pane.bookNumber).short;
      BibleView.renderChapter(content, verses, pane.hasStrongs, pane.bookNumber, {
        crossRefs,
        crossRefMode: crossRefModules ? 'inline' : 'none',
        bookNameResolver: bookNameResolver(),
        strongsPrefix: pane.strongsPrefix,
      });

      const wrapper = content.querySelector<HTMLElement>('.verse-text');
      if (wrapper) {
        wrapper.dataset.bookShort = I18n.bookName(pane.bookNumber).short;
        wrapper.dataset.chapter = String(pane.chapter);
      }

      const navBtnLabel = el.querySelector('.nav-btn-label');
      if (navBtnLabel) {
        navBtnLabel.textContent = `${I18n.bookName(pane.bookNumber).short} ${pane.chapter}`;
      }

      // Update prev/next navigation labels
      if (book) {
        const bookIdx = pane.books.findIndex((b) => b.bookNumber === pane.bookNumber);
        const prevLabelEl = el.querySelector<HTMLElement>('.nav-prev-label');
        const nextLabelEl = el.querySelector<HTMLElement>('.nav-next-label');
        const prevBtnEl = el.querySelector<HTMLButtonElement>('.nav-prev-btn');
        const nextBtnEl = el.querySelector<HTMLButtonElement>('.nav-next-btn');

        if (prevBtnEl && prevLabelEl) {
          if (pane.chapter > 1) {
            prevLabelEl.textContent = `${I18n.bookName(pane.bookNumber).short} ${pane.chapter - 1}`;
            prevBtnEl.disabled = false;
          } else if (bookIdx > 0) {
            const prevBook = pane.books[bookIdx - 1];
            const prevBookChapterCount = await window.api.getChapterCount(
              pane.moduleId,
              prevBook.bookNumber
            );
            prevLabelEl.textContent = `${I18n.bookName(prevBook.bookNumber).short} ${prevBookChapterCount}`;
            prevBtnEl.disabled = false;
          } else {
            prevLabelEl.textContent = '';
            prevBtnEl.disabled = true;
          }
        }

        if (nextBtnEl && nextLabelEl) {
          if (pane.chapter < chapterCount) {
            nextLabelEl.textContent = `${I18n.bookName(pane.bookNumber).short} ${pane.chapter + 1}`;
            nextBtnEl.disabled = false;
          } else if (bookIdx < pane.books.length - 1) {
            nextLabelEl.textContent = `${I18n.bookName(pane.books[bookIdx + 1].bookNumber).short} 1`;
            nextBtnEl.disabled = false;
          } else {
            nextLabelEl.textContent = '';
            nextBtnEl.disabled = true;
          }
        }
      }

      if (scrollToVerse) {
        content.scrollTop = scrollRatio * content.scrollHeight;
        BibleView.scrollToVerse(content, scrollToVerse);
      } else {
        content.scrollTop = 0;
      }
      pane.selectedVerse = scrollToVerse || null;
      notifyChapterChange(paneId, scrollToVerse);
    } catch (err) {
      console.error('Failed to load chapter:', err);
      renderUnavailableMessage(paneId, 'chapter');
    } finally {
      updateNavBtns(paneId);
      markInitialLoaded(paneId);
    }
  }

  function reloadAllChapters(): void {
    for (const pane of Object.values(panes)) {
      if (pane.paneType === 'commentary') {
        if (pane.commentaryBooks.length > 0) loadCommentaryChapter(pane.id);
      } else {
        if (pane.books.length > 0) loadChapter(pane.id);
      }
    }
  }

  async function navigatePane(
    paneId: string,
    bookNumber: number,
    chapter: number,
    verse?: number | null
  ): Promise<boolean> {
    const pane = panes[paneId];
    if (!pane) return false;
    if (pane.books.length > 0 && !pane.books.find((b) => b.bookNumber === bookNumber)) {
      return false;
    }
    const prevBookNumber = pane.bookNumber;
    const prevChapter = pane.chapter;
    // Record current state before navigating
    pushNavHistory(paneId);
    pane.bookNumber = bookNumber;
    pane.chapter = chapter;
    try {
      await loadChapter(paneId, verse || null);
      // Record new destination
      pushNavHistory(paneId);
      emitStateChange();
      return true;
    } catch (err) {
      pane.bookNumber = prevBookNumber;
      pane.chapter = prevChapter;
      throw err;
    }
  }

  async function prevChapter(paneId: string): Promise<void> {
    const pane = panes[paneId];
    if (!pane) return;
    if (!pane.books.find((b) => b.bookNumber === pane.bookNumber)) return;

    pushNavHistory(paneId);
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
    pushNavHistory(paneId);
    emitStateChange();
  }

  async function nextChapter(paneId: string): Promise<void> {
    const pane = panes[paneId];
    if (!pane) return;
    if (!pane.books.find((b) => b.bookNumber === pane.bookNumber)) return;

    pushNavHistory(paneId);
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
    pushNavHistory(paneId);
    emitStateChange();
  }

  function renderUnavailableMessage(paneId: string, type: 'book' | 'chapter'): void {
    const pane = panes[paneId];
    const el = document.querySelector<HTMLElement>(`[data-pane-id="${paneId}"]`);
    if (!el) return;

    const content = el.querySelector<HTMLElement>('.pane-content');
    if (!pane || !content) return;
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
    const prevBtnEl = el.querySelector<HTMLButtonElement>('.nav-prev-btn');
    const nextBtnEl = el.querySelector<HTMLButtonElement>('.nav-next-btn');
    const prevLabelEl = el.querySelector<HTMLElement>('.nav-prev-label');
    const nextLabelEl = el.querySelector<HTMLElement>('.nav-next-label');
    if (prevBtnEl) prevBtnEl.disabled = true;
    if (nextBtnEl) nextBtnEl.disabled = true;
    if (prevLabelEl) prevLabelEl.textContent = '';
    if (nextLabelEl) nextLabelEl.textContent = '';
  }

  // ---- Link target ----

  function setLinkTarget(paneId: string): void {
    if (!panes[paneId]) return;
    linkTargetPaneId = paneId;
    updatePinButtons();
    emitStateChange();
  }

  function clearLinkTarget(): void {
    linkTargetPaneId = null;
    updatePinButtons();
    emitStateChange();
  }

  function getLinkTargetPaneId(): string | null {
    return linkTargetPaneId;
  }

  function getNavigationTarget(fallbackPaneId?: string | null): string | null {
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

  function ensureBiblePane(): string {
    const existing = findFirstBiblePaneId();
    if (existing) return existing;

    const paneId = createPaneState({ paneType: 'bible' });
    const newLeaf: LeafNode = { type: 'leaf', paneId };
    if (!tree) {
      tree = newLeaf;
    } else {
      tree = {
        type: 'split',
        direction: 'h',
        children: [tree, newLeaf],
        ratio: 0.65,
      };
    }
    activePaneId = paneId;
    render();
    emitStateChange();
    return paneId;
  }

  function updatePinButtons(): void {
    document.querySelectorAll<HTMLElement>('[data-pane-id]').forEach((el) => {
      const id = el.getAttribute('data-pane-id');
      const btn = el.querySelector<HTMLButtonElement>('.pane-pin-btn');
      if (!btn) return;
      const pinned = id === linkTargetPaneId;
      const label = btn.querySelector<HTMLElement>('.pane-options-menu-label');
      btn.replaceChildren(Icons.create(pinned ? 'pin' : 'pin-off'));
      if (label) {
        label.textContent = pinned ? I18n.t('unpinLinkTarget') : I18n.t('pinLinkTarget');
        btn.appendChild(label);
      }
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

  function splitActivePane(direction: SplitDirection): void {
    if (!activePaneId || !panes[activePaneId]) return;
    splitPane(activePaneId, direction);
  }

  function splitActivePaneWithType(direction: SplitDirection, paneType: PaneType): void {
    if (!activePaneId || !panes[activePaneId]) return;
    splitPane(activePaneId, direction, paneType);
  }

  function splitPane(paneId: string, direction: SplitDirection, forcePaneType?: PaneType): void {
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
    const leaf: LeafNode = { type: 'leaf', paneId };
    const newLeaf: LeafNode = { type: 'leaf', paneId: newPaneId };

    const splitNode: SplitNode = {
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

  function closePane(paneId: string): void {
    if (!tree) return;
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

  // Chapter counts per book (index 0=Gen, 65=Rev) — standard KJV canon
  const CHAPTER_COUNTS = [
    50, 40, 27, 36, 34, 24, 21, 4, 31, 24, 22, 25, 29, 36, 10, 13, 10, 42, 150, 31, 12, 8, 66, 52,
    5, 48, 12, 14, 3, 9, 1, 4, 7, 3, 3, 3, 2, 14, 4, 28, 16, 24, 21, 28, 16, 16, 13, 6, 6, 4, 4, 5,
    3, 6, 4, 3, 1, 13, 5, 5, 3, 5, 1, 1, 1, 22,
  ];

  async function openAllCommentariesModal(paneId: string): Promise<void> {
    const pane = panes[paneId];
    if (!pane || pane.paneType !== 'commentary') return;

    const { bookNumber, chapter } = pane;
    const selectedVerse = getSelectedVerseFromSyncedBiblePane(pane);
    const verse =
      selectedVerse || (pane.entries && pane.entries.length > 0 ? pane.entries[0].verseFrom : 1);

    const bookName = I18n.bookName(bookNumber);
    const refLabel = `${bookName.short} ${chapter}:${verse}`;

    // Fetch commentary entries from all modules in parallel
    const results = await Promise.all(
      commentaryModules.map(async (mod): Promise<{ module: ModuleRecord; entries: CommentaryEntry[] }> => {
        try {
          const entries = await window.api.getCommentary(mod.id, bookNumber, chapter);
          const matching = entries.filter(
            (e) => e.verseFrom <= verse && (e.verseTo >= verse || e.verseTo === 0)
          );
          return { module: mod, entries: matching };
        } catch {
          return { module: mod, entries: [] };
        }
      })
    );

    const withEntries = results.filter((r) => r.entries.length > 0);

    // Build overlay
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-40 bg-black/50 flex items-center justify-center';
    overlay.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.target === overlay) overlay.remove();
    });

    const modal = document.createElement('div');
    modal.className =
      'bg-brand-50 dark:bg-night-800 shadow-2xl w-[720px] max-w-[92vw] max-h-[85vh] flex flex-col overflow-hidden break-words';

    // Header
    const header = document.createElement('div');
    header.className =
      'p-4 border-b border-brand-300 dark:border-night-600 flex items-center justify-between min-w-0';
    const title = document.createElement('h2');
    title.className = 'text-lg font-semibold min-w-0 truncate';
    title.textContent = `${I18n.t('allCommentaries')} — ${refLabel}`;
    const closeBtn = document.createElement('button');
    closeBtn.className =
      'px-2 py-1 rounded-sm hover:bg-brand-200 dark:hover:bg-night-700 text-brand-500 dark:text-night-400 cursor-pointer transition-colors inline-flex items-center justify-center';
    closeBtn.appendChild(Icons.create('x'));
    closeBtn.addEventListener('click', () => overlay.remove());
    header.append(title, closeBtn);

    // Body
    const body = document.createElement('div');
    body.className = 'p-4 overflow-y-auto flex-1 min-w-0 overflow-x-hidden';

    if (withEntries.length === 0) {
      const msg = document.createElement('p');
      msg.className = 'text-brand-500 dark:text-night-400 text-sm italic';
      msg.textContent = I18n.t('allCommentariesNoResults');
      body.appendChild(msg);
    } else {
      for (const { module: mod, entries } of withEntries) {
        const section = document.createElement('div');
        section.className = 'mb-6 last:mb-0';

        const heading = document.createElement('h3');
        heading.className =
          'text-sm font-semibold text-brand-700 dark:text-night-200 mb-2 pb-1 border-b border-brand-200 dark:border-night-600 cursor-pointer flex items-center gap-1.5 select-none';

        const chevron = Icons.create('chevron-right');
        chevron.style.transition = 'transform 0.15s';
        chevron.style.transform = 'rotate(0deg)';
        chevron.style.flexShrink = '0';
        heading.appendChild(chevron);
        heading.appendChild(document.createTextNode(mod.displayName || mod.id));
        section.appendChild(heading);

        const contentWrapper = document.createElement('div');
        contentWrapper.style.display = 'none';

        for (const entry of entries) {
          const entryDiv = document.createElement('div');
          entryDiv.className = 'commentary-body text-sm mb-2';
          entryDiv.innerHTML = Sanitize.sanitizeHtml(entry.text || '');
          contentWrapper.appendChild(entryDiv);
        }

        heading.addEventListener('click', () => {
          const collapsed = contentWrapper.style.display === 'none';
          contentWrapper.style.display = collapsed ? 'block' : 'none';
          chevron.style.transform = collapsed ? 'rotate(90deg)' : 'rotate(0deg)';
        });

        section.appendChild(contentWrapper);
        body.appendChild(section);
      }
    }

    modal.append(header, body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Close on Escape
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
      }
    };
    document.addEventListener('keydown', onKey);
  }

  async function openCommentaryCoverageModal(paneId: string): Promise<void> {
    const pane = panes[paneId];
    if (!pane) return;

    const coverage = await window.api.getCommentaryCoverage(pane.moduleId);
    const bookNumbers = I18n._BOOK_NUMBERS;

    // Build overlay
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-40 bg-black/50 flex items-center justify-center';
    overlay.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.target === overlay) overlay.remove();
    });

    const modal = document.createElement('div');
    modal.className =
      'bg-brand-50 dark:bg-night-800 shadow-2xl w-[620px] max-w-[92vw] max-h-[85vh] flex flex-col overflow-hidden';

    // Header
    const header = document.createElement('div');
    header.className =
      'p-4 border-b border-brand-300 dark:border-night-600 flex items-center justify-between';
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
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
      }
    };
    document.addEventListener('keydown', onKey);
  }

  function buildCoverageCell(
    bookNumber: number,
    bookIndex: number,
    coverage: CommentaryCoverage
  ): HTMLElement {
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
      const missing: number[] = [];
      for (let ch = 1; ch <= totalChapters; ch++) {
        if (!coveredSet.has(ch)) missing.push(ch);
      }
      const missingStr = compactRanges(missing);
      cell.title = `${name.long}: ${coveredChapters.length}/${totalChapters} ${I18n.t('coverageChapters')}\n${I18n.t('coverageMissingChapters')}: ${missingStr}`;
    }

    cell.textContent = name.short;
    return cell;
  }

  return {
    init,
    setModules,
    setState,
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
    ensureBiblePane,
    getLinkTargetPaneId,
    notifyVerseClick,
    openPanePicker,
    switchPaneModule,
  };
})();

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
import { ModulePicker, type ModulePickerInstance } from './module-picker.js';
import { createBiblePaneElement as buildBiblePaneChrome } from './pane-chrome-bible.js';
import { showNavHistoryMenu as showNavHistoryMenuUi } from './pane-nav-history-menu.js';
import { createCommentaryPaneElement as buildCommentaryPaneChrome } from './pane-chrome-commentary.js';
import { Navigation } from './navigation.js';
import {
  openAllCommentariesModal as openAllCommentariesModalUi,
  openCommentaryCoverageModal as openCommentaryCoverageModalUi,
} from './commentary-modals.js';
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
  hasNavBackHistory,
  hasNavForwardHistory,
  normalizeNavHistoryIndexes,
  pushNavHistoryEntry,
  sanitizeNavHistory,
} from './pane-history.js';
import { Sanitize } from './sanitize.js';
import { Utils } from './utils.js';

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
  const NAV_HISTORY_LONG_PRESS_MS = 450;
  const pickersByPaneId = new Map<string, ModulePickerInstance>();

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
    pickersByPaneId.clear();
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
    return buildBiblePaneChrome({
      paneId,
      pane,
      panes,
      modules,
      linkTargetPaneId,
      onActivate: () => setActivePane(paneId),
      onModuleChange: (moduleId) => switchBibleModule(paneId, moduleId),
      onPrevChapter: () => prevChapter(paneId),
      onNextChapter: () => nextChapter(paneId),
      onClose: () => closePane(paneId),
      onSetLinkTarget: () => setLinkTarget(paneId),
      onClearLinkTarget: () => clearLinkTarget(),
      attachNavHistoryLongPress: (button, direction) =>
        attachNavHistoryLongPress(button, paneId, direction),
      registerPicker: (picker) => {
        pickersByPaneId.set(paneId, picker);
      },
      switchModule: (moduleId) => switchBibleModule(paneId, moduleId),
    });
  }

  function createCommentaryPaneElement(paneId: string): HTMLElement {
    const pane = panes[paneId];
    return buildCommentaryPaneChrome({
      paneId,
      pane,
      panes,
      commentaryModules,
      biblePaneIds: getBiblePaneIdsForSync(),
      onActivate: () => setActivePane(paneId),
      onModuleChange: async (moduleId) => {
        pane.moduleId = moduleId;
        pane.commentaryBooks = [];
        pane.entries = [];
        const selectedVerse = getSelectedVerseFromSyncedBiblePane(pane);
        await loadCommentaryData(paneId, selectedVerse);
        emitStateChange();
      },
      onSyncTargetChange: (syncedToPaneId) => {
        pane.syncedToPaneId = syncedToPaneId;
        syncCommentaryToPane(paneId);
        emitStateChange();
      },
      onOpenCoverage: () => {
        const p = panes[paneId];
        if (p) openCommentaryCoverageModalUi({ moduleId: p.moduleId });
      },
      onOpenAllCommentaries: () => {
        const p = panes[paneId];
        if (!p || p.paneType !== 'commentary') return;
        const selectedVerse = getSelectedVerseFromSyncedBiblePane(p);
        const verse =
          selectedVerse || (p.entries && p.entries.length > 0 ? p.entries[0].verseFrom : 1);
        openAllCommentariesModalUi({
          bookNumber: p.bookNumber,
          chapter: p.chapter,
          verse,
          commentaryModules,
        });
      },
      onClose: () => closePane(paneId),
    });
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

  function refreshQuickBarForPane(paneId: string, barEl?: HTMLElement | null): void {
    const bar =
      barEl ||
      document.querySelector<HTMLElement>(`.pane-quick-switch[data-pane-id="${paneId}"]`);
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
      pill.addEventListener('click', () => {
        void switchBibleModule(paneId, favId);
      });
      bar.appendChild(pill);
    }
  }

  function openPanePicker(paneId: string): void {
    pickersByPaneId.get(paneId)?.open();
  }

  /**
   * Switch a bible pane to another module, preserving verse selection and history.
   * Single path used by picker, quick-bar, and keyboard favorite cycling.
   */
  async function switchBibleModule(paneId: string, moduleId: string): Promise<void> {
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

    pickersByPaneId.get(paneId)?.setSelected(moduleId);
    refreshQuickBarForPane(paneId);
    await loadPaneData(paneId, selectedVerse);
    pushNavHistory(paneId);
    emitStateChange();
  }

  async function switchPaneModule(paneId: string, moduleId: string): Promise<void> {
    await switchBibleModule(paneId, moduleId);
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
    if (!pane) return;
    showNavHistoryMenuUi({
      pane,
      direction,
      anchorEl,
      modules,
      onSelectIndex: (historyIndex) => {
        void navToHistoryIndex(paneId, historyIndex);
      },
    });
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
      pickersByPaneId.get(paneId)?.setSelected(entry.moduleId);
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
    pickersByPaneId.delete(paneId);
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

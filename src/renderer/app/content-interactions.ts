/**
 * Pane content interactions: Strong's lookup, cross-refs, keyboard shortcuts, clipboard.
 */
import { AppStateStore } from './app-state-store.js';
import { AboutDialog } from './about-dialog.js';
import { BibleView } from './bible-view.js';
import { parseBibleHref } from './bible-ref.js';
import { CrossRefPreview } from './cross-ref-preview.js';
import { DictPanel } from './dict-panel.js';
import { I18n } from './i18n.js';
import { ModuleEditor } from './module-editor.js';
import { Navigation } from './navigation.js';
import { PaneManager } from './pane-manager.js';
import { SearchPanel } from './search-panel.js';
import { Settings } from './settings-dialog.js';
import { WorkspaceManager } from './workspace-manager.js';

interface SearchNavigationResult {
  moduleId: string | null;
  bookNumber: number;
  chapter: number;
  verse: number;
  openInNewWorkspace?: boolean;
}

interface MousePosition {
  x: number | null;
  y: number | null;
}

export function copySelectedVerses(paneId: string = PaneManager.getActivePaneId()): boolean {
  const el = document.querySelector<HTMLElement>(`[data-pane-id="${paneId}"] .pane-content`);
  if (!el) return false;
  const text = BibleView.getSelectedText(el);
  if (!text) return false;
  navigator.clipboard.writeText(text).catch((err) => console.warn('Clipboard write failed:', err));
  return true;
}

export function openNavigationForActivePane(): void {
  const paneId = PaneManager.getActivePaneId();
  const pane = PaneManager.getPane(paneId);
  if (!pane || !pane.moduleId) return;
  window.api
    .getBooks(pane.moduleId)
    .then((books) => Navigation.open(paneId, books))
    .catch((err) => console.warn('Failed to open navigation:', err));
}

export async function openSearchResult(result: SearchNavigationResult | null): Promise<void> {
  if (!result) return;
  const location = {
    moduleId: result.moduleId || null,
    bookNumber: result.bookNumber,
    chapter: result.chapter,
    verse: result.verse,
  };

  if (result.openInNewWorkspace) {
    WorkspaceManager.createWorkspace({
      name: `${I18n.bookName(result.bookNumber).short} ${result.chapter}`,
      location,
    });
    return;
  }

  const activePaneId = PaneManager.getActivePaneId();
  let targetPaneId = PaneManager.getNavigationTarget(activePaneId);
  let targetPane = PaneManager.getPane(targetPaneId);
  if (!targetPane || targetPane.paneType !== 'bible') {
    targetPaneId = PaneManager.ensureBiblePane();
    targetPane = PaneManager.getPane(targetPaneId);
  }
  if (!targetPane || targetPane.paneType !== 'bible') return;

  try {
    const ok = await PaneManager.navigatePane(
      targetPaneId,
      result.bookNumber,
      result.chapter,
      result.verse
    );
    if (!ok) window.showTooltip?.(targetPaneId, I18n.t('refUnavailable'));
  } catch (err) {
    console.warn('Search result navigation failed:', err);
  }
}

const lastMousePosition: MousePosition = { x: null, y: null };

document.addEventListener(
  'mousemove',
  (e: MouseEvent) => {
    lastMousePosition.x = e.clientX;
    lastMousePosition.y = e.clientY;
  },
  { passive: true }
);

function getPaneFromMousePosition(): HTMLElement | null {
  if (!Number.isFinite(lastMousePosition.x) || !Number.isFinite(lastMousePosition.y)) return null;
  const hovered = document.elementFromPoint(lastMousePosition.x, lastMousePosition.y);
  return hovered ? hovered.closest<HTMLElement>('[data-pane-id]') : null;
}

function selectAllInPane(paneEl: HTMLElement | null): boolean {
  if (!paneEl) return false;
  const paneId = paneEl.getAttribute('data-pane-id');
  if (!paneId) return false;
  PaneManager.setActivePane(paneId);

  const content = paneEl.querySelector<HTMLElement>('.pane-content');
  if (!content) return false;

  const verseLines = content.querySelectorAll('.verse-line');
  if (verseLines.length > 0) {
    document
      .querySelectorAll('.pane-content .verse-selected')
      .forEach((el) => el.classList.remove('verse-selected'));
    verseLines.forEach((line: Element) => line.classList.add('verse-selected'));
    const selection = window.getSelection();
    if (selection) selection.removeAllRanges();
    return true;
  }

  const selection = window.getSelection();
  if (!selection) return false;
  const range = document.createRange();
  range.selectNodeContents(content);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

// Left-click on a Strong's number → dictionary lookup
document.addEventListener('click', (e: MouseEvent) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  const paneContent = target.closest<HTMLElement>('.pane-content');

  // Verse click → scroll synced commentary panes
  const verseLine = target.closest<HTMLElement>('.verse-line');
  if (verseLine && !target.closest('.crossref-link')) {
    const paneEl = verseLine.closest<HTMLElement>('[data-pane-id]');
    if (paneEl) {
      const verseNum = parseInt(verseLine.dataset.verse, 10);
      if (!isNaN(verseNum)) {
        PaneManager.notifyVerseClick(paneEl.getAttribute('data-pane-id'), verseNum);
      }
    }
  }

  // Cross-reference link click → navigate pane
  const refEl = target.closest<HTMLElement>('.crossref-link');
  if (refEl) {
    e.preventDefault();
    const paneEl = refEl.closest<HTMLElement>('[data-pane-id]');
    if (!paneEl) return;
    const paneId = paneEl.getAttribute('data-pane-id');
    const bookTo = parseInt(refEl.dataset.bookTo, 10);
    const chapterTo = parseInt(refEl.dataset.chapterTo, 10);
    if (isNaN(bookTo) || isNaN(chapterTo)) return;
    const verseTo = refEl.dataset.verseTo ? parseInt(refEl.dataset.verseTo, 10) : null;
    if (verseTo !== null && isNaN(verseTo)) return;
    const targetPaneId = PaneManager.getNavigationTarget(paneId);
    const pinnedTarget = PaneManager.getLinkTargetPaneId();
    const openPinnedRefsInModal = AppStateStore.getSettings().openPinnedRefsInModal === true;
    if (
      openPinnedRefsInModal &&
      pinnedTarget &&
      paneId === pinnedTarget &&
      targetPaneId === pinnedTarget
    ) {
      const targetPane = PaneManager.getPane(targetPaneId);
      if (targetPane && targetPane.paneType === 'bible' && targetPane.moduleId) {
        CrossRefPreview.open({
          moduleId: targetPane.moduleId,
          hasStrongs: targetPane.hasStrongs,
          bookNumber: bookTo,
          chapter: chapterTo,
          verse: verseTo,
        });
        return;
      }
    }
    PaneManager.navigatePane(targetPaneId, bookTo, chapterTo, verseTo)
      .then((ok) => {
        if (!ok) window.showTooltip?.(targetPaneId, I18n.t('refUnavailable'));
      })
      .catch((err) => console.warn('Cross-ref navigation failed:', err));
    return;
  }

  // Commentary bible reference click → navigate pane
  const commentaryRef = target.closest<HTMLElement>('.commentary-ref[data-bhref]');
  if (commentaryRef) {
    e.preventDefault();
    const raw = decodeURIComponent(commentaryRef.dataset.bhref.trim());
    const parsed = parseBibleHref(raw);
    if (!parsed) return;
    if (parsed.verse !== null && Number.isNaN(parsed.verse)) return;
    const paneId = PaneManager.getActivePaneId();
    const targetPaneId = PaneManager.getNavigationTarget(paneId);
    PaneManager.navigatePane(targetPaneId, parsed.bookNumber, parsed.chapter, parsed.verse)
      .then((ok) => {
        if (!ok) window.showTooltip?.(targetPaneId, I18n.t('refUnavailable'));
      })
      .catch((err) => console.warn('Commentary ref navigation failed:', err));
    return;
  }

  const strongsEl = target.closest<HTMLElement>('.strongs');
  if (strongsEl) {
    e.preventDefault();
    if (!paneContent) return;
    const strongsNumber = strongsEl.textContent.trim();
    const paneEl = paneContent.closest<HTMLElement>('[data-pane-id]');
    const paneId = paneEl ? paneEl.getAttribute('data-pane-id') : null;
    const pane = PaneManager.getPane(paneId || PaneManager.getActivePaneId());
    DictPanel.lookup(strongsNumber, false, {
      paneId: paneId || PaneManager.getActivePaneId(),
      sourceModuleId: pane?.paneType === 'bible' ? pane.moduleId : null,
      morphCode: strongsEl.dataset.morph || null,
      lemma: strongsEl.dataset.lemma || null,
    });
  }
});

document.addEventListener('contextmenu', (e: MouseEvent) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  const paneContent = target.closest<HTMLElement>('.pane-content');
  if (!paneContent) return;
  e.preventDefault();

  const strongsEl = target.closest<HTMLElement>('.strongs');
  if (strongsEl) {
    const strongsNumber = strongsEl.textContent.trim();
    const paneEl = paneContent.closest<HTMLElement>('[data-pane-id]');
    const paneId = paneEl ? paneEl.getAttribute('data-pane-id') : null;
    window.api.showStrongsContextMenu({
      strongsNumber,
      paneId,
      labels: {
        search: I18n.t('strongsSearchOccurrences'),
        lookup: I18n.t('strongsDictionaryLookup'),
      },
    });
    return;
  }

  const hasSelection = paneContent.querySelectorAll('.verse-selected').length > 0;

  window.api.showVerseContextMenu({
    hasSelection,
  });
});

window.api.onContextMenuCopy(() => copySelectedVerses());

window.api.onStrongsSearch(({ strongsNumber, paneId }) => {
  const pane = PaneManager.getPane(paneId || PaneManager.getActivePaneId());
  if (pane && pane.moduleId) {
    SearchPanel.setSelectedModule(pane.moduleId);
  }
  SearchPanel.search(`strong:${strongsNumber}`);
});

window.api.onStrongsLookup(({ strongsNumber, paneId }) => {
  const pane = PaneManager.getPane(paneId || PaneManager.getActivePaneId());
  DictPanel.lookup(strongsNumber, false, {
    paneId: paneId || PaneManager.getActivePaneId(),
    sourceModuleId: pane?.paneType === 'bible' ? pane.moduleId : null,
  });
});

document.addEventListener('keydown', (e: KeyboardEvent) => {
  const tag = document.activeElement instanceof HTMLElement ? document.activeElement.tagName : '';
  const inputFocused = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
  const overlayOpen =
    document.getElementById('settings-overlay')?.classList.contains('hidden') === false ||
    document.getElementById('nav-overlay')?.classList.contains('hidden') === false ||
    CrossRefPreview.isOpen() ||
    AboutDialog.isOpen() ||
    ModuleEditor.isOpen();

  if (e.key === 'Escape' && AboutDialog.isOpen()) {
    e.preventDefault();
    AboutDialog.close();
    return;
  }

  if (e.key === 'Escape' && CrossRefPreview.isOpen()) {
    e.preventDefault();
    CrossRefPreview.close();
    return;
  }

  if (e.key === 'Escape' && Settings.isOpen()) {
    e.preventDefault();
    Settings.close();
    return;
  }

  if (e.key === 'F' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
    e.preventDefault();
    SearchPanel.focusInput();
    return;
  }

  if (e.key === 'F3') {
    e.preventDefault();
    openNavigationForActivePane();
    return;
  }

  // Ctrl+T — Open translation picker on active bible pane
  if (String(e.key).toLowerCase() === 't' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
    e.preventDefault();
    const paneId = PaneManager.getActivePaneId();
    const pane = PaneManager.getPane(paneId);
    if (pane && pane.paneType !== 'commentary') {
      PaneManager.openPanePicker(paneId);
    }
    return;
  }

  // Ctrl+Shift+T — Cycle through favorite translations
  if (String(e.key).toLowerCase() === 't' && (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey) {
    e.preventDefault();
    const paneId = PaneManager.getActivePaneId();
    const pane = PaneManager.getPane(paneId);
    if (pane && pane.paneType !== 'commentary') {
      const favs = (AppStateStore.getSettings().favoriteModules || {}).bible || [];
      if (favs.length < 2) return;
      const idx = favs.indexOf(pane.moduleId);
      const nextIdx = (idx + 1) % favs.length;
      PaneManager.switchPaneModule(paneId, favs[nextIdx]);
    }
    return;
  }

  if (inputFocused || overlayOpen) return;

  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && String(e.key).toLowerCase() === 'a') {
    e.preventDefault();
    const paneUnderMouse = getPaneFromMousePosition();
    if (paneUnderMouse) {
      selectAllInPane(paneUnderMouse);
      return;
    }
    const activePane = document.querySelector<HTMLElement>(
      `[data-pane-id="${PaneManager.getActivePaneId()}"]`
    );
    if (activePane) selectAllInPane(activePane);
    return;
  }

  if (e.key === 'Tab') {
    e.preventDefault();
    PaneManager.cycleActivePane();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
    if (window.getSelection().toString()) return;
    const paneId = PaneManager.getActivePaneId();
    const el = document.querySelector<HTMLElement>(`[data-pane-id="${paneId}"] .pane-content`);
    if (el && el.querySelectorAll('.verse-selected').length) {
      e.preventDefault();
      copySelectedVerses(paneId);
    }
    return;
  }

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const paneId = PaneManager.getActivePaneId();
    const el = document.querySelector<HTMLElement>(`[data-pane-id="${paneId}"] .pane-content`);
    if (el) {
      BibleView.selectAdjacentVerse(el, e.key === 'ArrowDown' ? 1 : -1, e.shiftKey);
      const newSelected = el.querySelector<HTMLElement>('.verse-line.verse-selected');
      if (newSelected) {
        PaneManager.notifyVerseClick(paneId, parseInt(newSelected.dataset.verse, 10));
      }
    }
  }
});

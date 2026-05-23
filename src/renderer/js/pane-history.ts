import type { HistoryMenuItem, NavDirection, NavHistoryEntry, PaneStateRecord } from './pane-model.js';

export function sanitizeNavHistory(
  rawHistory: NavHistoryEntry[] | undefined,
  modules: ModuleRecord[]
): NavHistoryEntry[] {
  if (!Array.isArray(rawHistory)) return [];
  const bibleModuleIds = new Set(modules.filter((module) => module.type === 'bible').map((module) => module.id));
  return rawHistory
    .filter((entry) => entry && typeof entry === 'object')
    .filter((entry) => typeof entry.moduleId === 'string' && bibleModuleIds.has(entry.moduleId))
    .map((entry) => ({
      moduleId: entry.moduleId,
      bookNumber: Number.isInteger(entry.bookNumber) ? entry.bookNumber : 10,
      chapter: Number.isInteger(entry.chapter) ? entry.chapter : 1,
      verse: Number.isInteger(entry.verse) ? entry.verse : null,
    }));
}

export function normalizeNavHistoryIndexes(panes: Record<string, PaneStateRecord>): void {
  for (const pane of Object.values(panes)) {
    if (pane.paneType !== 'bible') continue;
    if (!Array.isArray(pane.navHistory) || pane.navHistory.length === 0) {
      pane.navHistory = [];
      pane.navHistoryIdx = -1;
      continue;
    }
    pane.navHistoryIdx = Math.min(
      pane.navHistory.length - 1,
      Math.max(0, Number.isInteger(pane.navHistoryIdx) ? pane.navHistoryIdx : 0)
    );
  }
}

export function hasNavBackHistory(pane: PaneStateRecord | null): boolean {
  if (!pane || !Array.isArray(pane.navHistory)) return false;
  return pane.navHistoryIdx > 0;
}

export function hasNavForwardHistory(pane: PaneStateRecord | null): boolean {
  if (!pane || !Array.isArray(pane.navHistory)) return false;
  return pane.navHistoryIdx < pane.navHistory.length - 1;
}

export function getNavHistoryEntries(
  pane: PaneStateRecord | null,
  direction: NavDirection
): HistoryMenuItem[] {
  if (!pane || !Array.isArray(pane.navHistory)) return [];
  if (direction === 'back') {
    return pane.navHistory
      .slice(0, pane.navHistoryIdx)
      .map((entry, index) => ({ entry, index }))
      .reverse();
  }
  return pane.navHistory
    .slice(pane.navHistoryIdx + 1)
    .map((entry, offset) => ({ entry, index: pane.navHistoryIdx + 1 + offset }));
}

export function pushNavHistoryEntry(pane: PaneStateRecord): boolean {
  const currentIndex = Number.isInteger(pane.navHistoryIdx) ? pane.navHistoryIdx : -1;
  const verse = pane.selectedVerse || null;
  const entry: NavHistoryEntry = {
    moduleId: pane.moduleId,
    bookNumber: pane.bookNumber,
    chapter: pane.chapter,
    verse,
  };
  pane.navHistory = (pane.navHistory || []).slice(0, currentIndex + 1);
  const top = pane.navHistory[currentIndex];
  if (
    top &&
    top.moduleId === entry.moduleId &&
    top.bookNumber === entry.bookNumber &&
    top.chapter === entry.chapter &&
    top.verse === entry.verse
  ) {
    return false;
  }
  pane.navHistory.push(entry);
  pane.navHistoryIdx = pane.navHistory.length - 1;
  return true;
}

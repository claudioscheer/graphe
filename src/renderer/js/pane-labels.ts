import type { PaneStateRecord, PaneType } from './pane-model.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function parsePaneNumber(id: string | null | undefined): number {
  const match = String(id || '').match(/^pane-(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

export function labelForIndex(index: number): string {
  let n = Math.max(0, index);
  let out = '';
  do {
    out = ALPHABET[n % 26] + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

export function normalizeWindowLabel(candidate: string | null | undefined): string | null {
  if (typeof candidate !== 'string') return null;
  const trimmed = candidate.trim().toUpperCase();
  return /^[A-Z]+$/.test(trimmed) ? trimmed : null;
}

export function collectUsedWindowLabels(panes: Record<string, PaneStateRecord>): Set<string> {
  const used = new Set<string>();
  for (const pane of Object.values(panes)) {
    if (pane.paneType !== 'bible') continue;
    const label = normalizeWindowLabel(pane.windowLabel);
    if (label) used.add(label);
  }
  return used;
}

export function allocatePaneLabel(
  panes: Record<string, PaneStateRecord>,
  paneType: PaneType,
  preferred?: string | null
): string | null {
  if (paneType !== 'bible') return null;
  const used = collectUsedWindowLabels(panes);
  const normalizedPreferred = normalizeWindowLabel(preferred);
  if (normalizedPreferred && !used.has(normalizedPreferred)) return normalizedPreferred;
  let idx = 0;
  while (used.has(labelForIndex(idx))) idx++;
  return labelForIndex(idx);
}

export function getPaneDisplayLabel(
  panes: Record<string, PaneStateRecord>,
  paneId: string
): string {
  const pane = panes[paneId];
  if (!pane) return '';
  if (pane.paneType === 'commentary') {
    if (
      pane.syncedToPaneId &&
      panes[pane.syncedToPaneId] &&
      panes[pane.syncedToPaneId].paneType === 'bible'
    ) {
      return getPaneDisplayLabel(panes, pane.syncedToPaneId);
    }
    return '\u2013';
  }
  return normalizeWindowLabel(pane.windowLabel) || paneId.replace('pane-', '');
}

export function ensureWindowLabels(panes: Record<string, PaneStateRecord>): void {
  const used = new Set<string>();

  for (const pane of Object.values(panes)) {
    if (pane.paneType !== 'bible') {
      pane.windowLabel = null;
      continue;
    }

    const normalized = normalizeWindowLabel(pane.windowLabel);
    if (normalized && !used.has(normalized)) {
      pane.windowLabel = normalized;
      used.add(normalized);
      continue;
    }

    let idx = 0;
    while (used.has(labelForIndex(idx))) idx++;
    pane.windowLabel = labelForIndex(idx);
    used.add(pane.windowLabel);
  }
}

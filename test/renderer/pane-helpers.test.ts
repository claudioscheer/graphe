import { describe, expect, it } from 'vitest';

import { compactRanges } from '../../src/renderer/app/commentary-coverage.js';
import {
  allocatePaneLabel,
  collectUsedWindowLabels,
  ensureWindowLabels,
  getPaneDisplayLabel,
  labelForIndex,
  normalizeWindowLabel,
  parsePaneNumber,
} from '../../src/renderer/app/pane-labels.js';
import type { NavHistoryEntry, PaneStateRecord, PaneTreeNode } from '../../src/renderer/app/pane-model.js';
import {
  getNavHistoryEntries,
  hasNavBackHistory,
  hasNavForwardHistory,
  normalizeNavHistoryIndexes,
  pushNavHistoryEntry,
  sanitizeNavHistory,
} from '../../src/renderer/app/pane-history.js';
import {
  clampRatio,
  containsPane,
  findParent,
  findParentOfNode,
  findSplitChildIndex,
  getAllLeafIds,
  getFirstLeafId,
  sanitizeTree,
  serializeTree,
} from '../../src/renderer/app/pane-tree.js';

const bibleModule: ModuleRecord = {
  id: 'kjv',
  type: 'bible',
  displayName: 'KJV',
};

const dictModule: ModuleRecord = {
  id: 'strong',
  type: 'dictionary',
  displayName: 'Strong',
};

function biblePane(id: string, overrides: Partial<PaneStateRecord> = {}): PaneStateRecord {
  return {
    id,
    paneType: 'bible',
    moduleId: 'kjv',
    bookNumber: 10,
    chapter: 1,
    bookShortName: 'Gen',
    books: [],
    verses: [],
    selectedVerse: null,
    navHistory: [],
    navHistoryIdx: -1,
    ...overrides,
  };
}

function commentaryPane(id: string, syncedToPaneId: string | null = null): PaneStateRecord {
  return {
    id,
    paneType: 'commentary',
    moduleId: 'comm',
    bookNumber: 10,
    chapter: 1,
    bookShortName: 'Gen',
    commentaryBooks: [],
    entries: [],
    syncedToPaneId,
  };
}

describe('pane label helpers', () => {
  it('parses pane ids and generates spreadsheet-style labels', () => {
    expect(parsePaneNumber('pane-27')).toBe(27);
    expect(parsePaneNumber('pane-x')).toBe(0);
    expect(parsePaneNumber(null)).toBe(0);
    expect(labelForIndex(-1)).toBe('A');
    expect(labelForIndex(0)).toBe('A');
    expect(labelForIndex(25)).toBe('Z');
    expect(labelForIndex(26)).toBe('AA');
    expect(labelForIndex(27)).toBe('AB');
  });

  it('normalizes, allocates, collects, and repairs bible labels', () => {
    const panes: Record<string, PaneStateRecord> = {
      'pane-1': biblePane('pane-1', { windowLabel: ' a ' }),
      'pane-2': biblePane('pane-2', { windowLabel: 'A' }),
      'pane-3': commentaryPane('pane-3', 'pane-1'),
    };

    expect(normalizeWindowLabel(' ab ')).toBe('AB');
    expect(normalizeWindowLabel('a1')).toBeNull();
    expect(normalizeWindowLabel(null)).toBeNull();
    expect([...collectUsedWindowLabels(panes)]).toEqual(['A']);
    expect(allocatePaneLabel(panes, 'commentary', 'C')).toBeNull();
    expect(allocatePaneLabel(panes, 'bible', 'B')).toBe('B');
    expect(allocatePaneLabel(panes, 'bible', 'A')).toBe('B');

    ensureWindowLabels(panes);

    expect(panes['pane-1'].windowLabel).toBe('A');
    expect(panes['pane-2'].windowLabel).toBe('B');
    expect(panes['pane-3'].windowLabel).toBeNull();
    expect(getPaneDisplayLabel(panes, 'pane-3')).toBe('A');
    expect(getPaneDisplayLabel(panes, 'missing')).toBe('');
    expect(getPaneDisplayLabel({ 'pane-4': commentaryPane('pane-4') }, 'pane-4')).toBe('–');
    expect(getPaneDisplayLabel({ 'pane-7': biblePane('pane-7') }, 'pane-7')).toBe('7');
  });
});

describe('pane tree helpers', () => {
  const tree: PaneTreeNode = {
    type: 'split',
    direction: 'h',
    ratio: 0.65,
    children: [
      { type: 'leaf', paneId: 'pane-1' },
      {
        type: 'split',
        direction: 'v',
        ratio: 1,
        children: [
          { type: 'leaf', paneId: 'pane-2' },
          { type: 'leaf', paneId: 'pane-3' },
        ],
      },
    ],
  };

  it('sanitizes and serializes tree nodes', () => {
    const leafIds: string[] = [];
    const clean = sanitizeTree(tree, leafIds);

    expect(leafIds).toEqual(['pane-1', 'pane-2', 'pane-3']);
    expect(clean).toEqual({
      type: 'split',
      direction: 'h',
      ratio: 0.65,
      children: [
        { type: 'leaf', paneId: 'pane-1' },
        {
          type: 'split',
          direction: 'v',
          ratio: 0.9,
          children: [
            { type: 'leaf', paneId: 'pane-2' },
            { type: 'leaf', paneId: 'pane-3' },
          ],
        },
      ],
    });
    expect(serializeTree(clean)).toEqual(clean);
    expect(serializeTree(null)).toBeNull();
  });

  it('rejects invalid trees and clamps ratios', () => {
    const leafIds: string[] = [];

    expect(sanitizeTree(null, leafIds)).toBeNull();
    expect(sanitizeTree({ type: 'leaf', paneId: 'pane-1' }, leafIds)).toEqual({
      type: 'leaf',
      paneId: 'pane-1',
    });
    expect(
      sanitizeTree(
        {
          type: 'split',
          direction: 'h',
          ratio: Number.NaN,
          children: [
            { type: 'leaf', paneId: 'pane-1' },
            { type: 'leaf', paneId: 'pane-2' },
          ],
        },
        []
      )
    ).toBeNull();
    expect(
      sanitizeTree(
        {
          type: 'split',
          direction: 'h',
          ratio: 0.5,
          children: [{ type: 'leaf', paneId: 'pane-1' }],
        },
        []
      )
    ).toBeNull();
    expect(clampRatio(Number.NaN)).toBe(0.5);
    expect(clampRatio(0)).toBe(0.1);
    expect(clampRatio(1)).toBe(0.9);
  });

  it('finds leaves and parents', () => {
    expect(getFirstLeafId(tree)).toBe('pane-1');
    expect(getAllLeafIds(null)).toEqual([]);
    expect(getAllLeafIds(tree)).toEqual(['pane-1', 'pane-2', 'pane-3']);
    expect(containsPane(tree, 'pane-2')).toBe(true);
    expect(containsPane(tree, 'pane-x')).toBe(false);

    const parent = findParent(tree, 'pane-2');
    expect(parent?.type).toBe('split');
    expect(findParent({ type: 'leaf', paneId: 'pane-1' }, 'pane-1')).toBeNull();
    expect(findParent(tree, 'pane-x')).toBeNull();
    expect(parent ? findSplitChildIndex(parent, 'pane-3') : -1).toBe(1);
    expect(parent ? findSplitChildIndex(parent, 'pane-x') : -1).toBe(0);
    expect(parent ? findParentOfNode(tree, parent) : null).toBe(tree);
    expect(findParentOfNode({ type: 'leaf', paneId: 'pane-1' }, tree)).toBeNull();
  });
});

describe('pane history helpers', () => {
  const history: NavHistoryEntry[] = [
    { moduleId: 'kjv', bookNumber: 10, chapter: 1, verse: null },
    { moduleId: 'kjv', bookNumber: 10, chapter: 2, verse: 3 },
  ];

  it('sanitizes history against available bible modules', () => {
    expect(sanitizeNavHistory(undefined, [bibleModule])).toEqual([]);
    expect(sanitizeNavHistory(history, [bibleModule, dictModule])).toEqual(history);
    expect(
      sanitizeNavHistory(
        [
          { moduleId: 'missing', bookNumber: 1, chapter: 1, verse: 1 },
          { moduleId: 'kjv', bookNumber: 4.5, chapter: 0.5, verse: 2.5 },
        ],
        [bibleModule]
      )
    ).toEqual([{ moduleId: 'kjv', bookNumber: 10, chapter: 1, verse: null }]);
  });

  it('normalizes indexes and slices back/forward entries', () => {
    const panes: Record<string, PaneStateRecord> = {
      'pane-1': biblePane('pane-1', { navHistory: history, navHistoryIdx: 99 }),
      'pane-2': biblePane('pane-2', { navHistory: [], navHistoryIdx: 5 }),
      'pane-3': commentaryPane('pane-3'),
    };

    normalizeNavHistoryIndexes(panes);

    expect(panes['pane-1'].navHistoryIdx).toBe(1);
    expect(panes['pane-2'].navHistoryIdx).toBe(-1);
    expect(hasNavBackHistory(panes['pane-1'])).toBe(true);
    expect(hasNavForwardHistory(panes['pane-1'])).toBe(false);
    expect(hasNavBackHistory(null)).toBe(false);
    expect(hasNavForwardHistory(null)).toBe(false);
    expect(getNavHistoryEntries(panes['pane-1'], 'back')).toEqual([{ entry: history[0], index: 0 }]);
    expect(getNavHistoryEntries(panes['pane-1'], 'forward')).toEqual([]);
  });

  it('pushes unique history entries and truncates forward history', () => {
    const pane = biblePane('pane-1', {
      navHistory: [...history],
      navHistoryIdx: 0,
      bookNumber: 10,
      chapter: 1,
      selectedVerse: null,
    });

    expect(pushNavHistoryEntry(pane)).toBe(false);
    pane.chapter = 3;
    pane.selectedVerse = 4;
    expect(pushNavHistoryEntry(pane)).toBe(true);
    expect(pane.navHistory).toEqual([
      { moduleId: 'kjv', bookNumber: 10, chapter: 1, verse: null },
      { moduleId: 'kjv', bookNumber: 10, chapter: 3, verse: 4 },
    ]);
    expect(pane.navHistoryIdx).toBe(1);
  });
});

describe('commentary coverage helpers', () => {
  it('compacts numeric ranges', () => {
    expect(compactRanges([])).toBe('');
    expect(compactRanges([1])).toBe('1');
    expect(compactRanges([1, 2, 3, 5, 7, 8])).toBe('1-3, 5, 7-8');
  });
});

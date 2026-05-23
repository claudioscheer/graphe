export type PaneType = 'bible' | 'commentary';
export type SplitDirection = 'h' | 'v';
export type NavDirection = 'back' | 'forward';

export interface LeafNode {
  type: 'leaf';
  paneId: string;
}

export interface SplitNode {
  type: 'split';
  direction: SplitDirection;
  children: [PaneTreeNode, PaneTreeNode];
  ratio: number;
}

export type PaneTreeNode = LeafNode | SplitNode;

export interface NavHistoryEntry {
  moduleId: string | null;
  bookNumber: number;
  chapter: number;
  verse: number | null;
}

export interface PaneStateRecord {
  id: string;
  windowLabel?: string | null;
  paneType: PaneType;
  moduleId: string | null;
  hasStrongs?: boolean;
  strongsPrefix?: string | null;
  bookNumber: number;
  chapter: number;
  bookShortName: string;
  books?: BookRecord[];
  verses?: VerseRecord[];
  selectedVerse?: number | null;
  navHistory?: NavHistoryEntry[];
  navHistoryIdx?: number;
  commentaryBooks?: number[];
  entries?: CommentaryEntry[];
  syncedToPaneId?: string | null;
}

export interface SerializablePaneRecord {
  paneType: PaneType;
  windowLabel: string | null;
  moduleId: string | null;
  bookNumber: number;
  chapter: number;
  bookShortName: string;
  syncedToPaneId?: string | null;
  selectedVerse?: number | null;
  navHistory?: NavHistoryEntry[];
  navHistoryIdx?: number;
}

export interface PaneManagerSerializedState {
  activePaneId: string | null;
  tree: PaneTreeNode | null;
  panes: Record<string, SerializablePaneRecord>;
  linkTargetPaneId: string | null;
}

export interface RawPaneRecord {
  id?: string;
  windowLabel?: string | null;
  paneType?: PaneType;
  moduleId?: string | null;
  bookNumber?: number;
  chapter?: number;
  bookShortName?: string;
  selectedVerse?: number | null;
  navHistory?: NavHistoryEntry[];
  navHistoryIdx?: number;
  syncedToPaneId?: string | null;
}

export interface RawSavedState {
  activePaneId?: string | null;
  tree?: PaneTreeNode | null;
  panes?: Record<string, RawPaneRecord>;
  linkTargetPaneId?: string | null;
}

export interface HistoryMenuItem {
  entry: NavHistoryEntry;
  index: number;
}

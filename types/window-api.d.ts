export {};

declare global {
  interface Window {
    api: WindowApi;
    Settings?: SettingsApi;
    showTooltip?: (paneId: string, message: string) => void;
  }

  interface WindowApi {
    getModules(): Promise<ModuleRecord[]>;
    getBooks(moduleId: string): Promise<BookRecord[]>;
    getAllBooks(): Promise<BookRecord[]>;
    getChapterCount(moduleId: string, bookNumber: number): Promise<number>;
    getChapter(moduleId: string, bookNumber: number, chapter: number): Promise<VerseRecord[]>;
    searchVerses(moduleId: string, query: string): Promise<SearchResult[]>;
    searchVersesLimited(moduleId: string, query: string, limit: number): Promise<SearchResult[]>;
    getDictionaryEntry(moduleId: string, topic: string): Promise<DictionaryEntry | null>;
    lookupAllStrongDicts(
      topic: string,
      allowedModuleIds?: string[]
    ): Promise<DictionaryLookupResult[]>;
    searchDictionaryTopics(moduleId: string, prefix: string, limit: number): Promise<string[]>;
    getDictionaryCognates(moduleId: string, strongsNumber: string): Promise<DictionaryCognate[]>;
    getDictionaryMeta(moduleId: string): Promise<DictionaryMeta | null>;
    resolveMorphology(params: MorphologyRequest): Promise<MorphologyResult | null>;
    getDictionaryTopicCount(moduleId: string): Promise<number>;
    getDictionaryTopicsByPrefix(
      moduleId: string,
      prefix: string,
      limit: number,
      offset: number
    ): Promise<string[]>;
    getDictionaryRandomTopics(moduleId: string, limit: number): Promise<string[]>;
    getCrossReferences(
      book: number,
      chapter: number,
      allowedModuleIds?: string[]
    ): Promise<CrossReference[]>;
    getCommentary(moduleId: string, bookNumber: number, chapter: number): Promise<CommentaryEntry[]>;
    getCommentaryBooks(moduleId: string): Promise<number[]>;
    getCommentaryCoverage(moduleId: string): Promise<CommentaryCoverage>;
    getModulePath(moduleId: string): Promise<string | null>;
    getEditableModuleState(moduleId: string): Promise<EditableModuleState>;
    deleteModule(moduleId: string): Promise<boolean>;
    saveInfoValue(moduleId: string, name: string, value: string): Promise<boolean>;
    deleteInfoValue(moduleId: string, name: string): Promise<boolean>;
    saveBookNames(moduleId: string, bookNumber: number, fields: BookNameFields): Promise<boolean>;
    getVerseRecord(
      moduleId: string,
      bookNumber: number,
      chapter: number,
      verse: number
    ): Promise<VerseRecord | null>;
    saveVerseText(
      moduleId: string,
      bookNumber: number,
      chapter: number,
      verse: number,
      text: string
    ): Promise<boolean>;
    getCommentaryEntry(
      moduleId: string,
      bookNumber: number,
      chapter: number,
      verseFrom: number
    ): Promise<CommentaryEntry | null>;
    saveCommentaryText(
      moduleId: string,
      bookNumber: number,
      chapter: number,
      verseFrom: number,
      text: string
    ): Promise<boolean>;
    getAppState(): Promise<AppPersistedState>;
    saveAppState(state: AppPersistedState): Promise<void>;
    onOpenSettings(callback: () => void): void;
    onSplitH(callback: () => void): void;
    onSplitV(callback: () => void): void;
    onSplitHCommentary(callback: () => void): void;
    onSplitVCommentary(callback: () => void): void;
    showVerseContextMenu(opts: VerseContextMenuOptions): void;
    onContextMenuCopy(callback: () => void): void;
    showStrongsContextMenu(opts: StrongsContextMenuOptions): void;
    onStrongsSearch(callback: (payload: StrongsActionPayload) => void): void;
    onStrongsLookup(callback: (payload: StrongsActionPayload) => void): void;
    onOpenAbout(callback: () => void): void;
    onOpenModuleEditor(callback: () => void): void;
    getAppVersion(): Promise<string>;
    onUpdateAvailable(callback: (update: UpdateInfo) => void): void;
    getPendingUpdate(): Promise<UpdateInfo | null>;
    openExternal(url: string): Promise<void>;
    installModules(): void;
    onOpenConvertModules(callback: () => void): void;
    selectConvertFiles(): Promise<ConvertSelection>;
    selectConvertFolder(): Promise<ConvertSelection>;
    convertSingleFile(filePath: string): Promise<ConvertResult>;
    finishConvert(convertedFiles: ConvertResult[], mode: ConvertFinishMode): Promise<boolean>;
    cleanupConvert(): Promise<boolean>;
  }

  interface SettingsApi {
    open(): void;
    close?: () => void;
    init?: (settings?: AppSettings) => void;
    get?: () => AppSettings;
  }

  interface ModuleRecord {
    id: string;
    type: ModuleType;
    displayName: string;
    shortTitle?: string;
    description?: string;
    hasStrongs?: boolean;
    strongsPrefix?: string | null;
    isStrongDict?: boolean;
    language?: string | null;
    path?: string;
  }

  type ModuleType = 'bible' | 'dictionary' | 'commentary' | 'crossref' | 'crossreference' | 'other';

  type JsonPrimitive = string | number | boolean | null;
  type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

  interface JsonObject {
    [key: string]: JsonValue;
  }

  interface ModuleCatalog {
    modules: ModuleRecord[];
    bibleModules: ModuleRecord[];
    dictModules: ModuleRecord[];
    commentaryModules: ModuleRecord[];
    crossRefModules: ModuleRecord[];
  }

  interface BookRecord {
    bookNumber: number;
    shortName?: string;
    longName?: string;
    name?: string;
    chapters?: number;
  }

  interface VerseRecord {
    bookNumber?: number;
    chapter?: number;
    verse: number;
    text: string;
  }

  interface SearchResult extends VerseRecord {
    moduleId?: string;
    moduleName?: string;
  }

  interface DictionaryEntry {
    topic: string;
    definition?: string;
    text?: string;
    short_definition?: string;
    lexeme?: string;
    transliteration?: string;
    pronunciation?: string;
    moduleId?: string;
    moduleName?: string;
  }

  interface DictionaryLookupResult {
    moduleId: string;
    entry: DictionaryEntry;
  }

  type DictionaryCognate = string;

  interface DictionaryMeta {
    shortName?: string;
    longName?: string;
    title?: string;
    isStrongDict?: boolean;
    topicCount?: number;
  }

  interface MorphologyRequest {
    sourceModuleId?: string;
    strongDictModuleId?: string;
    morphCode?: string;
    uiLanguage?: string;
  }

  interface MorphologyResult {
    rawCode?: string;
    code?: string;
    source?: string;
    segments?: MorphologySegment[];
    displayText: string;
    topicRef: string | null;
    label?: string;
    description?: string;
  }

  interface MorphologySegment {
    kind: string;
    code: string;
    text: string;
  }

  interface CrossReference {
    book: number;
    chapter: number;
    verse: number;
    bookTo?: number;
    chapterTo?: number;
    verseTo?: number;
    verseToStart?: number;
    verseToEnd?: number;
    votes?: number;
    text?: string;
    bookToName?: string;
    previewText?: string;
  }

  interface CommentaryEntry {
    bookNumber?: number;
    chapter?: number;
    verseFrom?: number;
    verseTo?: number;
    verse?: number;
    verse_number_from?: number;
    verse_number_to?: number;
    text: string;
  }

  interface CommentaryCoverage {
    [bookNumber: number]: number[];
  }

  interface EditableModuleState {
    module?: ModuleRecord;
    moduleId: string;
    modulePath: string;
    type: ModuleType;
    info: Record<string, string>;
    tables: EditableModuleTables;
    infoRows: EditableInfoRow[];
    books: BookRecord[];
  }

  interface EditableModuleTables {
    info?: boolean;
    books?: boolean;
    booksAll?: boolean;
    verses?: boolean;
    commentaries?: boolean;
  }

  interface EditableInfoRow {
    name: string;
    value: string | number | boolean | null;
  }

  interface BookNameFields {
    shortName?: string;
    longName?: string;
    bookColor?: string;
  }

  interface VerseContextMenuOptions {
    hasSelection: boolean;
  }

  interface StrongsContextMenuOptions {
    strongsNumber: string;
    paneId?: string | null;
    labels?: {
      search?: string;
      lookup?: string;
    };
  }

  interface StrongsActionPayload {
    strongsNumber: string;
    paneId?: string | null;
  }

  interface AppPersistedState {
    settings?: AppSettings;
    paneManager?: PaneManagerState | null;
    searchPanel?: SearchPanelPersistedState | null;
    dictPanel?: DictPanelPersistedState | null;
    workspaces?: WorkspaceState | null;
  }

  interface AppSettings {
    theme?: 'light' | 'dark' | null;
    language?: string;
    fontSize?: number;
    strongsDicts?: string[] | null;
    crossRefModules?: string[] | null;
    favoriteModules?: Record<string, string[]>;
    openPinnedRefsInModal?: boolean;
  }

  interface DictPanelPersistedState {
    selectedModuleId: string | null;
    moduleSearchCache: Record<string, string>;
  }

  interface SearchPanelPersistedState {
    moduleId: string | null;
    query: string;
    widthRatio?: number | null;
  }

  interface PaneManagerState {
    activePaneId?: string | null;
    tree?: PaneTreeState | null;
    linkTargetPaneId?: string | null;
    panes?: Record<string, PaneSnapshot>;
  }

  type PaneTreeState = PaneTreeLeaf | PaneTreeSplit;

  interface PaneTreeLeaf {
    type: 'leaf';
    paneId: string;
  }

  interface PaneTreeSplit {
    type: 'split';
    direction: 'h' | 'v';
    children: [PaneTreeState, PaneTreeState];
    ratio: number;
  }

  interface PaneSnapshot {
    paneType?: 'bible' | 'commentary';
    windowLabel?: string | null;
    moduleId?: string | null;
    bookNumber?: number;
    chapter?: number;
    bookShortName?: string;
    syncedToPaneId?: string | null;
    selectedVerse?: number | null;
    navHistory?: Array<{
      moduleId: string | null;
      bookNumber: number;
      chapter: number;
      verse: number | null;
    }>;
    navHistoryIdx?: number;
  }

  interface WorkspaceState {
    items?: WorkspaceItem[];
    activeWorkspaceId?: string | null;
  }

  interface WorkspaceItem {
    id: string;
    name: string;
    location?: string;
    paneManager?: PaneManagerState | null;
    paneManagerState?: PaneManagerState | null;
  }

  interface UpdateInfo {
    version: string;
    url: string;
  }

  interface ConvertSelection {
    canceled?: boolean;
    files: ConvertFileCandidate[];
  }

  interface ConvertFileCandidate {
    path: string;
    name: string;
  }

  interface ConvertResult {
    ok: boolean;
    name?: string;
    tmpPath?: string;
    sourceDir?: string;
    error?: string;
  }

  type ConvertFinishMode = 'install' | 'save' | 'alongside';
}

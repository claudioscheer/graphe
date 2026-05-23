type SearchPanelState = SearchPanelPersistedState | null;
type DictPanelState = DictPanelPersistedState | null;

interface WorkbenchState {
  version: number;
  activeView?: string;
  collapsed?: boolean;
  widthRatio?: number | null;
}

interface WorkspaceEntry {
  id: string;
  name: string;
  paneManager?: PaneManagerState | null;
}

interface RendererWorkspacesState {
  version?: number;
  activeWorkspaceId?: string | null;
  items?: WorkspaceEntry[];
}

interface RendererAppState {
  settings: AppSettings & {
    crossRefModules?: string[] | null;
  };
  paneManager: PaneManagerState | null;
  workspaces: RendererWorkspacesState | null;
  workbench: WorkbenchState | null;
  searchPanel: SearchPanelState;
  dictPanel: DictPanelState;
}

interface AppStateStoreApi {
  init(loadedState: Partial<RendererAppState> | null): void;
  setSettings(nextSettings: Partial<RendererAppState['settings']>): void;
  setPaneManager(nextPaneState: PaneManagerState | null): void;
  getSettings(): RendererAppState['settings'];
  getPaneManager(): PaneManagerState | null;
  setWorkspaces(nextWorkspaces: Partial<RendererWorkspacesState> | null): void;
  getWorkspaces(): RendererWorkspacesState | null;
  setWorkbench(nextWorkbench: Partial<WorkbenchState>): void;
  getWorkbench(): WorkbenchState | null;
  setSearchPanel(nextSearchPanel: SearchPanelState): void;
  getSearchPanel(): SearchPanelState;
  setDictPanel(nextDictPanel: DictPanelState): void;
  getDictPanel(): DictPanelState;
}

export const AppStateStore = (() => {
  let state: RendererAppState = {
    settings: {
      theme: null,
      language: 'pt',
      fontSize: 20,
      strongsDicts: null,
      crossRefModules: null,
      openPinnedRefsInModal: false,
      favoriteModules: {},
    },
    paneManager: null,
    workspaces: null,
    workbench: null,
    searchPanel: null,
    dictPanel: null,
  };

  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  function init(loadedState: Partial<RendererAppState> | null): void {
    if (!loadedState || typeof loadedState !== 'object') return;
    state = {
      ...state,
      ...loadedState,
      settings: {
        ...state.settings,
        ...(loadedState.settings || {}),
      },
      workbench: normalizeWorkbenchState(loadedState.workbench, loadedState.searchPanel),
      workspaces: normalizeWorkspacesState(loadedState.workspaces),
      searchPanel: loadedState.searchPanel || null,
      dictPanel: loadedState.dictPanel || null,
    };
  }

  function normalizeWorkbenchState(
    workbenchState: Partial<WorkbenchState> | null | undefined,
    legacySearchState: SearchPanelState
  ): WorkbenchState {
    const currentVersion = 1;
    const source = workbenchState && typeof workbenchState === 'object' ? workbenchState : {};
    const activeView =
      typeof source.activeView === 'string' && source.activeView ? source.activeView : 'search';
    const widthRatio = Number.isFinite(source.widthRatio)
      ? source.widthRatio
      : Number.isFinite(legacySearchState?.widthRatio)
        ? legacySearchState.widthRatio
        : null;

    return {
      version: currentVersion,
      activeView,
      collapsed: source.collapsed === true,
      widthRatio: widthRatio == null ? null : Math.min(0.6, Math.max(0.12, Number(widthRatio))),
    };
  }

  function normalizeWorkspacesState(
    workspacesState: Partial<RendererWorkspacesState> | null | undefined
  ): RendererWorkspacesState | null {
    const currentVersion = 1;
    if (!workspacesState || typeof workspacesState !== 'object') return null;
    const rawItems = Array.isArray(workspacesState.items) ? workspacesState.items : [];
    const items = rawItems
      .filter((item) => item && typeof item === 'object' && typeof item.id === 'string')
      .map((item, index) => ({
        id: item.id,
        name:
          typeof item.name === 'string' && item.name.trim()
            ? item.name.trim()
            : `Workspace ${index + 1}`,
        paneManager:
          item.paneManager && typeof item.paneManager === 'object' ? item.paneManager : null,
      }));
    if (items.length === 0) return null;
    const activeWorkspaceId = items.some((item) => item.id === workspacesState.activeWorkspaceId)
      ? workspacesState.activeWorkspaceId
      : items[0].id;
    return {
      version: currentVersion,
      activeWorkspaceId,
      items,
    };
  }

  function scheduleSave(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      window.api.saveAppState(state).catch((err) => {
        console.error('Failed to save app state:', err);
      });
    }, 200);
  }

  function setSettings(nextSettings: Partial<RendererAppState['settings']>): void {
    state.settings = {
      ...state.settings,
      ...nextSettings,
    };
    scheduleSave();
  }

  function setPaneManager(nextPaneState: PaneManagerState | null): void {
    state.paneManager = nextPaneState;
    scheduleSave();
  }

  function getSettings(): RendererAppState['settings'] {
    return state.settings;
  }

  function getPaneManager(): PaneManagerState | null {
    return state.paneManager;
  }

  function setWorkspaces(nextWorkspaces: Partial<RendererWorkspacesState> | null): void {
    state.workspaces = normalizeWorkspacesState(nextWorkspaces);
    scheduleSave();
  }

  function getWorkspaces(): RendererWorkspacesState | null {
    return state.workspaces;
  }

  function setWorkbench(nextWorkbench: Partial<WorkbenchState>): void {
    state.workbench = {
      ...(state.workbench || { version: 1 }),
      ...nextWorkbench,
      version: 1,
    };
    scheduleSave();
  }

  function getWorkbench(): WorkbenchState | null {
    return state.workbench;
  }

  function setSearchPanel(nextSearchPanel: SearchPanelState): void {
    state.searchPanel = nextSearchPanel;
    scheduleSave();
  }

  function getSearchPanel(): SearchPanelState {
    return state.searchPanel;
  }

  function setDictPanel(nextDictPanel: DictPanelState): void {
    state.dictPanel = nextDictPanel;
    scheduleSave();
  }

  function getDictPanel(): DictPanelState {
    return state.dictPanel;
  }

  return {
    init,
    setSettings,
    setPaneManager,
    getSettings,
    getPaneManager,
    setWorkspaces,
    getWorkspaces,
    setWorkbench,
    getWorkbench,
    setSearchPanel,
    getSearchPanel,
    setDictPanel,
    getDictPanel,
  };
})() satisfies AppStateStoreApi;

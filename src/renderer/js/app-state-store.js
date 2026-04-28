export const AppStateStore = (() => {
  let state = {
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

  let saveTimer = null;

  function init(loadedState) {
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

  function normalizeWorkbenchState(workbenchState, legacySearchState) {
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

  function normalizeWorkspacesState(workspacesState) {
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

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      window.api.saveAppState(state).catch((err) => {
        console.error('Failed to save app state:', err);
      });
    }, 200);
  }

  function setSettings(nextSettings) {
    state.settings = {
      ...state.settings,
      ...nextSettings,
    };
    scheduleSave();
  }

  function setPaneManager(nextPaneState) {
    state.paneManager = nextPaneState;
    scheduleSave();
  }

  function getSettings() {
    return state.settings;
  }

  function getPaneManager() {
    return state.paneManager;
  }

  function setWorkspaces(nextWorkspaces) {
    state.workspaces = normalizeWorkspacesState(nextWorkspaces);
    scheduleSave();
  }

  function getWorkspaces() {
    return state.workspaces;
  }

  function setWorkbench(nextWorkbench) {
    state.workbench = {
      ...(state.workbench || { version: 1 }),
      ...nextWorkbench,
      version: 1,
    };
    scheduleSave();
  }

  function getWorkbench() {
    return state.workbench;
  }

  function setSearchPanel(nextSearchPanel) {
    state.searchPanel = nextSearchPanel;
    scheduleSave();
  }

  function getSearchPanel() {
    return state.searchPanel;
  }

  function setDictPanel(nextDictPanel) {
    state.dictPanel = nextDictPanel;
    scheduleSave();
  }

  function getDictPanel() {
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
})();

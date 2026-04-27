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
    setWorkbench,
    getWorkbench,
    setSearchPanel,
    getSearchPanel,
    setDictPanel,
    getDictPanel,
  };
})();
